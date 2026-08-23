import { ArrayMaxSize, IsArray, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class AiChatTurnDto {
  @IsIn(['user', 'assistant']) role!: 'user' | 'assistant';
  @IsString() @MaxLength(1000) text!: string;
}

export class AiChatDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  message!: string;

  /** Vài lượt hội thoại gần nhất (để AI hiểu ngữ cảnh). Tùy chọn. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => AiChatTurnDto)
  history?: AiChatTurnDto[];
}
