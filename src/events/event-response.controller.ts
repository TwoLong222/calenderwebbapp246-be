// EventResponseController: endpoint CÔNG KHAI (KHÔNG có SupabaseAuthGuard) để xử lý
// khi khách mời bấm nút Đồng ý/Từ chối trong email. Xác thực bằng respond_token trong URL,
// không cần đăng nhập. Trả về 1 trang HTML đơn giản thông báo kết quả.
//
//   GET /api/events/:id/respond-via-email?token=xxx&action=accept
//   GET /api/events/:id/respond-via-email?token=xxx&action=decline

import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { EventsService } from './events.service';

@Controller('events')
export class EventResponseController {
  constructor(private readonly eventsService: EventsService) {}

  @Get(':id/respond-via-email')
  async respond(
    @Param('id') id: string,
    @Query('token') token: string,
    @Query('action') action: string,
    @Res() res: Response,
  ): Promise<void> {
    const html = await this.eventsService.respondViaToken(id, token, action);
    res.type('html').send(html);
  }
}
