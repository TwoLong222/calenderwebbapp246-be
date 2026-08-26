// DTO khi sửa sự kiện — kế thừa CreateEventDto nhưng mọi field đều optional
// (vì PATCH chỉ cần gửi những field muốn thay đổi, không cần gửi lại toàn bộ).

import { PartialType } from '@nestjs/mapped-types';
import { IsIn, IsOptional } from 'class-validator';
import { CreateEventDto } from './create-event.dto';

export class UpdateEventDto extends PartialType(CreateEventDto) {
  /**
   * Phạm vi áp dụng khi sửa 1 mắt trong CHUỖI LẶP:
   *  - 'single' (mặc định): chỉ sửa đúng sự kiện này.
   *  - 'series': áp dụng cho TẤT CẢ sự kiện cùng chuỗi (đổi nội dung + dời giờ theo cùng độ lệch).
   */
  @IsOptional()
  @IsIn(['single', 'series'])
  editScope?: 'single' | 'series';
}
