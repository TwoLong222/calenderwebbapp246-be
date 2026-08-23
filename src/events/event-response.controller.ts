// EventResponseController: endpoint CÔNG KHAI (KHÔNG có SupabaseAuthGuard) để xử lý
// khi khách mời bấm nút Đồng ý/Từ chối trong email. Xác thực bằng respond_token trong URL.
//
// QUAN TRỌNG (chống Gmail tự bấm link): các trình quét email (Gmail/antivirus) thường
// TỰ TRUY CẬP trước mọi link GET trong email -> nếu để GET thực hiện luôn thì sự kiện bị
// tự Đồng ý/Từ chối dù người dùng chưa bấm. Vì vậy:
//   - GET  = chỉ HIỆN trang xác nhận (không thay đổi gì).
//   - POST = mới thực sự ghi nhận phản hồi (người dùng phải bấm nút trên trang).

import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { EventsService } from './events.service';

@Controller('events')
export class EventResponseController {
  constructor(private readonly eventsService: EventsService) {}

  /** Bấm link trong email -> chỉ hiện trang xác nhận (an toàn với trình quét email). */
  @Get(':id/respond-via-email')
  confirmPage(
    @Param('id') id: string,
    @Query('token') token: string,
    @Query('action') action: string,
    @Res() res: Response,
  ): void {
    const html = this.eventsService.respondConfirmPage(id, token, action);
    res.type('html').send(html);
  }

  /** Người dùng bấm nút "Xác nhận" trên trang -> mới thật sự ghi nhận phản hồi. */
  @Post(':id/respond-via-email')
  async respond(
    @Param('id') id: string,
    @Body() body: { token?: string; action?: string },
    @Res() res: Response,
  ): Promise<void> {
    const html = await this.eventsService.respondViaToken(id, body?.token ?? '', body?.action ?? '');
    res.type('html').send(html);
  }
}
