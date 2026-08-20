// Người ngoài (không đăng nhập) đặt 1 lịch hẹn.
import { IsEmail, IsISO8601, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateBookingDto {
  @IsString() @MinLength(1) @MaxLength(80) name: string;
  @IsEmail() email: string;
  /** Giờ bắt đầu ISO của khung đã chọn */
  @IsISO8601() startTime: string;
}
