// Chủ trang cập nhật cấu hình trang đặt lịch của mình.
import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class UpdateBookingPageDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(40)
  @Matches(/^[a-z0-9-]+$/, { message: 'slug chỉ gồm chữ thường, số và dấu gạch ngang' })
  slug?: string;

  @IsOptional() @IsString() @MaxLength(80) title?: string;
  /** Thời lượng mỗi lịch hẹn — TỰ DO trong khoảng 5..480 phút (khớp check ở DB, phase16). */
  @IsOptional() @IsInt() @Min(5) @Max(480) duration_minutes?: number;
  @IsOptional() @IsBoolean() enabled?: boolean;
}
