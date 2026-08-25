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

  /** Tập con của guestEmails được quyền CHỈNH SỬA sự kiện (can_edit=true). Còn lại = chỉ xem. */
  @IsOptional()
  @IsArray()
  @IsEmail({}, { each: true })
  guestEditors?: string[];

  /** Kiểu lặp lại của sự kiện — 'none' hoặc không gửi = không lặp */
  @IsOptional()
  @IsIn(['none', 'daily', 'weekly', 'monthly', 'yearly'])
  repeat?: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

  /** Số lần lặp (tính cả lần đầu). Tối đa 52 để tránh tạo quá nhiều. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(52)
  repeatCount?: number;

  /** Chu kỳ: lặp mỗi N đơn vị (mỗi 2 tuần, mỗi 3 ngày...). Mặc định 1. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  repeatInterval?: number;

  /** Nhắc trước bao nhiêu phút (null/không gửi = không nhắc). */
  @IsOptional()
  @IsInt()
  @IsIn([5, 10, 15, 30, 60, 1440])
  reminderMinutes?: number | null;

  /** Task đã hoàn thành hay chưa. */
  @IsOptional()
  @IsBoolean()
  completed?: boolean;
}
