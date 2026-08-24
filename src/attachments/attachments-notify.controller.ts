// /api/attachments/recent-available — tài liệu vừa mở gần đây cho các sự kiện user
// tham gia (dùng cho thông báo trong app). Yêu cầu đăng nhập.
import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { User } from '@supabase/supabase-js';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { AttachmentsService } from './attachments.service';

@UseGuards(SupabaseAuthGuard)
@Controller('attachments')
export class AttachmentsNotifyController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Get('recent-available')
  recent(@Req() req: any, @CurrentUser() user: User) {
    return this.attachments.recentAvailable(req.supabase, user.id);
  }

  /** Tất cả tài liệu của user, gom nhóm theo sự kiện — cho mục "Tệp đính kèm" trong Cài đặt. */
  @Get('by-event')
  byEvent(@Req() req: any, @CurrentUser() user: User) {
    return this.attachments.listAllForUser(req.supabase, user.id);
  }
}
