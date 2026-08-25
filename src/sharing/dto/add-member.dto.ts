import { IsEmail, IsIn, IsOptional, IsString } from 'class-validator';

export class AddMemberDto {
  @IsEmail() email: string;
  @IsOptional() @IsIn(['viewer', 'editor']) role?: 'viewer' | 'editor';
  /** Chỉ chia sẻ sự kiện TỪ mốc này (ISO). Rỗng/không gửi = không giới hạn đầu. */
  @IsOptional() @IsString() shareFrom?: string | null;
  /** Chỉ chia sẻ sự kiện ĐẾN mốc này (ISO). Rỗng/không gửi = không giới hạn cuối. */
  @IsOptional() @IsString() shareUntil?: string | null;
}
