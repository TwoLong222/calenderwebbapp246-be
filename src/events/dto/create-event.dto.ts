// DTO kiểm tra dữ liệu gửi lên khi tạo sự kiện mới.
// class-validator sẽ tự động chặn request nếu thiếu field bắt buộc hoặc sai kiểu dữ liệu,
// nhờ app.useGlobalPipes(new ValidationPipe(...)) đã bật trong main.ts.

import { IsArray, IsBoolean, IsEmail, IsIn, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

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
  @IsArray()
  @IsEmail({}, { each: true })
  guestEmails?: string[];
}
