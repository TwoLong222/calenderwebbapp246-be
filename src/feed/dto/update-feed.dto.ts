import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateFeedDto {
  /** Bật/tắt feed công khai. */
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  /** true = sinh token mới (thu hồi link cũ). */
  @IsOptional()
  @IsBoolean()
  rotate?: boolean;
}
