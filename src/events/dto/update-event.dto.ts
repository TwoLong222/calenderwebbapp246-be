// DTO khi sửa sự kiện — kế thừa CreateEventDto nhưng mọi field đều optional
// (vì PATCH chỉ cần gửi những field muốn thay đổi, không cần gửi lại toàn bộ).

import { PartialType } from '@nestjs/mapped-types';
import { CreateEventDto } from './create-event.dto';

export class UpdateEventDto extends PartialType(CreateEventDto) {}
