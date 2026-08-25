// DTO kiểm tra dữ liệu gửi lên khi tạo sự kiện mới.
// class-validator sẽ tự động chặn request nếu thiếu field bắt buộc hoặc sai kiểu dữ liệu,
// nhờ app.useGlobalPipes(new ValidationPipe(...)) đã bật trong main.ts.

import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateEventDto {
  @IsString()
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  /** Chuỗi ISO 8601, vd: "2026-08-10T10:00:00.000Z" — Angular tự tạo qua Date.toISOString() */
  @IsISO8601()
  startTime!: string;

  @IsISO8601()
  endTime!: string;

  @IsOptional()
  @IsBoolean()
  isAllDay?: boolean;

  @IsOptional()
  @IsIn(['event', 'task'])
  kind?: 'event' | 'task';

  @IsOptional()
  @IsIn(['sky', 'violet', 'emerald', 'rose', 'amber'])
  color?: string;

  @IsOptional()
  @IsArray()
  @IsEmail({}, { each: true })
  guestEmails?: string[];

  /** Kiểu lặp lại của sự kiện — 'none' hoặc không gửi = không lặp */
  @IsOptional()
  @IsIn(['none', 'daily', 'weekly', 'monthly'])
  repeat?: 'none' | 'daily' | 'weekly' | 'monthly';

  /** Số lần lặp (tính cả lần đầu). Tối đa 52 để tránh tạo quá nhiều. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(52)
  repeatCount?: number;

  /** (LEGACY) Nhắc trước bao nhiêu phút — giữ cho tương thích sự kiện cũ; FE mới dùng `reminders`. */
  @IsOptional()
  @IsInt()
  @IsIn([5, 10, 15, 30, 60, 1440])
  reminderMinutes?: number | null;

  /**
   * Danh sách các mốc nhắc (tính bằng PHÚT trước giờ bắt đầu). 0 = ngay lúc bắt đầu.
   * Mảng rỗng / không gửi = không nhắc. Tối đa 2.016.000 phút (200 tuần).
   */
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(2016000, { each: true })
  reminders?: number[];

  /** Nội dung thông báo tùy chỉnh khi tới giờ nhắc; để trống = dùng tên sự kiện. */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reminderMessage?: string;
}
