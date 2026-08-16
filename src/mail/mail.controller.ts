// MailController: endpoint TIỆN TEST cấu hình SMTP.
//
// GET /api/mail/test?to=email-nhan@gmail.com
//   -> gửi ngay 1 email test tới địa chỉ đó (không cần chờ cron reminder).
//   -> nếu không truyền ?to=... thì gửi về chính SMTP_USER.
//
// AN TOÀN: endpoint này CHỈ hoạt động khi NODE_ENV != 'production'. Khi deploy thật
// (NODE_ENV=production) nó tự trả 403 để không ai spam qua Gmail của bạn.

import { Controller, ForbiddenException, Get, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';

@Controller('mail')
export class MailController {
  constructor(
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  @Get('test')
  async test(@Query('to') to?: string) {
    if (this.config.get<string>('NODE_ENV') === 'production') {
      throw new ForbiddenException('Endpoint test chỉ dùng ở môi trường development.');
    }

    const recipient = to || this.config.get<string>('SMTP_USER');
    if (!recipient) {
      return { ok: false, error: 'Thiếu email nhận. Gọi kèm ?to=email@gmail.com hoặc điền SMTP_USER trong .env.' };
    }

    try {
      await this.mail.sendTestEmail(recipient);
      return { ok: true, sentTo: recipient };
    } catch (e) {
      // Trả lỗi SMTP ra luôn để dễ chẩn đoán (vd sai App Password, chặn cổng...).
      return { ok: false, error: (e as Error).message };
    }
  }
}
