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

interface InviteEmailParams {
  to: string;
  eventTitle: string;
  /** ISO string */
  startTime: string;
  location: string | null;
  /** Link bấm "Đồng ý" — GET, không cần đăng nhập */
  acceptUrl: string;
  /** Link bấm "Từ chối" — GET, không cần đăng nhập */
  declineUrl: string;
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

  /** Gửi email MỜI tham gia event, kèm 2 nút Đồng ý/Từ chối bấm ngay trong mail (không cần đăng nhập). */
  async sendEventInvite(params: InviteEmailParams): Promise<void> {
    const start = new Date(params.startTime);
    const timeLabel = start.toLocaleString('vi-VN', {
      weekday: 'long',
      day: 'numeric',
      month: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const locationLine = params.location ? `<p style="margin:4px 0">📍 ${params.location}</p>` : '';
    const button = (url: string, bg: string, label: string) =>
      `<a href="${url}" style="display:inline-block;padding:10px 22px;margin:4px;border-radius:6px;background:${bg};color:#ffffff;text-decoration:none;font-weight:bold">${label}</a>`;

    await this.transporter.sendMail({
      from: this.fromAddress,
      to: params.to,
      subject: `Lời mời tham gia: ${params.eventTitle}`,
      text: `Bạn được mời tham gia "${params.eventTitle}" vào ${timeLabel}.\nĐồng ý: ${params.acceptUrl}\nTừ chối: ${params.declineUrl}`,
      html: `
        <p>Bạn được mời tham gia sự kiện:</p>
        <h2 style="margin:4px 0">${params.eventTitle}</h2>
        <p style="margin:4px 0">🕐 <strong>${timeLabel}</strong></p>
        ${locationLine}
        <p style="margin-top:18px">
          ${button(params.acceptUrl, '#16a34a', '✔ Đồng ý')}
          ${button(params.declineUrl, '#dc2626', '✘ Từ chối')}
        </p>
        <p style="color:#888;font-size:12px;margin-top:16px">Bấm nút để phản hồi ngay, không cần đăng nhập.</p>
      `,
    });

    this.logger.log(`Đã gửi email mời tới ${params.to} — sự kiện "${params.eventTitle}"`);
  }

  /** Gửi 1 email test đơn giản — chỉ để kiểm tra cấu hình SMTP có hoạt động không. */
  async sendTestEmail(to: string): Promise<void> {
    await this.transporter.sendMail({
      from: this.fromAddress,
      to,
      subject: 'Test gửi mail — Calendar App',
      text: 'Nếu bạn nhận được email này, cấu hình SMTP đã hoạt động ✅',
      html: '<p>Nếu bạn nhận được email này, cấu hình SMTP đã hoạt động ✅</p>',
    });
    this.logger.log(`Đã gửi email test tới ${to}`);
  }
}
