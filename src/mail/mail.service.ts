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
      // Giữ sẵn kết nối và tái dùng cho các email sau -> nhanh hơn nhiều (không phải
      // bắt tay TLS lại từ đầu mỗi lần gửi, vốn rất chậm với SMTP Gmail).
      pool: true,
      maxConnections: 3,
      maxMessages: 100,
      // Không chờ vô hạn nếu mạng chậm/kẹt.
      connectionTimeout: 20000,
      greetingTimeout: 20000,
      socketTimeout: 30000,
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

    // Sự kiện không đặt tên -> hiện "(không tiêu đề)" cho khớp thông báo trong app.
    const title = params.eventTitle?.trim() || '(không tiêu đề)';
    const locationLine = params.location ? ` tại <strong>${params.location}</strong>` : '';

    await this.transporter.sendMail({
      from: this.fromAddress,
      to: params.to,
      subject: `Nhắc lịch: ${title}`,
      text: `Sự kiện "${title}" sẽ bắt đầu vào ${timeLabel}${params.location ? ` tại ${params.location}` : ''}.`,
      html: `<p>Sự kiện <strong>${title}</strong> sẽ bắt đầu vào <strong>${timeLabel}</strong>${locationLine}.</p>`,
    });

    this.logger.log(`Đã gửi email nhắc lịch tới ${params.to} — sự kiện "${title}"`);
  }

  /** Báo cho khách rằng tài liệu đính kèm của sự kiện đã tới giờ xem được. */
  async sendAttachmentAvailable(params: {
    to: string;
    eventTitle: string;
    fileName: string;
    /** ISO string, hạn xem tới lúc nào (nếu có). */
    availableUntil?: string | null;
  }): Promise<void> {
    const title = params.eventTitle?.trim() || '(không tiêu đề)';
    let untilLine = '';
    if (params.availableUntil) {
      const until = new Date(params.availableUntil).toLocaleString('vi-VN', {
        weekday: 'long', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit',
      });
      untilLine = ` (xem được đến <strong>${until}</strong>)`;
    }
    await this.transporter.sendMail({
      from: this.fromAddress,
      to: params.to,
      subject: `Tài liệu đã mở: ${title}`,
      text: `Tài liệu "${params.fileName}" của sự kiện "${title}" đã có thể xem/tải.${
        params.availableUntil ? ` Xem được đến ${new Date(params.availableUntil).toLocaleString('vi-VN')}.` : ''
      }`,
      html: `<p>Tài liệu <strong>${params.fileName}</strong> của sự kiện <strong>${title}</strong> đã có thể xem/tải${untilLine}.</p>`,
    });
    this.logger.log(`Đã gửi email "tài liệu đã mở" tới ${params.to} — "${params.fileName}"`);
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
    const locationRow = params.location
      ? `<tr><td style="padding:6px 0;color:#374151;font-size:14px">📍&nbsp;&nbsp;${params.location}</td></tr>`
      : '';

    await this.transporter.sendMail({
      from: this.fromAddress,
      to: params.to,
      subject: `Lời mời tham gia: ${params.eventTitle}`,
      text: `Bạn được mời tham gia "${params.eventTitle}" vào ${timeLabel}.\nĐồng ý: ${params.acceptUrl}\nTừ chối: ${params.declineUrl}`,
      html: `
      <div style="background:#f3f4f6;padding:24px 0;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
        <div style="max-width:480px;margin:0 auto">
          <!-- Thanh thương hiệu -->
          <div style="background:#1d4ed8;border-radius:12px 12px 0 0;padding:16px 28px">
            <span style="color:#ffffff;font-size:16px;font-weight:600;letter-spacing:.2px">📅 Lịch</span>
          </div>
          <!-- Thân card -->
          <div style="background:#ffffff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:28px">
            <p style="margin:0 0 6px;color:#6b7280;font-size:13px">Bạn được mời tham gia sự kiện</p>
            <h1 style="margin:0 0 18px;font-size:22px;line-height:1.3;color:#111827">${params.eventTitle}</h1>

            <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f9fafb;border-radius:10px;padding:6px 16px;margin-bottom:22px">
              <tr><td style="padding:6px 0;color:#374151;font-size:14px">🕐&nbsp;&nbsp;${timeLabel}</td></tr>
              ${locationRow}
            </table>

            <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%">
              <tr>
                <td style="padding-right:6px;width:50%">
                  <a href="${params.acceptUrl}" style="display:block;text-align:center;padding:12px 0;border-radius:8px;background:#16a34a;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px">Đồng ý tham gia</a>
                </td>
                <td style="padding-left:6px;width:50%">
                  <a href="${params.declineUrl}" style="display:block;text-align:center;padding:12px 0;border-radius:8px;background:#ffffff;border:1px solid #d1d5db;color:#374151;text-decoration:none;font-weight:600;font-size:15px">Từ chối</a>
                </td>
              </tr>
            </table>

            <p style="margin:20px 0 0;color:#9ca3af;font-size:12px;line-height:1.5">Bấm nút để phản hồi ngay — không cần đăng nhập. Lời mời hết hạn sau 7 ngày.</p>
          </div>
        </div>
      </div>
      `,
    });

    this.logger.log(`Đã gửi email mời tới ${params.to} — sự kiện "${params.eventTitle}"`);
  }

  /** Email báo sự kiện được CẬP NHẬT (đổi giờ/tiêu đề/địa điểm) tới khách mời. */
  async sendEventUpdated(params: ReminderEmailParams): Promise<void> {
    const timeLabel = this.formatTime(params.startTime);
    const loc = params.location ? ` tại <strong>${params.location}</strong>` : '';
    await this.transporter.sendMail({
      from: this.fromAddress,
      to: params.to,
      subject: `Cập nhật sự kiện: ${params.eventTitle}`,
      text: `Sự kiện "${params.eventTitle}" vừa được cập nhật. Thời gian: ${timeLabel}${params.location ? ` tại ${params.location}` : ''}.`,
      html: `<p>Sự kiện <strong>${params.eventTitle}</strong> vừa được cập nhật.</p><p>Thời gian mới: <strong>${timeLabel}</strong>${loc}.</p>`,
    });
    this.logger.log(`Đã gửi email cập nhật tới ${params.to} — "${params.eventTitle}"`);
  }

  /** Email báo sự kiện bị HUỶ tới khách mời. */
  async sendEventCancelled(params: ReminderEmailParams): Promise<void> {
    const timeLabel = this.formatTime(params.startTime);
    await this.transporter.sendMail({
      from: this.fromAddress,
      to: params.to,
      subject: `Huỷ sự kiện: ${params.eventTitle}`,
      text: `Sự kiện "${params.eventTitle}" (${timeLabel}) đã bị huỷ.`,
      html: `<p>Sự kiện <strong>${params.eventTitle}</strong> (${timeLabel}) đã bị <strong>huỷ</strong>.</p>`,
    });
    this.logger.log(`Đã gửi email huỷ tới ${params.to} — "${params.eventTitle}"`);
  }

  /** Xác nhận đặt lịch cho người vừa đặt. */
  async sendBookingConfirmation(params: ReminderEmailParams): Promise<void> {
    const timeLabel = this.formatTime(params.startTime);
    await this.transporter.sendMail({
      from: this.fromAddress,
      to: params.to,
      subject: `Xác nhận đặt lịch: ${params.eventTitle}`,
      text: `Bạn đã đặt lịch "${params.eventTitle}" vào ${timeLabel}. Hẹn gặp bạn!`,
      html: `<p>Bạn đã đặt lịch <strong>${params.eventTitle}</strong> vào <strong>${timeLabel}</strong>.</p><p>Hẹn gặp bạn!</p>`,
    });
    this.logger.log(`Đã gửi xác nhận đặt lịch tới ${params.to}`);
  }

  /** Báo cho CHỦ trang khi có người đặt lịch mới. */
  async sendBookingNotification(params: {
    to: string;
    inviteeName: string;
    inviteeEmail: string;
    eventTitle: string;
    startTime: string;
  }): Promise<void> {
    const timeLabel = this.formatTime(params.startTime);
    await this.transporter.sendMail({
      from: this.fromAddress,
      to: params.to,
      subject: `Đặt lịch mới: ${params.inviteeName}`,
      text: `${params.inviteeName} (${params.inviteeEmail}) vừa đặt "${params.eventTitle}" vào ${timeLabel}.`,
      html: `<p><strong>${params.inviteeName}</strong> (${params.inviteeEmail}) vừa đặt <strong>${params.eventTitle}</strong> vào <strong>${timeLabel}</strong>.</p>`,
    });
    this.logger.log(`Đã báo chủ trang ${params.to} về booking mới`);
  }

  private formatTime(iso: string): string {
    return new Date(iso).toLocaleString('vi-VN', {
      weekday: 'long',
      day: 'numeric',
      month: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
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
