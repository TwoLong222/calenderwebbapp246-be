// FeedService: cấu hình feed lịch công khai (cho chủ) + sinh chuỗi .ics (cho người đăng ký).
//
// - Chủ: dùng client gắn JWT (RLS) để đọc/ghi calendar_feeds của mình (bật/tắt, đổi token).
// - Công khai (không đăng nhập): dùng adminClient (service_role) tìm feed theo token,
//   đọc sự kiện lịch chính rồi dựng chuỗi iCalendar (RFC 5545) trả về text/calendar.

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { UpdateFeedDto } from './dto/update-feed.dto';

/** Cửa sổ thời gian lấy sự kiện cho feed: 1 năm trước -> 2 năm sau (đủ cho lịch năm/thường niên). */
const PAST_DAYS = 365;
const FUTURE_DAYS = 730;
const MAX_EVENTS = 2000;

@Injectable()
export class FeedService {
  constructor(private readonly supabaseService: SupabaseService) {}

  private get admin() {
    return this.supabaseService.adminClient;
  }

  private newToken(): string {
    return randomBytes(24).toString('hex'); // 48 ký tự hex, không đoán được
  }

  // ---------------- CHỦ FEED ----------------

  /** Lấy feed của user; chưa có thì tạo (token ngẫu nhiên, mặc định TẮT). */
  async getOrCreateOwnFeed(supabase: SupabaseClient, userId: string) {
    const { data } = await supabase
      .from('calendar_feeds')
      .select('token, enabled')
      .eq('user_id', userId)
      .maybeSingle();
    if (data) return data;

    const { data: created, error } = await supabase
      .from('calendar_feeds')
      .insert({ user_id: userId, token: this.newToken() })
      .select('token, enabled')
      .single();
    if (error) throw new BadRequestException(error.message);
    return created;
  }

  /** Bật/tắt feed, hoặc đổi token mới (thu hồi link cũ). */
  async updateOwnFeed(supabase: SupabaseClient, userId: string, dto: UpdateFeedDto) {
    await this.getOrCreateOwnFeed(supabase, userId); // đảm bảo có hàng
    const patch: Record<string, any> = {};
    if (dto.enabled !== undefined) patch.enabled = dto.enabled;
    if (dto.rotate) patch.token = this.newToken(); // đổi token -> link cũ hết hiệu lực
    if (Object.keys(patch).length === 0) {
      return this.getOrCreateOwnFeed(supabase, userId);
    }
    const { data, error } = await supabase
      .from('calendar_feeds')
      .update(patch)
      .eq('user_id', userId)
      .select('token, enabled')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ---------------- CÔNG KHAI ----------------

  /** Trả chuỗi .ics cho token (bỏ hậu tố ".ics" nếu có). Feed tắt/không tồn tại -> 404. */
  async getIcs(rawToken: string): Promise<string> {
    const token = rawToken.replace(/\.ics$/i, '');
    const { data: feed } = await this.admin
      .from('calendar_feeds')
      .select('user_id, enabled')
      .eq('token', token)
      .eq('enabled', true)
      .maybeSingle();
    if (!feed) throw new NotFoundException('Feed không tồn tại hoặc đang tắt.');

    const { data: cal } = await this.admin
      .from('calendars')
      .select('id')
      .eq('owner_id', feed.user_id)
      .eq('is_primary', true)
      .maybeSingle();

    let events: any[] = [];
    if (cal) {
      const fromIso = new Date(Date.now() - PAST_DAYS * 86400000).toISOString();
      const toIso = new Date(Date.now() + FUTURE_DAYS * 86400000).toISOString();
      const { data } = await this.admin
        .from('events')
        .select('id, title, description, location, start_time, end_time, is_all_day, updated_at')
        .eq('calendar_id', cal.id)
        .is('deleted_at', null)
        .gte('start_time', fromIso)
        .lte('start_time', toIso)
        .order('start_time', { ascending: true })
        .limit(MAX_EVENTS);
      events = data ?? [];
    }

    return this.buildIcs(events);
  }

  // ---------------- dựng chuỗi iCalendar ----------------

  private buildIcs(events: any[]): string {
    const lines: string[] = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Lich App//Calendar Feed//VN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:Lịch của tôi',
    ];
    const stamp = this.toUtc(new Date());
    for (const e of events) {
      const start = new Date(e.start_time);
      const end = new Date(e.end_time);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) continue;
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${e.id}@lich-app`);
      lines.push(`DTSTAMP:${stamp}`);
      if (e.updated_at) lines.push(`LAST-MODIFIED:${this.toUtc(new Date(e.updated_at))}`);
      if (e.is_all_day) {
        // Cả ngày: DTEND theo chuẩn iCalendar là NGÀY KẾ TIẾP (exclusive).
        const endNext = new Date(end.getTime() + 86400000);
        lines.push(`DTSTART;VALUE=DATE:${this.toDate(start)}`);
        lines.push(`DTEND;VALUE=DATE:${this.toDate(endNext)}`);
      } else {
        lines.push(`DTSTART:${this.toUtc(start)}`);
        lines.push(`DTEND:${this.toUtc(end)}`);
      }
      lines.push(`SUMMARY:${this.esc(e.title || '(Không có tiêu đề)')}`);
      if (e.description) lines.push(`DESCRIPTION:${this.esc(e.description)}`);
      if (e.location) lines.push(`LOCATION:${this.esc(e.location)}`);
      lines.push('END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    // Gấp dòng theo chuẩn (mỗi dòng <= 75 octet) rồi nối bằng CRLF.
    return lines.map((l) => this.fold(l)).join('\r\n');
  }

  private toUtc(d: Date): string {
    return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  }
  private toDate(d: Date): string {
    return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  private esc(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  }
  /** Gấp dòng dài > 75 octet: các dòng nối bắt đầu bằng 1 dấu cách (RFC 5545). */
  private fold(line: string): string {
    if (Buffer.byteLength(line, 'utf8') <= 75) return line;
    const chunks: string[] = [];
    let buf = '';
    for (const ch of line) {
      if (Buffer.byteLength(buf + ch, 'utf8') > 74) {
        chunks.push(buf);
        buf = ' ' + ch; // dòng nối bắt đầu bằng khoảng trắng
      } else {
        buf += ch;
      }
    }
    if (buf) chunks.push(buf);
    return chunks.join('\r\n');
  }
}
