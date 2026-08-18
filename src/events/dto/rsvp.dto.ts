// DTO cho endpoint RSVP: user tự cập nhật trạng thái tham dự của mình cho 1 event.
import { IsIn } from 'class-validator';

export class RsvpDto {
  @IsIn(['accepted', 'declined', 'tentative', 'needsAction'])
  status!: 'accepted' | 'declined' | 'tentative' | 'needsAction';
}
