// MailService: gói gọn việc gửi email qua SMTP (dùng nodemailer).
// Có thể dùng với bất kỳ nhà cung cấp SMTP nào: Gmail SMTP (kèm App Password),
// Mailtrap (khuyến nghị để TEST ở môi trường dev — email không gửi thật, chỉ xem trong
// hộp thư giả lập), Resend, SendGrid SMTP relay...
//
// Cấu hình qua các biến môi trường trong apps/api/.env:
//   SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

interface ReminderEmailParams {
  to: string;
  eventTitle: string;
  /** ISO string */
  startTime: string;
  location: string | null;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: nodemailer.Transporter;
  private readonly fromAddress: string;

  constructor(private readonly config: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: this.config.get<string>('SMTP_HOST'),
      port: Number(this.config.get<string>('SMTP_PORT') ?? 587),
      secure: this.config.get<string>('SMTP_SECURE') === 'true',
      auth: {
        user: this.config.get<string>('SMTP_USER'),
        pass: this.config.get<string>('SMTP_PASS'),
      },
    });

    this.fromAddress = this.config.get<string>('SMTP_FROM') ?? 'no-reply@calender-app.local';
  }

  async sendEventReminder(params: ReminderEmailParams): Promise<void> {
    const start = new Date(params.startTime);
    const timeLabel = start.toLocaleString('vi-VN', {
      weekday: 'long',
      day: 'numeric',
      month: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    const locationLine = params.location ? ` tại <strong>${params.location}</strong>` : '';

    await this.transporter.sendMail({
      from: this.fromAddress,
      to: params.to,
      subject: `Nhắc lịch: ${params.eventTitle}`,
      text: `Sự kiện "${params.eventTitle}" sẽ bắt đầu vào ${timeLabel}${params.location ? ` tại ${params.location}` : ''}.`,
      html: `<p>Sự kiện <strong>${params.eventTitle}</strong> sẽ bắt đầu vào <strong>${timeLabel}</strong>${locationLine}.</p>`,
    });

    this.logger.log(`Đã gửi email nhắc lịch tới ${params.to} — sự kiện "${params.eventTitle}"`);
  }
}
