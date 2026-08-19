// SettingsService: đọc/ghi bảng user_settings.
//
// - Các API user dùng `supabase` (client gắn JWT -> RLS tự chặn cross-user).
// - Cron/hệ thống dùng adminGetSettings() qua adminClient (bypass RLS) để đọc
//   email_preferences trước khi gửi mail.
//
// KHÔNG tin dữ liệu frontend: timezone và default_calendar_id được validate ở đây.

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseService } from '../supabase/supabase.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';

// Giá trị mặc định (khớp DEFAULT trong migration) — dùng khi user chưa có hàng.
const DEFAULTS = {
  language: 'vi',
  timezone: 'Asia/Ho_Chi_Minh',
  date_format: 'DD/MM/YYYY',
  time_format: '24h',
  start_of_week: 1,
  default_calendar_view: 'week',
  default_calendar_id: null as string | null,
  working_days: [1, 2, 3, 4, 5],
  working_start: '08:00',
  working_end: '17:00',
  show_weekends: true,
  show_declined_events: false,
  show_completed_tasks: true,
  show_current_time: true,
  time_slot_duration: 30,
  theme: 'system',
  default_reminder: null as number | null,
  browser_notifications: false,
  event_default_privacy: 'private',
  email_preferences: {
    event_reminder: true,
    event_invitation: true,
    rsvp_update: true,
    event_updated: true,
    event_cancelled: true,
    booking_confirmation: true,
    booking_notification: true,
  },
  ai_settings: {
    enabled: true,
    allow_search: true,
    allow_create: true,
    allow_update: true,
    allow_delete: false,
  },
};

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  /** Lấy settings của user; nếu chưa có -> tạo hàng mặc định rồi trả về. */
  async getSettings(supabase: SupabaseClient, userId: string) {
    const { data, error } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (data) return data;

    // Chưa có -> tạo mặc định (RLS with_check đảm bảo user_id = auth.uid())
    const { data: created, error: insertError } = await supabase
      .from('user_settings')
      .insert({ user_id: userId })
      .select('*')
      .single();

    if (insertError) throw new BadRequestException(insertError.message);
    return created;
  }

  /** Cập nhật settings (merge JSON, validate timezone + quyền calendar). */
  async updateSettings(
    supabase: SupabaseClient,
    userId: string,
    dto: UpdateSettingsDto,
  ) {
    // Đảm bảo đã có hàng
    const current = await this.getSettings(supabase, userId);

    if (dto.timezone !== undefined && !this.isValidTimezone(dto.timezone)) {
      throw new BadRequestException(`Timezone không hợp lệ: ${dto.timezone}`);
    }

    if (
      dto.working_start !== undefined &&
      dto.working_end !== undefined &&
      dto.working_start >= dto.working_end
    ) {
      throw new BadRequestException('Giờ bắt đầu làm việc phải nhỏ hơn giờ kết thúc.');
    }

    if (dto.default_calendar_id) {
      await this.assertCalendarOwned(supabase, dto.default_calendar_id);
    }

    // Gom các cột scalar cần update
    const patch: Record<string, any> = {};
    const scalarKeys: (keyof UpdateSettingsDto)[] = [
      'language', 'timezone', 'date_format', 'time_format', 'start_of_week',
      'default_calendar_view', 'default_calendar_id', 'working_days',
      'working_start', 'working_end', 'show_weekends', 'show_declined_events',
      'show_completed_tasks', 'show_current_time', 'time_slot_duration',
      'theme', 'default_reminder', 'browser_notifications', 'event_default_privacy',
    ];
    for (const key of scalarKeys) {
      if (dto[key] !== undefined) patch[key] = dto[key];
    }

    // Merge JSON (không ghi đè toàn bộ — chỉ đổi key được gửi)
    if (dto.email_preferences !== undefined) {
      patch.email_preferences = {
        ...(current.email_preferences ?? DEFAULTS.email_preferences),
        ...dto.email_preferences,
      };
    }
    if (dto.ai_settings !== undefined) {
      patch.ai_settings = {
        ...(current.ai_settings ?? DEFAULTS.ai_settings),
        ...dto.ai_settings,
      };
    }

    if (Object.keys(patch).length === 0) return current;

    const { data, error } = await supabase
      .from('user_settings')
      .update(patch)
      .eq('user_id', userId)
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  /**
   * Đọc settings ở phía HỆ THỐNG (cron gửi email) bằng adminClient — bypass RLS.
   * Trả DEFAULTS nếu user chưa có hàng để cron vẫn chạy đúng.
   */
  async adminGetSettings(userId: string) {
    const { data, error } = await this.supabaseService.adminClient
      .from('user_settings')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      this.logger.warn(`adminGetSettings lỗi cho ${userId}: ${error.message}`);
      return { user_id: userId, ...DEFAULTS };
    }
    return data ?? { user_id: userId, ...DEFAULTS };
  }

  /** true nếu 1 loại email đang được BẬT cho user (mặc định bật nếu thiếu). */
  async isEmailEnabled(
    userId: string,
    key: keyof typeof DEFAULTS.email_preferences,
  ): Promise<boolean> {
    const settings = await this.adminGetSettings(userId);
    const prefs = settings.email_preferences ?? DEFAULTS.email_preferences;
    return prefs[key] !== false; // thiếu key -> coi như bật
  }

  /**
   * true nếu nên gửi 1 loại email tới địa chỉ `email`.
   * - Là user đã đăng ký và TẮT loại này -> false (không gửi).
   * - Khách ngoài (không phải user) -> true (vẫn gửi).
   * Map email->user_id được cache 60s để tránh gọi listUsers liên tục.
   */
  async isEmailEnabledForEmail(
    email: string,
    key: keyof typeof DEFAULTS.email_preferences,
  ): Promise<boolean> {
    const uid = await this.getUserIdByEmail(email);
    if (!uid) return true;
    return this.isEmailEnabled(uid, key);
  }

  private emailToId: { map: Map<string, string>; at: number } | null = null;

  private async getUserIdByEmail(email: string): Promise<string | null> {
    const now = Date.now();
    if (!this.emailToId || now - this.emailToId.at > 60_000) {
      const map = new Map<string, string>();
      try {
        const { data } =
          await this.supabaseService.adminClient.auth.admin.listUsers({
            page: 1,
            perPage: 1000,
          });
        for (const u of data?.users ?? []) {
          if (u.email) map.set(u.email.toLowerCase(), u.id);
        }
      } catch (e) {
        this.logger.warn(`listUsers lỗi: ${(e as Error).message}`);
      }
      this.emailToId = { map, at: now };
    }
    return this.emailToId.map.get(email.toLowerCase()) ?? null;
  }

  private isValidTimezone(tz: string): boolean {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }

  /** Đảm bảo calendar thuộc về user (RLS đã chặn, select trả rỗng = không có quyền). */
  private async assertCalendarOwned(supabase: SupabaseClient, calendarId: string) {
    const { data, error } = await supabase
      .from('calendars')
      .select('id')
      .eq('id', calendarId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new ForbiddenException('Bạn không có quyền với calendar này.');
  }
}
