// DTO cập nhật settings (PATCH) — mọi field optional, chỉ gửi field muốn đổi.
// Validate chặt: enum bằng @IsIn, số/bool đúng kiểu, nested object cho email/ai.
// Backend KHÔNG tin dữ liệu frontend — sai giá trị -> 400.

import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

class EmailPreferencesDto {
  @IsOptional() @IsBoolean() event_reminder?: boolean;
  @IsOptional() @IsBoolean() event_invitation?: boolean;
  @IsOptional() @IsBoolean() rsvp_update?: boolean;
  @IsOptional() @IsBoolean() event_updated?: boolean;
  @IsOptional() @IsBoolean() event_cancelled?: boolean;
  @IsOptional() @IsBoolean() booking_confirmation?: boolean;
  @IsOptional() @IsBoolean() booking_notification?: boolean;
}

class AiSettingsDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsBoolean() allow_search?: boolean;
  @IsOptional() @IsBoolean() allow_create?: boolean;
  @IsOptional() @IsBoolean() allow_update?: boolean;
  @IsOptional() @IsBoolean() allow_delete?: boolean;
}

export class UpdateSettingsDto {
  // General
  @IsOptional() @IsIn(['vi', 'en']) language?: string;
  @IsOptional() @IsString() timezone?: string; // IANA — kiểm tra hợp lệ ở service
  @IsOptional() @IsIn(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']) date_format?: string;
  @IsOptional() @IsIn(['12h', '24h']) time_format?: string;
  @IsOptional() @IsInt() @IsIn([0, 1]) start_of_week?: number;

  // Calendar
  @IsOptional() @IsIn(['day', 'week', 'month', 'year']) default_calendar_view?: string;
  @IsOptional() @IsString() default_calendar_id?: string | null; // kiểm tra quyền ở service
  @IsOptional() @IsArray() @ArrayMaxSize(7) @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true })
  working_days?: number[];
  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'working_start phải dạng HH:MM' })
  working_start?: string;
  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'working_end phải dạng HH:MM' })
  working_end?: string;
  @IsOptional() @IsBoolean() show_weekends?: boolean;
  @IsOptional() @IsBoolean() show_declined_events?: boolean;
  @IsOptional() @IsBoolean() show_completed_tasks?: boolean;
  @IsOptional() @IsBoolean() show_current_time?: boolean;
  @IsOptional() @IsInt() @IsIn([15, 30, 60]) time_slot_duration?: number;

  // Appearance
  @IsOptional() @IsIn(['light', 'dark', 'system']) theme?: string;

  // Notifications
  @IsOptional() @IsInt() @IsIn([5, 10, 15, 30, 60, 1440]) default_reminder?: number | null;
  @IsOptional() @IsBoolean() browser_notifications?: boolean;

  // Privacy
  @IsOptional() @IsIn(['private', 'public']) event_default_privacy?: string;

  // Nested JSON
  @IsOptional() @IsObject() @ValidateNested() @Type(() => EmailPreferencesDto)
  email_preferences?: EmailPreferencesDto;
  @IsOptional() @IsObject() @ValidateNested() @Type(() => AiSettingsDto)
  ai_settings?: AiSettingsDto;
}
