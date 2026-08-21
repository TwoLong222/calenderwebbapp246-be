// Chủ trang cập nhật cấu hình trang đặt lịch của mình.
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class UpdateBookingPageDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(40)
  @Matches(/^[a-z0-9-]+$/, { message: 'slug chỉ gồm chữ thường, số và dấu gạch ngang' })
  slug?: string;

  @IsOptional() @IsString() @MaxLength(80) title?: string;
  @IsOptional() @IsInt() @IsIn([15, 30, 60]) duration_minutes?: number;
  @IsOptional() @IsBoolean() enabled?: boolean;
}
