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

import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { MailService } from '../mail/mail.service';
import { SupabaseService } from '../supabase/supabase.service';
import { SettingsService } from '../settings/settings.service';

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

/** Luật lặp đã chuẩn hoá dùng để sinh các lần lặp. */
interface RecurrenceRule {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  /** Lặp theo tuần: các thứ được chọn (0=CN..6=T7). Rỗng = dùng thứ của ngày bắt đầu. */
  weekdays: number[];
  /** Lặp theo tháng: theo ngày / theo thứ thứ-n / theo thứ cuối cùng. */
  monthlyMode: 'monthday' | 'nthWeekday' | 'lastWeekday';
  /** Kết thúc sau N lần (tính cả lần đầu). */
  count?: number;
  /** Kết thúc vào ngày (ISO). null = không giới hạn (bị chặn cứng ~2 năm). */
  until: string | null;
}

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    private readonly mail: MailService,
    private readonly supabaseService: SupabaseService,
    private readonly config: ConfigService,
    private readonly settings: SettingsService,
  ) {}

  private async getPrimaryCalendarId(supabase: SupabaseClient, userId: string): Promise<string> {
    // PHASE 6D: lọc thêm owner_id — vì sau khi chia sẻ lịch, RLS còn trả các lịch
    // được chia sẻ cho mình (có thể is_primary=true) -> .single() sẽ vỡ nếu không lọc.
    const { data, error } = await supabase
      .from('calendars')
      .select('id')
      .eq('is_primary', true)
      .eq('owner_id', userId)
      .single();

    if (error || !data) {
      throw new Error('Không tìm thấy Lịch chính của người dùng này.');
    }
    return data.id;
  }

  async listEvents(supabase: SupabaseClient, userEmail?: string, userId?: string) {
    const { data, error } = await supabase
      .from('events')
      .select('*, attendees:event_attendees(*), reminders:event_reminders(minutes_before)')
      .is('deleted_at', null) // bỏ qua sự kiện đang trong thùng rác
      .order('start_time', { ascending: true });

    if (error) throw error;
    // Lịch CÁ NHÂN không hiển thị sự kiện NHÓM (group_id != null) — nhóm có endpoint riêng.
    // Lọc ở JS để không phụ thuộc cột group_id đã tồn tại (an toàn nếu chưa chạy migration Phase 7).
    const own = (data ?? []).filter((e: any) => !e.group_id);

    // Sự kiện mình ĐƯỢC MỜI: nó nằm trên lịch của NGƯỜI TẠO nên RLS mặc định chặn user
    // đọc -> lịch người được mời bị trống dù đã Đồng ý. Lấy thêm các sự kiện này qua
    // service_role (bypass RLS) rồi gộp vào. Cách này KHÔNG cần chạy migration RLS.
    const invited = await this.listInvitedEvents(userEmail);

    // Gộp + khử trùng theo id (sự kiện mình vừa tạo cũng có mình trong danh sách mời).
    const byId = new Map<string, any>();
    for (const e of [...own, ...invited]) byId.set(e.id, e);

    // QUAN TRỌNG: chính sách RLS "khách đọc sự kiện được mời" cho phép khách đọc sự kiện
    // BẤT KỂ trạng thái -> nó lọt vào truy vấn `own` nên khách chưa Đồng ý vẫn thấy.
    // Lọc lại: chỉ hiện sự kiện được mời khi đã 'accepted'. Vẫn giữ nếu mình là NGƯỜI TẠO
    // hoặc mình KHÔNG nằm trong danh sách khách (vd lịch chia sẻ).
    const email = userEmail?.toLowerCase();
    const visible = [...byId.values()].filter((e: any) => {
      if (userId && e.creator_id === userId) return true; // sự kiện của chính mình
      const mine = (e.attendees ?? []).find(
        (a: any) => a.email?.toLowerCase() === email,
      );
      if (!mine) return true; // không phải khách mời -> lịch chia sẻ/khác, giữ nguyên
      return mine.status === 'accepted'; // là khách -> chỉ hiện khi đã Đồng ý
    });

    return visible.sort((a, b) =>
      (a.start_time ?? '') < (b.start_time ?? '') ? -1 : 1,
    );
  }

  /**
   * Lời mời của user (khách) mà CHƯA trả lời (needsAction/tentative) — để hiện ở chuông
   * thông báo + trang "Lời mời". Dùng adminClient vì sự kiện chưa Đồng ý bị ẩn khỏi client user.
   * An toàn: lọc đúng theo email trong JWT của user gọi API.
   */
  async listInvitations(userEmail: string) {
    const email = (userEmail ?? '').trim();
    if (!email) return [];
    const { data, error } = await this.supabaseService.adminClient
      .from('event_attendees')
      .select(
        'status, event:events(id, title, start_time, end_time, is_all_day, location, color, creator_email, deleted_at, group_id)',
      )
      .ilike('email', email)
      .in('status', ['needsAction', 'tentative']);
    if (error) {
      this.logger.warn(`Không lấy được lời mời cho ${email}: ${error.message}`);
      return [];
    }
    return (data ?? [])
      .map((r: any) => ({ status: r.status, ev: r.event }))
      .filter((r) => r.ev && !r.ev.deleted_at && !r.ev.group_id)
      .map((r) => ({
        eventId: r.ev.id,
        title: r.ev.title,
        startTime: r.ev.start_time,
        endTime: r.ev.end_time,
        isAllDay: r.ev.is_all_day,
        location: r.ev.location,
        color: r.ev.color,
        creatorEmail: r.ev.creator_email,
        myStatus: r.status,
      }));
  }

  /** Các sự kiện mà user ĐÃ CHẤP NHẬN lời mời (status = 'accepted').
   *  Chỉ sự kiện đã Đồng ý mới vào lịch — lời mời đang chờ (needsAction) hay đã từ chối
   *  (declined) đều KHÔNG hiện, cho tới khi khách bấm "Đồng ý" trong email. */
  private async listInvitedEvents(userEmail?: string): Promise<any[]> {
    if (!userEmail) return [];
    const admin = this.supabaseService.adminClient;
    const { data, error } = await admin
      .from('event_attendees')
      .select('event:events(*, attendees:event_attendees(*), reminders:event_reminders(minutes_before))')
      .ilike('email', userEmail) // khớp không phân biệt hoa/thường
      .eq('status', 'accepted'); // chỉ lấy sự kiện đã được khách Đồng ý

    if (error) {
      this.logger.warn(`Không lấy được sự kiện được mời cho ${userEmail}: ${error.message}`);
      return [];
    }
    return (data ?? [])
      .map((row: any) => row.event)
      .filter((e: any) => e && !e.group_id && !e.deleted_at);
  }

  /** Liệt kê các sự kiện của CHÍNH user đang trong thùng rác (mới xóa lên đầu) */
  async listTrash(supabase: SupabaseClient, userId: string) {
    const { data, error } = await supabase
      .from('events')
      .select('*, attendees:event_attendees(*)')
      .not('deleted_at', 'is', null)
      .eq('creator_id', userId)
      .order('deleted_at', { ascending: false });

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
      .is('deleted_at', null) // sự kiện đã xóa (trong thùng rác) không tính là trùng lịch
      .lt('start_time', endTime)
      .gt('end_time', startTime);

    if (excludeId) query = query.neq('id', excludeId);

    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  }

  /** Chuẩn hoá danh sách mốc nhắc (phút): khử trùng, chặn [0, 200 tuần], sắp tăng dần. */
  private normalizeReminders(list?: number[]): number[] {
    if (!list?.length) return [];
    const set = new Set<number>();
    for (const v of list) {
      const n = Math.round(Number(v));
      if (Number.isFinite(n) && n >= 0 && n <= 2016000) set.add(n);
    }
    return [...set].sort((a, b) => a - b);
  }

  /** Gom các trường lặp trong DTO thành 1 "luật lặp" chuẩn; null = không lặp. */
  private buildRule(dto: CreateEventDto): RecurrenceRule | null {
    // Ưu tiên repeatFreq (mới); nếu chỉ có repeat cũ thì quy đổi.
    const freq =
      dto.repeatFreq ??
      (dto.repeat && dto.repeat !== 'none' ? (dto.repeat as RecurrenceRule['freq']) : undefined);
    if (!freq) return null;
    return {
      freq,
      interval: Math.min(Math.max(dto.repeatInterval ?? 1, 1), 999),
      weekdays: (dto.repeatWeekdays ?? []).filter((d) => d >= 0 && d <= 6),
      monthlyMode: dto.repeatMonthlyMode ?? 'monthday',
      count: dto.repeatCount,
      until: dto.repeatUntil ?? null,
    };
  }

  /**
   * Sinh danh sách các lần lặp (mỗi lần = {start,end} ISO). Chặn cứng để tránh tạo vô hạn:
   * tối đa MAX lần và trong vòng ~2 năm (cho lựa chọn "Không bao giờ").
   */
  private generateOccurrences(startIso: string, endIso: string, rule: RecurrenceRule): { start: string; end: string }[] {
    const MAX = 366;
    const start = new Date(startIso);
    const durationMs = new Date(endIso).getTime() - start.getTime();
    const interval = Math.max(1, rule.interval || 1);
    const until = rule.until ? new Date(rule.until) : null;
    const cap = rule.count ? Math.min(Math.max(rule.count, 1), MAX) : MAX;
    const horizon = new Date(start);
    horizon.setFullYear(horizon.getFullYear() + 2);

    const out: Date[] = [];
    const stop = (d: Date) => (until && d > until) || d > horizon || out.length >= cap;

    if (rule.freq === 'daily') {
      const d = new Date(start);
      while (!stop(d)) {
        out.push(new Date(d));
        d.setDate(d.getDate() + interval);
      }
    } else if (rule.freq === 'weekly') {
      const weekdays = rule.weekdays.length ? [...new Set(rule.weekdays)].sort((a, b) => a - b) : [start.getDay()];
      // Bắt đầu từ Chủ Nhật của tuần chứa `start`, giữ nguyên giờ:phút.
      const weekStart = new Date(start);
      weekStart.setDate(start.getDate() - start.getDay());
      let safety = 0;
      outer: while (out.length < cap && safety++ < 500) {
        for (const wd of weekdays) {
          const d = new Date(weekStart);
          d.setDate(weekStart.getDate() + wd);
          d.setHours(start.getHours(), start.getMinutes(), 0, 0);
          if (d < start) continue;
          if ((until && d > until) || d > horizon) break outer;
          out.push(new Date(d));
          if (out.length >= cap) break outer;
        }
        weekStart.setDate(weekStart.getDate() + 7 * interval);
      }
    } else if (rule.freq === 'monthly') {
      const dayOfMonth = start.getDate();
      const weekday = start.getDay();
      const nth = Math.ceil(dayOfMonth / 7); // 1..5
      const m = new Date(start.getFullYear(), start.getMonth(), 1);
      let safety = 0;
      while (out.length < cap && safety++ < 500) {
        let d: Date | null = null;
        if (rule.monthlyMode === 'nthWeekday') d = this.nthWeekday(m.getFullYear(), m.getMonth(), weekday, nth, start);
        else if (rule.monthlyMode === 'lastWeekday') d = this.nthWeekday(m.getFullYear(), m.getMonth(), weekday, -1, start);
        else {
          const daysInMonth = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
          if (dayOfMonth <= daysInMonth) d = new Date(m.getFullYear(), m.getMonth(), dayOfMonth, start.getHours(), start.getMinutes());
        }
        if (d && d >= start) {
          if ((until && d > until) || d > horizon) break;
          out.push(new Date(d));
        }
        m.setMonth(m.getMonth() + interval);
        if (m > horizon) break;
      }
    } else if (rule.freq === 'yearly') {
      const d = new Date(start);
      while (!stop(d)) {
        out.push(new Date(d));
        d.setFullYear(d.getFullYear() + interval);
      }
    }

    if (out.length === 0) out.push(new Date(start)); // luôn có ít nhất lần gốc
    return out.slice(0, cap).map((d) => ({
      start: d.toISOString(),
      end: new Date(d.getTime() + durationMs).toISOString(),
    }));
  }

  /** Thứ `weekday` lần thứ `nth` trong tháng (nth=-1 = lần cuối cùng); null nếu tháng không có. */
  private nthWeekday(year: number, month: number, weekday: number, nth: number, base: Date): Date | null {
    if (nth === -1) {
      const last = new Date(year, month + 1, 0); // ngày cuối tháng
      const diff = (last.getDay() - weekday + 7) % 7;
      return new Date(year, month, last.getDate() - diff, base.getHours(), base.getMinutes());
    }
    const first = new Date(year, month, 1);
    const offset = (weekday - first.getDay() + 7) % 7;
    const day = 1 + offset + (nth - 1) * 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    if (day > daysInMonth) return null; // vd tháng không có "thứ Tư lần 5"
    return new Date(year, month, day, base.getHours(), base.getMinutes());
  }

  async createEvent(supabase: SupabaseClient, userId: string, userEmail: string, dto: CreateEventDto) {
    const calendarId = await this.getPrimaryCalendarId(supabase, userId);
    const rule = this.buildRule(dto);

    // Cảnh báo trùng lịch tính cho lần ĐẦU, TRƯỚC khi insert (để không tự trùng chính event vừa tạo)
    const conflicts = dto.isAllDay
      ? []
      : await this.findConflicts(supabase, calendarId, dto.startTime, dto.endTime);

    // Sinh danh sách các lần lặp (mỗi lần = 1 event thật). Không lặp -> chỉ 1 lần gốc.
    const occurrences = rule
      ? this.generateOccurrences(dto.startTime, dto.endTime, rule)
      : [{ start: dto.startTime, end: dto.endTime }];
    // Các lần lặp cùng 1 chuỗi có chung series_id (để sau này xóa cả chuỗi); không lặp -> null
    const seriesId = occurrences.length > 1 ? randomUUID() : null;

    const rows = occurrences.map((o) => ({
      calendar_id: calendarId,
      title: dto.title,
      description: dto.description ?? null,
      location: dto.location ?? null,
      start_time: o.start,
      end_time: o.end,
      is_all_day: dto.isAllDay ?? false,
      kind: dto.kind ?? 'event',
      color: dto.color ?? 'sky',
      reminder_minutes: dto.reminderMinutes ?? null,
      reminder_message: dto.reminderMessage?.trim() || null,
      series_id: seriesId,
      creator_id: userId,
      creator_email: userEmail || null,
    }));

    const { data: events, error } = await supabase.from('events').insert(rows).select();
    if (error) throw error;

    // Nhắc lịch linh hoạt: mỗi lần lặp nhận CÙNG bộ mốc nhắc (event_reminders).
    const reminderMins = this.normalizeReminders(dto.reminders);
    if (reminderMins.length) {
      const reminderRows = events.flatMap((ev: any) =>
        reminderMins.map((m) => ({ event_id: ev.id, minutes_before: m })),
      );
      const { error: remErr } = await supabase.from('event_reminders').insert(reminderRows);
      if (remErr) this.logger.warn(`Không lưu được mốc nhắc: ${remErr.message}`);
    }

    // Lần sớm nhất (event gốc) — trả về cho frontend + là nơi gửi email mời (tránh spam N lần)
    const first = [...events].sort(
      (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
    )[0];

    // Gán khách mời cho TẤT CẢ các lần lặp; chỉ gửi email mời cho lần đầu tiên
    if (dto.guestEmails?.length) {
      for (const ev of events) {
        const { added, grantedEditors } = await this.syncAttendees(supabase, ev.id, dto.guestEmails, dto.guestEditors ?? []);
        if (ev.id === first.id) {
          // Gửi email NGẦM (không await) -> phản hồi về frontend ngay, không phải chờ SMTP
          void this.sendInvites(ev.id, added, {
            title: dto.title,
            startTime: ev.start_time,
            location: dto.location ?? null,
          });
          this.sendEditorGrants(grantedEditors, dto.title, ev.start_time);
        }
      }
    }

    // Có đặt nhắc -> tự thêm chính người tạo vào danh sách để nhận email nhắc (mọi lần lặp).
    if (typeof dto.reminderMinutes === 'number') {
      for (const ev of events) {
        await this.ensureCreatorAttendee(supabase, ev.id, userEmail);
      }
    }

    const attendees = await this.getAttendees(supabase, first.id);
    const reminders = reminderMins.map((m) => ({ minutes_before: m }));
    return { event: { ...first, attendees, reminders }, conflicts };
  }

  /** Khách mời của sự kiện này có được cấp quyền CHỈNH SỬA (can_edit) không? */
  private async isAttendeeEditor(eventId: string, userEmail?: string): Promise<boolean> {
    const email = (userEmail ?? '').trim();
    if (!email) return false;
    const { data } = await this.supabaseService.adminClient
      .from('event_attendees')
      .select('can_edit')
      .eq('event_id', eventId)
      .ilike('email', email)
      .maybeSingle();
    return (data as any)?.can_edit === true;
  }

  async updateEvent(supabase: SupabaseClient, id: string, dto: UpdateEventDto, userId?: string, userEmail?: string) {
    const { data: existing, error: fetchError } = await supabase
      .from('events')
      .select('calendar_id, start_time, end_time, is_all_day, creator_id, series_id')
      .eq('id', id)
      .single();
    if (fetchError) throw fetchError;

    // QUYỀN: chỉ NGƯỜI TẠO mới được ĐỔI GIỜ bắt đầu/kết thúc. So sánh giá trị THỰC SỰ
    // thay đổi (không chỉ "có gửi lên"), vì form luôn gửi kèm start/end mỗi lần lưu ->
    // người khác vẫn sửa được tiêu đề/địa điểm... miễn là không dời giờ.
    const timeChanged =
      (dto.startTime !== undefined && new Date(dto.startTime).getTime() !== new Date(existing.start_time).getTime()) ||
      (dto.endTime !== undefined && new Date(dto.endTime).getTime() !== new Date(existing.end_time).getTime());
    // Khách được cấp quyền CHỈNH SỬA (can_edit, phase15) cũng được đổi giờ — nếu không,
    // họ kéo/sửa xong sẽ bị chặn và giao diện tự trả về giờ cũ (nhìn như "không sửa được").
    if (timeChanged && existing.creator_id && userId && existing.creator_id !== userId) {
      const isEditor = await this.isAttendeeEditor(id, userEmail);
      if (!isEditor) {
        throw new ForbiddenException('Chỉ người tạo hoặc khách được cấp quyền chỉnh sửa mới đổi được giờ của sự kiện này.');
      }
    }

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
    if (dto.reminderMinutes !== undefined) patch['reminder_minutes'] = dto.reminderMinutes;
    if (dto.reminderMessage !== undefined) patch['reminder_message'] = dto.reminderMessage?.trim() || null;
    if (typeof dto.completed === 'boolean') patch['completed'] = dto.completed;

    // Nếu KHÔNG có cột events nào đổi (vd chỉ đổi reminders/message qua bảng riêng) thì
    // không gọi update rỗng (Postgres trả 0 dòng -> bị hiểu nhầm là hết quyền) — chỉ đọc lại row.
    let event: any;
    if (Object.keys(patch).length > 0) {
      const { data, error } = await supabase.from('events').update(patch).eq('id', id).select().maybeSingle();
      if (error) throw error;
      if (!data) throw new ForbiddenException('Bạn không có quyền sửa sự kiện này.');
      event = data;
    } else {
      const { data, error } = await supabase.from('events').select().eq('id', id).maybeSingle();
      if (error) throw error;
      if (!data) throw new ForbiddenException('Bạn không có quyền sửa sự kiện này.');
      event = data;
    }

    // Thay TOÀN BỘ bộ mốc nhắc nếu client gửi lên (xóa cũ -> chèn mới; sent cũ tự cascade theo FK).
    if (dto.reminders !== undefined) {
      await supabase.from('event_reminders').delete().eq('event_id', id);
      const mins = this.normalizeReminders(dto.reminders);
      if (mins.length) {
        const { error: remErr } = await supabase
          .from('event_reminders')
          .insert(mins.map((m) => ({ event_id: id, minutes_before: m })));
        if (remErr) this.logger.warn(`Không cập nhật được mốc nhắc: ${remErr.message}`);
      }
    }

    // Dời GIỜ -> "arm" lại các mốc nhắc để gửi lại theo giờ mới (xóa dấu đã-gửi qua service_role).
    if (dto.startTime !== undefined) {
      const { data: rems } = await this.supabaseService.adminClient
        .from('event_reminders')
        .select('id')
        .eq('event_id', id);
      const ids = (rems ?? []).map((r: any) => r.id);
      if (ids.length) {
        await this.supabaseService.adminClient
          .from('event_reminder_sent')
          .delete()
          .in('reminder_id', ids);
      }
    }

    // Dời giờ hoặc đổi nhắc -> "arm" lại reminder (cho phép gửi nhắc lần nữa theo giờ mới).
    if (dto.startTime !== undefined || dto.reminderMinutes !== undefined) {
      await supabase
        .from('event_attendees')
        .update({ reminder_sent_at: null })
        .eq('event_id', id);
    }

    // ---------- LẶP LẠI KHI SỬA (phase #24) ----------
    // Độ lệch giờ giữa bản cũ và bản mới — dùng để dời cả chuỗi mà vẫn giữ khoảng cách.
    const deltaStart = new Date(event.start_time).getTime() - new Date(existing.start_time).getTime();
    const deltaEnd = new Date(event.end_time).getTime() - new Date(existing.end_time).getTime();

    // CASE A: sự kiện CHƯA thuộc chuỗi + người dùng chọn kiểu lặp -> sinh chuỗi mới TỪ sự kiện này.
    const rule = this.buildRule(dto as any);
    if (rule && !existing.series_id) {
      const seriesId = randomUUID();
      await supabase.from('events').update({ series_id: seriesId }).eq('id', id);
      event.series_id = seriesId;
      // Sinh các lần lặp theo giờ MỚI; bỏ lần đầu (chính là sự kiện đang sửa).
      const extra = this.generateOccurrences(event.start_time, event.end_time, rule).slice(1);
      if (extra.length) {
        const rows = extra.map((o) => ({
          calendar_id: event.calendar_id,
          title: event.title,
          description: event.description ?? null,
          location: event.location ?? null,
          start_time: o.start,
          end_time: o.end,
          is_all_day: event.is_all_day,
          kind: event.kind,
          color: event.color,
          reminder_minutes: event.reminder_minutes ?? null,
          reminder_message: event.reminder_message ?? null,
          series_id: seriesId,
          creator_id: event.creator_id,
          creator_email: event.creator_email ?? null,
        }));
        const { data: newEvents, error: genErr } = await supabase.from('events').insert(rows).select('id');
        if (genErr) this.logger.warn(`Không sinh được chuỗi lặp khi sửa: ${genErr.message}`);
        // Nhân bản bộ mốc nhắc (event_reminders) của sự kiện gốc cho mọi lần lặp mới.
        const { data: rems } = await supabase.from('event_reminders').select('minutes_before').eq('event_id', id);
        const mins = (rems ?? []).map((r: any) => r.minutes_before as number);
        if (mins.length && newEvents?.length) {
          const rrows = newEvents.flatMap((ne: any) => mins.map((m) => ({ event_id: ne.id, minutes_before: m })));
          await supabase.from('event_reminders').insert(rrows);
        }
      }
    }

    // CASE B: sửa CẢ CHUỖI -> áp nội dung + dời giờ (theo độ lệch) cho mọi sự kiện cùng series_id.
    if (dto.editScope === 'series' && existing.series_id) {
      const { data: siblings } = await supabase
        .from('events')
        .select('id, start_time, end_time')
        .eq('series_id', existing.series_id)
        .neq('id', id);
      for (const sib of siblings ?? []) {
        const p: Record<string, unknown> = {};
        if (dto.title !== undefined) p['title'] = event.title;
        if (dto.description !== undefined) p['description'] = event.description ?? null;
        if (dto.location !== undefined) p['location'] = event.location ?? null;
        if (dto.color !== undefined) p['color'] = event.color;
        if (dto.isAllDay !== undefined) p['is_all_day'] = event.is_all_day;
        if (dto.kind !== undefined) p['kind'] = event.kind;
        if (dto.reminderMinutes !== undefined) p['reminder_minutes'] = event.reminder_minutes ?? null;
        if (dto.reminderMessage !== undefined) p['reminder_message'] = event.reminder_message ?? null;
        if (deltaStart !== 0) p['start_time'] = new Date(new Date(sib.start_time).getTime() + deltaStart).toISOString();
        if (deltaEnd !== 0) p['end_time'] = new Date(new Date(sib.end_time).getTime() + deltaEnd).toISOString();
        if (Object.keys(p).length > 0) {
          await supabase.from('events').update(p).eq('id', sib.id);
        }
      }
    }

    // Đổi giờ/tiêu đề/địa điểm -> báo email CẬP NHẬT cho khách hiện có (tôn trọng preference).
    const meaningfulChange =
      dto.startTime !== undefined ||
      dto.endTime !== undefined ||
      dto.title !== undefined ||
      dto.location !== undefined;
    if (meaningfulChange) {
      const current = await this.getAttendees(supabase, id);
      for (const a of current) {
        if (await this.settings.isEmailEnabledForEmail(a.email, 'event_updated')) {
          void this.mail.sendEventUpdated({
            to: a.email,
            eventTitle: event.title,
            startTime: event.start_time,
            location: event.location ?? null,
          });
        }
      }
    }

    // Quản lý khách mời (thêm/gỡ/đổi quyền) CHỈ dành cho CHỦ sự kiện. Khách editor được
    // sửa nội dung nhưng KHÔNG quản khách -> bỏ qua syncAttendees để không đụng RLS.
    const isCreator = !existing.creator_id || !userId || existing.creator_id === userId;
    if (dto.guestEmails !== undefined && isCreator) {
      const { added, grantedEditors } = await this.syncAttendees(supabase, id, dto.guestEmails, dto.guestEditors ?? []);
      // Gửi email mời NGẦM cho khách MỚI thêm (không await -> phản hồi ngay, không chờ SMTP)
      void this.sendInvites(id, added, {
        title: event.title,
        startTime: event.start_time,
        location: event.location ?? null,
      });
      this.sendEditorGrants(grantedEditors, event.title, event.start_time);
    }

    // Nếu sự kiện có đặt nhắc, đảm bảo người tạo vẫn trong danh sách nhắc (kể cả sau khi
    // syncAttendees có thể đã loại bỏ họ khỏi danh sách khách mời gửi lên từ frontend).
    if (event.reminder_minutes != null) {
      await this.ensureCreatorAttendee(supabase, id, event.creator_email);
    }

    const attendees = await this.getAttendees(supabase, id);
    const { data: rems } = await supabase
      .from('event_reminders')
      .select('minutes_before')
      .eq('event_id', id);
    return { event: { ...event, attendees, reminders: rems ?? [] }, conflicts };
  }

  /**
   * XÓA MỀM: đưa vào thùng rác (đặt deleted_at = now). Không mất dữ liệu, có thể khôi phục.
   *
   * scope:
   *  - 'single' (mặc định): chỉ đúng sự kiện này.
   *  - 'series': mọi mắt cùng series_id.
   *  - 'range' : các mắt cùng series_id có ngày bắt đầu nằm TRONG khoảng [from, to].
   *              from/to là ngày dạng 'YYYY-MM-DD'; to được lấy trọn ngày (tới 23:59:59.999).
   *  - 'from'  : NGẮT LẶP — xoá mọi mắt từ ngày `from` TRỞ ĐI, các mắt trước đó giữ nguyên.
   *              Khác 'range' ở chỗ không cần biết ngày kết thúc của chuỗi.
   */
  async deleteEvent(
    supabase: SupabaseClient,
    id: string,
    scope: 'single' | 'series' | 'range' | 'from' = 'single',
    range?: { from: string; to?: string },
  ) {
    const deletedAt = new Date().toISOString();
    // Lấy thông tin sự kiện + khách mời TRƯỚC khi xóa mềm để còn gửi email huỷ.
    const { data: ev } = await supabase
      .from('events')
      .select('series_id, title, start_time, location')
      .eq('id', id)
      .maybeSingle();
    const attendees = await this.getAttendees(supabase, id);

    if (scope === 'series' && ev?.series_id) {
      const { error } = await supabase
        .from('events')
        .update({ deleted_at: deletedAt })
        .eq('series_id', ev.series_id)
        .is('deleted_at', null);
      if (error) throw error;
      void this.notifyCancelled(attendees, ev);
      return { seriesId: ev.series_id };
    }

    // Xoá các mắt của chuỗi: theo khoảng ngày ('range') hoặc từ 1 ngày trở đi ('from').
    if ((scope === 'range' || scope === 'from') && ev?.series_id && range) {
      // Dựng mốc theo giờ ĐỊA PHƯƠNG của server rồi đổi sang ISO, để 'to' bao trọn cả ngày.
      const fromTs = new Date(`${range.from}T00:00:00`);
      if (isNaN(fromTs.getTime())) {
        throw new BadRequestException('Ngày bắt đầu không hợp lệ');
      }

      let q = supabase
        .from('events')
        .update({ deleted_at: deletedAt })
        .eq('series_id', ev.series_id)
        .gte('start_time', fromTs.toISOString());

      // 'from' = ngắt lặp -> không chặn đầu trên, mọi mắt sau đó đều bị xoá.
      if (scope === 'range') {
        const toTs = new Date(`${range.to}T23:59:59.999`);
        if (isNaN(toTs.getTime())) {
          throw new BadRequestException('Ngày kết thúc không hợp lệ');
        }
        if (fromTs > toTs) {
          throw new BadRequestException('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc');
        }
        q = q.lte('start_time', toTs.toISOString());
      }

      const { data: removed, error } = await q.is('deleted_at', null).select('id');
      if (error) throw error;
      void this.notifyCancelled(attendees, ev);
      return { seriesId: ev.series_id, deletedCount: removed?.length ?? 0 };
    }

    // Mặc định: chỉ đưa 1 event vào thùng rác
    const { error } = await supabase.from('events').update({ deleted_at: deletedAt }).eq('id', id);
    if (error) throw error;
    void this.notifyCancelled(attendees, ev);
    return { id };
  }

  /** Gửi email báo được CẤP quyền chỉnh sửa sự kiện (bắn rồi quên). */
  private sendEditorGrants(emails: string[], title: string, startTime: string): void {
    for (const email of emails) {
      void this.mail.sendEventEditorGranted({ to: email, eventTitle: title, startTime });
    }
  }

  /** Gửi email HUỶ cho từng khách mời có bật preference 'event_cancelled'. */
  private async notifyCancelled(
    attendees: { email: string }[],
    ev: { title?: string; start_time?: string; location?: string | null } | null,
  ): Promise<void> {
    if (!ev) return;
    for (const a of attendees) {
      if (await this.settings.isEmailEnabledForEmail(a.email, 'event_cancelled')) {
        void this.mail.sendEventCancelled({
          to: a.email,
          eventTitle: ev.title ?? '',
          startTime: ev.start_time ?? new Date().toISOString(),
          location: ev.location ?? null,
        });
      }
    }
  }

  /** KHÔI PHỤC 1 sự kiện từ thùng rác (đặt lại deleted_at = null) */
  async restoreEvent(supabase: SupabaseClient, id: string) {
    const { data, error } = await supabase
      .from('events')
      .update({ deleted_at: null })
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new ForbiddenException('Bạn không có quyền khôi phục sự kiện này.');
    return { id };
  }

  /** XÓA VĨNH VIỄN 1 sự kiện trong thùng rác (xóa hẳn khỏi database, không khôi phục được) */
  async purgeEvent(supabase: SupabaseClient, id: string) {
    const { error } = await supabase.from('events').delete().eq('id', id).not('deleted_at', 'is', null);
    if (error) throw error;
    return { id };
  }

  /** User tự cập nhật trạng thái tham dự của mình (theo email). Nếu chưa là khách -> thêm vào. */
  async rsvp(supabase: SupabaseClient, eventId: string, email: string, status: string) {
    if (!email) throw new Error('Không xác định được email người dùng.');

    const { data: existing } = await supabase
      .from('event_attendees')
      .select('id')
      .eq('event_id', eventId)
      .eq('email', email)
      .maybeSingle();

    if (existing) {
      await supabase.from('event_attendees').update({ status }).eq('id', existing.id);
    } else {
      await supabase.from('event_attendees').insert({ event_id: eventId, email, status });
    }

    const attendees = await this.getAttendees(supabase, eventId);
    return { attendees };
  }

  private async getAttendees(supabase: SupabaseClient, eventId: string) {
    const { data, error } = await supabase.from('event_attendees').select('*').eq('event_id', eventId);
    if (error) throw error;
    return data ?? [];
  }

  /** Gắn link Google Meet vào 1 sự kiện (RLS đảm bảo chỉ chủ sự kiện cập nhật được). */
  async setMeetLink(supabase: SupabaseClient, id: string, meetLink: string) {
    const { data, error } = await supabase
      .from('events')
      .update({ meet_link: meetLink })
      .eq('id', id)
      .select('*, attendees:event_attendees(*)')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new ForbiddenException('Không cập nhật được link Meet cho sự kiện này.');
    return data;
  }

  /** Gỡ link Google Meet khỏi 1 sự kiện (đặt về null). */
  async removeMeetLink(supabase: SupabaseClient, id: string) {
    const { data, error } = await supabase
      .from('events')
      .update({ meet_link: null })
      .eq('id', id)
      .select('*, attendees:event_attendees(*)')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new ForbiddenException('Không gỡ được link Meet cho sự kiện này.');
    return data;
  }

  /**
   * Đảm bảo NGƯỜI TẠO có mặt trong danh sách khách mời (status 'accepted') để tự nhận email
   * nhắc lịch — kể cả khi sự kiện không mời ai khác. KHÔNG gửi email mời cho chính mình.
   * Bỏ qua nếu đã có (dùng lại record cũ, giữ nguyên trạng thái RSVP).
   */
  private async ensureCreatorAttendee(
    supabase: SupabaseClient,
    eventId: string,
    creatorEmail: string | null | undefined,
  ) {
    const email = (creatorEmail ?? '').trim();
    if (!email) return;
    const { data: existing } = await supabase
      .from('event_attendees')
      .select('email')
      .eq('event_id', eventId);
    const has = (existing ?? []).some((a) => a.email.toLowerCase() === email.toLowerCase());
    if (has) return;
    // status 'accepted' -> không cần RSVP; không có respond_token -> không phải khách mời "thật".
    await supabase.from('event_attendees').insert({ event_id: eventId, email, status: 'accepted' });
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
    editorEmails: string[] = [],
  ): Promise<{ added: { email: string; token: string }[]; grantedEditors: string[] }> {
    const { data: existing } = await supabase
      .from('event_attendees')
      .select('email, can_edit')
      .eq('event_id', eventId);
    const existingMap = new Map((existing ?? []).map((a) => [a.email.toLowerCase(), a]));
    const keepLower = new Set(emails.map((e) => e.toLowerCase()));
    const editorSet = new Set(editorEmails.map((e) => e.toLowerCase()));

    const toRemove = (existing ?? []).map((a) => a.email).filter((e) => !keepLower.has(e.toLowerCase()));
    if (toRemove.length) {
      await supabase.from('event_attendees').delete().eq('event_id', eventId).in('email', toRemove);
    }

    const added: { email: string; token: string }[] = [];
    // Email vừa được CẤP quyền chỉnh sửa (từ chưa có -> có), để báo cho họ.
    const grantedEditors: string[] = [];
    for (const email of emails) {
      const canEdit = editorSet.has(email.toLowerCase());
      const prev = existingMap.get(email.toLowerCase());
      if (prev) {
        // Đã là khách -> chỉ cập nhật quyền nếu đổi (bật/tắt chỉnh sửa).
        if ((prev as any).can_edit !== canEdit) {
          await supabase.from('event_attendees').update({ can_edit: canEdit }).eq('event_id', eventId).eq('email', email);
          if (canEdit) grantedEditors.push(email); // vừa nâng lên editor
        }
        continue;
      }
      const token = randomUUID();
      const tokenExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // hết hạn sau 7 ngày
      const { error } = await supabase.from('event_attendees').insert({
        event_id: eventId,
        email,
        status: 'needsAction',
        respond_token: token,
        token_expires_at: tokenExpires,
        can_edit: canEdit,
      });
      if (error) throw error;
      added.push({ email, token });
      if (canEdit) grantedEditors.push(email); // khách mới thêm thẳng làm editor
    }
    return { added, grantedEditors };
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
      // PHASE 5: tôn trọng email_preferences — người nhận là user đã tắt "lời mời" thì bỏ qua.
      if (!(await this.settings.isEmailEnabledForEmail(email, 'event_invitation'))) {
        continue;
      }
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

  /**
   * Trang XÁC NHẬN hiển thị khi khách bấm link trong email (GET). KHÔNG thay đổi dữ liệu —
   * chỉ hiện 1 nút; bấm nút mới POST để thực sự ghi nhận (chống trình quét email tự bấm).
   */
  respondConfirmPage(eventId: string, token: string, action: string): string {
    if (action !== 'accept' && action !== 'decline') {
      return this.responsePage('Liên kết không hợp lệ', 'Hành động không hợp lệ.');
    }
    if (!token) {
      return this.responsePage('Liên kết không hợp lệ', 'Thiếu mã xác nhận.');
    }
    const base = this.config.get<string>('PUBLIC_API_URL') ?? 'http://localhost:3000/api';
    const isAccept = action === 'accept';
    const label = isAccept ? 'ĐỒNG Ý tham gia' : 'TỪ CHỐI';
    const color = isAccept ? '#16a34a' : '#dc2626';
    return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Xác nhận phản hồi</title></head>
<body style="font-family:system-ui,Arial,sans-serif;background:#f8fafc;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0">
  <div style="background:#fff;padding:32px 40px;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.08);text-align:center;max-width:420px">
    <h1 style="font-size:20px;margin:0 0 14px;color:#0f172a">Xác nhận phản hồi lời mời</h1>
    <p style="color:#475569;margin:0 0 20px;line-height:1.5">Bấm nút bên dưới để <strong>${label}</strong> sự kiện này.</p>
    <form method="POST" action="${base}/events/${eventId}/respond-via-email">
      <input type="hidden" name="token" value="${token}">
      <input type="hidden" name="action" value="${action}">
      <button type="submit" style="background:${color};color:#fff;border:0;padding:12px 24px;border-radius:8px;font-size:15px;cursor:pointer">Xác nhận ${label}</button>
    </form>
  </div>
</body></html>`;
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
