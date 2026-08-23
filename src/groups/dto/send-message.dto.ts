import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

// SendMessageDto — Dữ liệu của một tin nhắn gửi vào nhóm (nội dung tin).
export class SendMessageDto {
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(2000)
  content!: string;
}
