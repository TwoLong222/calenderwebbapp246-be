// BookingService: cấu hình trang đặt lịch (cho chủ) + luồng công khai (cho người ngoài).
//
// - Chủ trang: dùng client gắn JWT (RLS) để đọc/ghi booking_pages của mình.
// - Công khai (không đăng nhập): dùng adminClient (service_role) vì người đặt không có JWT.
//   Tính khung giờ trống = working hours (user_settings) trừ đi sự kiện đang có.

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseService } from '../supabase/supabase.service';
import { SettingsService } from '../settings/settings.service';
import { MailService } from '../mail/mail.service';
import { UpdateBookingPageDto } from './dto/update-booking-page.dto';
import { CreateBookingDto } from './dto/create-booking.dto';

const DAYS_AHEAD = 14;

@Injectable()
export class BookingService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly settings: SettingsService,
    private readonly mail: MailService,
  ) {}

  private get admin() {
    return this.supabaseService.adminClient;
  }

  // ---------------- CHỦ TRANG ----------------

  /** Lấy trang đặt lịch của user; chưa có thì tạo mặc định (slug từ email + random). */
  async getOrCreateOwnPage(supabase: SupabaseClient, userId: string, email: string) {
    const { data } = await supabase
      .from('booking_pages')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (data) return data;

    const base = (email.split('@')[0] || 'user')
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '')
      .slice(0, 24) || 'user';
    const slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
    const { data: created, error } = await supabase
      .from('booking_pages')
      .insert({ user_id: userId, slug })
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    return created;
  }

  async updateOwnPage(supabase: SupabaseClient, userId: string, dto: UpdateBookingPageDto) {
    await this.getOrCreateOwnPage(supabase, userId, ''); // đảm bảo có hàng
    const patch: Record<string, any> = {};
    for (const k of ['slug', 'title', 'duration_minutes', 'enabled'] as const) {
      if (dto[k] !== undefined) patch[k] = dto[k];
    }
    if (Object.keys(patch).length === 0) {
      return this.getOrCreateOwnPage(supabase, userId, '');
    }
    const { data, error } = await supabase
      .from('booking_pages')
      .update(patch)
      .eq('user_id', userId)
      .select('*')
      .single();
    if (error) {
      if ((error as any).code === '23505') {
        throw new ConflictException('Đường dẫn (slug) này đã có người dùng. Chọn slug khác.');
      }
      throw new BadRequestException(error.message);
    }
    return data;
  }

  // ---------------- CÔNG KHAI ----------------

  private async findEnabledPage(slug: string) {
    const { data } = await this.admin
      .from('booking_pages')
      .select('*')
      .eq('slug', slug)
      .eq('enabled', true)
      .maybeSingle();
    if (!data) throw new NotFoundException('Trang đặt lịch không tồn tại hoặc đang tắt.');
    return data;
  }

  /** Thông tin cơ bản của trang cho người ngoài xem. */
  async getPublicPage(slug: string) {
    const page = await this.findEnabledPage(slug);
    return { slug: page.slug, title: page.title, durationMinutes: page.duration_minutes };
  }

  /** Danh sách khung giờ trống (ISO) trong DAYS_AHEAD ngày tới. */
  async getSlots(slug: string): Promise<{ durationMinutes: number; slots: string[] }> {
    const page = await this.findEnabledPage(slug);
    const settings = await this.settings.adminGetSettings(page.user_id);
    const tz: string = settings.timezone || 'Asia/Ho_Chi_Minh';
    const workingDays: number[] = settings.working_days ?? [1, 2, 3, 4, 5];
    const [wsH, wsM] = String(settings.working_start ?? '08:00').split(':').map(Number);
    const [weH, weM] = String(settings.working_end ?? '17:00').split(':').map(Number);
    const duration = page.duration_minutes;

    const busy = await this.getBusy(page.user_id);
    const now = Date.now();
    const slots: string[] = [];

    for (let d = 0; d < DAYS_AHEAD; d++) {
      const day = new Date();
      day.setDate(day.getDate() + d);
      const y = day.getFullYear();
      const m = day.getMonth();
      const date = day.getDate();
      // Thứ trong tuần theo timezone chủ trang (xấp xỉ theo ngày local server — đủ dùng)
      const weekday = new Date(y, m, date).getDay();
      if (!workingDays.includes(weekday)) continue;

      const dayStart = this.wallTimeToUtc(y, m, date, wsH, wsM || 0, tz).getTime();
      const dayEnd = this.wallTimeToUtc(y, m, date, weH, weM || 0, tz).getTime();
      for (let t = dayStart; t + duration * 60000 <= dayEnd; t += duration * 60000) {
        const start = t;
        const end = t + duration * 60000;
        if (start <= now) continue;
        const overlap = busy.some((b) => start < b.end && end > b.start);
        if (!overlap) slots.push(new Date(start).toISOString());
      }
    }
    return { durationMinutes: duration, slots };
  }

  async createBooking(slug: string, dto: CreateBookingDto) {
    const page = await this.findEnabledPage(slug);
    const duration = page.duration_minutes;
    const start = new Date(dto.startTime).getTime();
    const end = start + duration * 60000;

    if (isNaN(start) || start <= Date.now()) {
      throw new BadRequestException('Khung giờ không hợp lệ hoặc đã qua.');
    }
    // Kiểm tra lại còn trống (chống race / gửi giờ tuỳ ý)
    const busy = await this.getBusy(page.user_id);
    if (busy.some((b) => start < b.end && end > b.start)) {
      throw new ConflictException('Khung giờ vừa chọn đã có người đặt. Vui lòng chọn giờ khác.');
    }

    const calId = await this.primaryCalendarId(page.user_id);
    const owner = await this.ownerEmail(page.user_id);
    const { data: ev, error } = await this.admin
      .from('events')
      .insert({
        calendar_id: calId,
        kind: 'appointment',
        title: `${page.title} — ${dto.name}`,
        start_time: new Date(start).toISOString(),
        end_time: new Date(end).toISOString(),
        color: 'violet',
        creator_id: page.user_id,
        creator_email: owner,
      })
      .select('id')
      .single();
    if (error) throw new BadRequestException(error.message);

    await this.admin
      .from('event_attendees')
      .insert({ event_id: ev.id, email: dto.email.toLowerCase(), status: 'accepted' });

    // Email: xác nhận cho người đặt (luôn gửi) + báo cho chủ (theo preference).
    void this.mail.sendBookingConfirmation({
      to: dto.email,
      eventTitle: page.title,
      startTime: new Date(start).toISOString(),
      location: null,
    });
    if (owner && (await this.settings.isEmailEnabled(page.user_id, 'booking_notification'))) {
      void this.mail.sendBookingNotification({
        to: owner,
        inviteeName: dto.name,
        inviteeEmail: dto.email,
        eventTitle: page.title,
        startTime: new Date(start).toISOString(),
      });
    }

    return { success: true };
  }

  // ---------------- helpers ----------------

  private async getBusy(userId: string): Promise<{ start: number; end: number }[]> {
    const calId = await this.primaryCalendarId(userId);
    const fromIso = new Date().toISOString();
    const toIso = new Date(Date.now() + DAYS_AHEAD * 86400000).toISOString();
    const { data } = await this.admin
      .from('events')
      .select('start_time, end_time')
      .eq('calendar_id', calId)
      .is('deleted_at', null)
      .gte('start_time', fromIso)
      .lte('start_time', toIso);
    return (data ?? []).map((e: any) => ({
      start: new Date(e.start_time).getTime(),
      end: new Date(e.end_time).getTime(),
    }));
  }

  private async primaryCalendarId(userId: string): Promise<string> {
    const { data } = await this.admin
      .from('calendars')
      .select('id')
      .eq('owner_id', userId)
      .eq('is_primary', true)
      .maybeSingle();
    if (!data) throw new BadRequestException('Chủ trang chưa có lịch chính.');
    return data.id;
  }

  private async ownerEmail(userId: string): Promise<string | null> {
    const { data } = await this.admin.auth.admin.getUserById(userId);
    return data?.user?.email ?? null;
  }

  /** Đổi 1 giờ "wall-clock" (h:min ngày y-m-d) ở timezone tz sang instant UTC. */
  private wallTimeToUtc(y: number, m: number, d: number, h: number, min: number, tz: string): Date {
    const utcGuess = Date.UTC(y, m, d, h, min);
    const shown = new Date(utcGuess).toLocaleString('sv-SE', { timeZone: tz }); // "YYYY-MM-DD HH:MM:SS"
    const [dp, tp] = shown.split(' ');
    const [yy, mm, dd] = dp.split('-').map(Number);
    const [hh, mi] = tp.split(':').map(Number);
    const shownUtc = Date.UTC(yy, mm - 1, dd, hh, mi);
    return new Date(utcGuess + (utcGuess - shownUtc));
  }
}
