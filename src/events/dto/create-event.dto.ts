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
  Matches as MatchesRule,
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

  // Màu: hoặc 1 trong các tên dựng sẵn, hoặc mã hex người dùng TỰ CHỌN (#rgb / #rrggbb).
  // Regex đóng khung chặt để không nhận chuỗi lạ (tránh nhét CSS/HTML vào chỗ đổ màu).
  @IsOptional()
  @MatchesRule(/^(sky|violet|emerald|rose|amber|#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}))$/, {
    message: 'color phải là tên màu dựng sẵn hoặc mã hex dạng #rrggbb',
  })
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

  /** (LEGACY) Kiểu lặp lại cũ — 'none' hoặc không gửi = không lặp. FE mới dùng repeatFreq. */
  @IsOptional()
  @IsIn(['none', 'daily', 'weekly', 'monthly', 'yearly'])
  repeat?: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

  /** Tần suất lặp: ngày / tuần / tháng / năm. */
  @IsOptional()
  @IsIn(['daily', 'weekly', 'monthly', 'yearly'])
  repeatFreq?: 'daily' | 'weekly' | 'monthly' | 'yearly';

  /** Lặp mỗi N đơn vị (mặc định 1). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(999)
  repeatInterval?: number;

  /** (Lặp theo tuần) các thứ trong tuần được chọn — 0=CN ... 6=T7. */
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  repeatWeekdays?: number[];

  /** (Lặp theo tháng) theo NGÀY trong tháng, theo THỨ thứ-n, hoặc THỨ cuối cùng. */
  @IsOptional()
  @IsIn(['monthday', 'nthWeekday', 'lastWeekday'])
  repeatMonthlyMode?: 'monthday' | 'nthWeekday' | 'lastWeekday';

  /** Kết thúc "Sau N lần" — số lần lặp (tính cả lần đầu). Tối đa 366. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(366)
  repeatCount?: number;

  /** Kết thúc "Vào ngày" — mốc dừng (ISO). Không gửi = không giới hạn (bị chặn cứng ~2 năm). */
  @IsOptional()
  @IsISO8601()
  repeatUntil?: string;

  /** (LEGACY) Nhắc trước bao nhiêu phút — giữ cho tương thích sự kiện cũ; FE mới dùng `reminders`. */
  @IsOptional()
  @IsInt()
  @IsIn([5, 10, 15, 30, 60, 1440])
  reminderMinutes?: number | null;

  /** Task đã hoàn thành hay chưa. */
  @IsOptional()
  @IsBoolean()
  completed?: boolean;

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
