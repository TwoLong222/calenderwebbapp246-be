import { IsString, MinLength } from 'class-validator';

// JoinGroupDto — Dữ liệu để tham gia nhóm bằng mã mời.
export class JoinGroupDto {
  @IsString()
  @MinLength(4)
  code!: string;
}
