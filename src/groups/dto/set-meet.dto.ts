import { IsUrl, MaxLength } from 'class-validator';

// SetMeetDto — Dữ liệu để gắn link Google Meet vào một sự kiện nhóm.
export class SetMeetDto {
  @IsUrl()
  @MaxLength(500)
  meetLink!: string;
}
