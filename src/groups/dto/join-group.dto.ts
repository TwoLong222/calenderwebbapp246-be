import { IsString, MinLength } from 'class-validator';

export class JoinGroupDto {
  @IsString()
  @MinLength(4)
  code!: string;
}
