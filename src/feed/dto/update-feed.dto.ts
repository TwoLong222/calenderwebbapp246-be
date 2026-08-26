import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateFeedDto {
  /** Bật/tắt feed công khai. */
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  /** true = sinh token mới (thu hồi link cũ). */
  @IsOptional()
  @IsBoolean()
  rotate?: boolean;

  /** Chỉ chia sẻ sự kiện TỪ mốc này (ISO). Rỗng = không giới hạn đầu. */
  @IsOptional()
  @IsString()
  feedFrom?: string | null;

  /** Chỉ chia sẻ sự kiện ĐẾN mốc này (ISO). Rỗng = không giới hạn cuối. */
  @IsOptional()
  @IsString()
  feedUntil?: string | null;
}
