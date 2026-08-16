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

import { Injectable } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';

export interface ConflictRow {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
}

@Injectable()
export class EventsService {
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

    // Gán khách mời cho TẤT CẢ các lần lặp
    if (dto.guestEmails?.length) {
      for (const ev of events) {
        await this.syncAttendees(supabase, ev.id, dto.guestEmails);
      }
    }

    // Trả về lần sớm nhất (event gốc) để frontend hiển thị ngay
    const first = [...events].sort(
      (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
    )[0];
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
      await this.syncAttendees(supabase, id, dto.guestEmails);
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

  /** Cách đơn giản nhất: xóa hết attendee cũ rồi thêm lại danh sách mới. Đủ dùng cho quy mô hiện tại. */
  private async syncAttendees(supabase: SupabaseClient, eventId: string, emails: string[]) {
    await supabase.from('event_attendees').delete().eq('event_id', eventId);
    if (emails.length === 0) return;

    const rows = emails.map((email) => ({ event_id: eventId, email, status: 'needsAction' as const }));
    const { error } = await supabase.from('event_attendees').insert(rows);
    if (error) throw error;
  }
}
