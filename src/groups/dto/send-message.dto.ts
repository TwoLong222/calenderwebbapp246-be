import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

// SendMessageDto — Dữ liệu của một tin nhắn gửi vào nhóm.
export class SendMessageDto {
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(2000)
  content!: string;

  /** Trả lời tin nào (id tin gốc trong cùng nhóm). */
  @IsOptional()
  @IsUUID()
  replyToId?: string;
}
