import { IsString, MaxLength, MinLength } from 'class-validator';

// CreateGroupDto — Dữ liệu để tạo nhóm mới (chỉ cần tên nhóm).
export class CreateGroupDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;
}
