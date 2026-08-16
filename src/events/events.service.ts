// EventsService: toàn bộ logic đọc/ghi bảng events + event_attendees.
//
// QUAN TRỌNG: mọi truy vấn ở đây dùng `supabase` được truyền vào từ controller —
// đây chính là client đã gắn JWT của user (do SupabaseAuthGuard tạo ra), nên
// MỌI RLS policy trong calendar_schema.sql tự động được áp dụng đúng. Service này
// KHÔNG cần tự viết thêm điều kiện "chỉ lấy event của user này" — RLS đã lo việc đó.
//
// PHẠM VI HIỆN TẠI: chỉ làm việc với Lịch chính (Primary Calendar) của user.
// Khi nào làm tính năng chia sẻ lịch (calendar_members), chỉ cần sửa
// getPrimaryCalendarId() thành nhận calendarId từ request thay vì tự suy ra —
// không cần sửa logic RLS vì đã được thiết kế sẵn từ đầu.

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { MailService } from '../mail/mail.service';
import { SupabaseService } from '../supabase/supabase.service';

export interface ConflictRow {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
}

interface InviteContext {
  title: string;
  startTime: string;
  location: string | null;
}

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    private readonly mail: MailService,
    private readonly supabaseService: SupabaseService,
    private readonly config: ConfigService,
  ) {}

  private async getPrimaryCalendarId(supabase: SupabaseClient): Promise<string> {
    const { data, error } = await supabase.from('calendars').select('id').eq('is_primary', true).single();

    if (error || !data) {
      throw new Error('Không tìm thấy Lịch chính của người dùng này.');
    }
    return data.id;
  }

  async listEvents(supabase: SupabaseClient) {
    const { data, error } = await supabase
      .from('events')
      .select('*, attendees:event_attendees(*)')
      .order('start_time', { ascending: true });

    if (error) throw error;
    return data;
  }

  /** Cảnh báo trùng lịch — CHỈ cảnh báo, không chặn lưu (đúng quyết định đã chọn) */
  private async findConflicts(
    supabase: SupabaseClient,
    calendarId: string,
    startTime: string,
    endTime: string,
    excludeId?: string,
  ): Promise<ConflictRow[]> {
    let query = supabase
      .from('events')
      .select('id, title, start_time, end_time')
      .eq('calendar_id', calendarId)
      .eq('is_all_day', false)
      .eq('kind', 'event')
      .lt('start_time', endTime)
      .gt('end_time', startTime);

    if (excludeId) query = query.neq('id', excludeId);

    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  }

  /** Dời 1 mốc thời gian ISO theo chu kỳ lặp cho lần thứ i (i=0 là lần gốc) */
  private shiftDate(iso: string, repeat: 'none' | 'daily' | 'weekly' | 'monthly', i: number): string {
    const d = new Date(iso);
    if (i === 0 || repeat === 'none') return d.toISOString();
    if (repeat === 'daily') d.setDate(d.getDate() + i);
    else if (repeat === 'weekly') d.setDate(d.getDate() + i * 7);
    else if (repeat === 'monthly') d.setMonth(d.getMonth() + i);
    return d.toISOString();
  }

  async createEvent(supabase: SupabaseClient, userId: string, dto: CreateEventDto) {
    const calendarId = await this.getPrimaryCalendarId(supabase);
    const repeat = dto.repeat ?? 'none';
    // Số lần lặp: 'none' -> 1, còn lại lấy repeatCount (chặn trong [1, 52])
    const count = repeat === 'none' ? 1 : Math.min(Math.max(dto.repeatCount ?? 1, 1), 52);

    // Cảnh báo trùng lịch tính cho lần ĐẦU, TRƯỚC khi insert (để không tự trùng chính event vừa tạo)
    const conflicts = dto.isAllDay
      ? []
      : await this.findConflicts(supabase, calendarId, dto.startTime, dto.endTime);

    // Sinh danh sách các lần lặp — mỗi lần là 1 event thật, dời start/end theo chu kỳ
    const rows = Array.from({ length: count }, (_, i) => ({
      calendar_id: calendarId,
      title: dto.title,
      description: dto.description ?? null,
      location: dto.location ?? null,
      start_time: this.shiftDate(dto.startTime, repeat, i),
      end_time: this.shiftDate(dto.endTime, repeat, i),
      is_all_day: dto.isAllDay ?? false,
      kind: dto.kind ?? 'event',
      color: dto.color ?? 'sky',
      creator_id: userId,
    }));

    const { data: events, error } = await supabase.from('events').insert(rows).select();
    if (error) throw error;

    // Lần sớm nhất (event gốc) — trả về cho frontend + là nơi gửi email mời (tránh spam N lần)
    const first = [...events].sort(
      (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
    )[0];

    // Gán khách mời cho TẤT CẢ các lần lặp; chỉ gửi email mời cho lần đầu tiên
    if (dto.guestEmails?.length) {
      for (const ev of events) {
        const added = await this.syncAttendees(supabase, ev.id, dto.guestEmails);
        if (ev.id === first.id) {
          await this.sendInvites(ev.id, added, {
            title: dto.title,
            startTime: ev.start_time,
            location: dto.location ?? null,
          });
        }
      }
    }

    const attendees = await this.getAttendees(supabase, first.id);
    return { event: { ...first, attendees }, conflicts };
  }

  async updateEvent(supabase: SupabaseClient, id: string, dto: UpdateEventDto) {
    const { data: existing, error: fetchError } = await supabase
      .from('events')
      .select('calendar_id, start_time, end_time, is_all_day')
      .eq('id', id)
      .single();
    if (fetchError) throw fetchError;

    const nextStart = dto.startTime ?? existing.start_time;
    const nextEnd = dto.endTime ?? existing.end_time;
    const nextIsAllDay = dto.isAllDay ?? existing.is_all_day;

    const conflicts = nextIsAllDay
      ? []
      : await this.findConflicts(supabase, existing.calendar_id, nextStart, nextEnd, id);

    const patch: Record<string, unknown> = {};
    if (dto.title !== undefined) patch['title'] = dto.title;
    if (dto.description !== undefined) patch['description'] = dto.description;
    if (dto.location !== undefined) patch['location'] = dto.location;
    if (dto.startTime !== undefined) patch['start_time'] = dto.startTime;
    if (dto.endTime !== undefined) patch['end_time'] = dto.endTime;
    if (dto.isAllDay !== undefined) patch['is_all_day'] = dto.isAllDay;
    if (dto.kind !== undefined) patch['kind'] = dto.kind;
    if (dto.color !== undefined) patch['color'] = dto.color;

    const { data: event, error } = await supabase.from('events').update(patch).eq('id', id).select().single();
    if (error) throw error;

    if (dto.guestEmails !== undefined) {
      const added = await this.syncAttendees(supabase, id, dto.guestEmails);
      // Gửi email mời cho các khách MỚI được thêm (khách cũ giữ nguyên trạng thái)
      await this.sendInvites(id, added, {
        title: event.title,
        startTime: event.start_time,
        location: event.location ?? null,
      });
    }

    const attendees = await this.getAttendees(supabase, id);
    return { event: { ...event, attendees }, conflicts };
  }

  async deleteEvent(supabase: SupabaseClient, id: string) {
    const { error } = await supabase.from('events').delete().eq('id', id);
    if (error) throw error;
    return { id };
  }

  private async getAttendees(supabase: SupabaseClient, eventId: string) {
    const { data, error } = await supabase.from('event_attendees').select('*').eq('event_id', eventId);
    if (error) throw error;
    return data ?? [];
  }

  /**
   * Đồng bộ danh sách khách mời KIỂU GIA TĂNG: chỉ xóa khách bị bỏ ra, chỉ thêm khách mới
   * (giữ nguyên trạng thái RSVP của khách cũ). Mỗi khách mới sinh 1 respond_token để dùng
   * cho link Đồng ý/Từ chối trong email. Trả về danh sách khách MỚI kèm token để gửi mail.
   */
  private async syncAttendees(
    supabase: SupabaseClient,
    eventId: string,
    emails: string[],
  ): Promise<{ email: string; token: string }[]> {
    const { data: existing } = await supabase.from('event_attendees').select('email').eq('event_id', eventId);
    const existingLower = new Set((existing ?? []).map((a) => a.email.toLowerCase()));
    const keepLower = new Set(emails.map((e) => e.toLowerCase()));

    const toRemove = (existing ?? []).map((a) => a.email).filter((e) => !keepLower.has(e.toLowerCase()));
    if (toRemove.length) {
      await supabase.from('event_attendees').delete().eq('event_id', eventId).in('email', toRemove);
    }

    const added: { email: string; token: string }[] = [];
    for (const email of emails) {
      if (existingLower.has(email.toLowerCase())) continue;
      const token = randomUUID();
      const tokenExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // hết hạn sau 7 ngày
      const { error } = await supabase.from('event_attendees').insert({
        event_id: eventId,
        email,
        status: 'needsAction',
        respond_token: token,
        token_expires_at: tokenExpires,
      });
      if (error) throw error;
      added.push({ email, token });
    }
    return added;
  }

  /** Gửi email mời (kèm link Đồng ý/Từ chối) cho các khách mới thêm. Lỗi gửi mail không làm hỏng việc tạo event. */
  private async sendInvites(
    eventId: string,
    added: { email: string; token: string }[],
    ctx: InviteContext,
  ): Promise<void> {
    if (added.length === 0) return;
    const base = this.config.get<string>('PUBLIC_API_URL') ?? 'http://localhost:3000/api';
    for (const { email, token } of added) {
      const acceptUrl = `${base}/events/${eventId}/respond-via-email?token=${token}&action=accept`;
      const declineUrl = `${base}/events/${eventId}/respond-via-email?token=${token}&action=decline`;
      try {
        await this.mail.sendEventInvite({
          to: email,
          eventTitle: ctx.title,
          startTime: ctx.startTime,
          location: ctx.location,
          acceptUrl,
          declineUrl,
        });
      } catch (e) {
        this.logger.error(`Gửi email mời thất bại cho ${email}`, e as Error);
      }
    }
  }

  /**
   * Xử lý phản hồi từ nút trong email (KHÔNG cần đăng nhập) — xác thực bằng respond_token.
   * Dùng adminClient (service_role) vì không có JWT của user. Token dùng 1 lần: sau khi phản hồi,
   * respond_token bị xóa để không bấm lại được. Trả về HTML để hiển thị cho người bấm.
   */
  async respondViaToken(eventId: string, token: string, action: string): Promise<string> {
    if (action !== 'accept' && action !== 'decline') {
      return this.responsePage('Liên kết không hợp lệ', 'Hành động không hợp lệ.');
    }
    if (!token) {
      return this.responsePage('Liên kết không hợp lệ', 'Thiếu mã xác nhận.');
    }

    const admin = this.supabaseService.adminClient;
    const { data: attendee } = await admin
      .from('event_attendees')
      .select('id, token_expires_at')
      .eq('event_id', eventId)
      .eq('respond_token', token)
      .maybeSingle();

    if (!attendee) {
      return this.responsePage('Liên kết không hợp lệ', 'Lời mời này đã được phản hồi hoặc liên kết không đúng.');
    }
    if (attendee.token_expires_at && new Date(attendee.token_expires_at).getTime() < Date.now()) {
      return this.responsePage('Liên kết đã hết hạn', 'Lời mời này đã quá hạn phản hồi (7 ngày).');
    }

    const status = action === 'accept' ? 'accepted' : 'declined';
    await admin.from('event_attendees').update({ status, respond_token: null }).eq('id', attendee.id);

    const label = action === 'accept' ? 'ĐỒNG Ý tham gia ✅' : 'TỪ CHỐI ❌';
    return this.responsePage('Đã ghi nhận phản hồi', `Bạn đã <strong>${label}</strong>. Cảm ơn bạn!`);
  }

  /** Trang HTML đơn giản trả về sau khi bấm nút trong email */
  private responsePage(title: string, message: string): string {
    return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="font-family:system-ui,Arial,sans-serif;background:#f8fafc;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0">
  <div style="background:#fff;padding:32px 40px;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.08);text-align:center;max-width:420px">
    <h1 style="font-size:20px;margin:0 0 10px;color:#0f172a">${title}</h1>
    <p style="color:#475569;margin:0;line-height:1.5">${message}</p>
  </div>
</body></html>`;
  }
}
