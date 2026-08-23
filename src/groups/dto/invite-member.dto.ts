import { IsEmail } from 'class-validator';

// InviteMemberDto — Dữ liệu để mời một người vào nhóm (email của họ).
export class InviteMemberDto {
  @IsEmail()
  email!: string;
}
