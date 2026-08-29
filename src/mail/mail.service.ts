// MailService: gửi email cho ứng dụng lịch.
//
// CÓ 2 TẦNG VẬN CHUYỂN, tự chọn theo cấu hình .env:
//   1) GMAIL API (khuyến nghị — NHANH): gọi REST qua HTTPS (gmail.googleapis.com, cổng 443).
//      Né được chỗ nghẽn của SMTP -> gửi 1-3s ngay từ lần đầu.
//      Bật khi có đủ: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, GMAIL_SENDER.
//   2) SMTP (dự phòng): nodemailer + SMTP như trước (SMTP_HOST/PORT/USER/PASS...).
//      Tự dùng khi CHƯA cấu hình Gmail API -> không tính năng nào bị gãy.
//
// Nội dung/template email vẫn do nodemailer (MailComposer) dựng, dùng chung cho cả 2 tầng,
// nên đổi tầng vận chuyển KHÔNG ảnh hưởng giao diện email.

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as dns from 'node:dns';
import * as nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer';
import type Mail from 'nodemailer/lib/mailer';
import type SMTPPool from 'nodemailer/lib/smtp-pool';
import { auth as googleAuth, gmail_v1, gmail as gmailApi } from '@googleapis/gmail';

interface ReminderEmailParams {
  to: string;
  eventTitle: string;
  /** ISO string */
  startTime: string;
  location: string | null;
  /** Nội dung nhắc tùy chỉnh do người dùng nhập (nếu có) — hiện nổi bật trong email. */
  message?: string | null;
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

// Node 18+ mặc định trả IPv6 trước. Máy chủ không có IPv6 sẽ chết ngay ở bước kết nối,
// nên đặt IPv4 lên trước cho MỌI lệnh phân giải tên miền trong tiến trình này.
dns.setDefaultResultOrder('ipv4first');

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly fromAddress: string;

  /**
   * Tầng đang dùng:
   *  - 'brevo'   : gửi qua Brevo HTTP API (HTTPS 443) — KHÔNG bị chặn như SMTP trên Render free.
   *  - 'gmail-api': gửi qua Gmail REST (HTTPS 443).
   *  - 'smtp'    : nodemailer SMTP (dự phòng, dùng cho local — Render free chặn cổng SMTP).
   */
  private readonly mode: 'brevo' | 'gmail-api' | 'smtp';

  // Chỉ 1 nhánh được khởi tạo, tùy mode.
  private brevoApiKey?: string;
  private brevoSender?: { name?: string; email: string };
  private gmail?: gmail_v1.Gmail;
  private transporter?: nodemailer.Transporter;

  constructor(private readonly config: ConfigService) {
    const brevoKey = this.config.get<string>('BREVO_API_KEY');
    const clientId = this.config.get<string>('GMAIL_CLIENT_ID');
    const clientSecret = this.config.get<string>('GMAIL_CLIENT_SECRET');
    const refreshToken = this.config.get<string>('GMAIL_REFRESH_TOKEN');
    // Người gửi: ưu tiên GMAIL_SENDER, nếu không thì dùng SMTP_USER/SMTP_FROM cho tiện.
    const gmailSender =
      this.config.get<string>('GMAIL_SENDER') ??
      this.config.get<string>('SMTP_USER') ??
      this.config.get<string>('SMTP_FROM');

    if (brevoKey) {
      // ----- Tầng 0: BREVO API (HTTPS, né chặn SMTP của Render) -----
      this.brevoApiKey = brevoKey;
      // Email người gửi PHẢI là địa chỉ đã xác minh trong Brevo (Senders). Ưu tiên BREVO_SENDER,
      // rồi tới SMTP_FROM ("Tên <email>") / SMTP_USER / GMAIL_SENDER.
      const senderRaw =
        this.config.get<string>('BREVO_SENDER') ??
        this.config.get<string>('SMTP_FROM') ??
        this.config.get<string>('SMTP_USER') ??
        gmailSender ??
        '';
      const parsed = this.parseAddress(senderRaw);
      const email = parsed.email || this.config.get<string>('SMTP_USER') || '';
      this.brevoSender = { name: parsed.name || 'Lịch', email };
      this.fromAddress = senderRaw || email;
      this.mode = 'brevo';
      this.logger.log(`MailService dùng BREVO API (gửi qua HTTPS) — người gửi ${email}`);
    } else if (clientId && clientSecret && refreshToken && gmailSender) {
      // ----- Tầng 1: GMAIL API (nhanh) -----
      const oauth2 = new googleAuth.OAuth2(clientId, clientSecret);
      oauth2.setCredentials({ refresh_token: refreshToken });
      this.gmail = gmailApi({ version: 'v1', auth: oauth2 });
      this.fromAddress = gmailSender;
      this.mode = 'gmail-api';
      this.logger.log(`MailService dùng GMAIL API (gửi qua HTTPS) — người gửi ${gmailSender}`);
    } else {
      // ----- Tầng 2: SMTP (dự phòng) -----
      // family: 4 không nằm trong typings của nodemailer nhưng được chuyển thẳng xuống
      // net.connect, nên khai báo kiểu giao riêng ở đây thay vì ép kiểu bừa.
      const smtpOptions: SMTPPool.Options & { family?: number } = {
        host: this.config.get<string>('SMTP_HOST'),
        port: Number(this.config.get<string>('SMTP_PORT') ?? 587),
        secure: this.config.get<string>('SMTP_SECURE') === 'true',
        pool: true,
        maxConnections: 3,
        maxMessages: 100,
        // Máy chủ (vd Render) thường KHÔNG có đường ra IPv6. Không ép IPv4 thì Node phân
        // giải smtp.gmail.com ra địa chỉ IPv6 trước rồi chết với ENETUNREACH — nhìn giống
        // hệt lỗi sai mật khẩu nhưng thật ra chưa hề kết nối được tới Gmail.
        family: 4,
        connectionTimeout: 20000,
        greetingTimeout: 20000,
        socketTimeout: 30000,
        auth: {
          user: this.config.get<string>('SMTP_USER'),
          pass: this.config.get<string>('SMTP_PASS'),
        },
      };
      this.transporter = nodemailer.createTransport(smtpOptions);
      this.fromAddress = this.config.get<string>('SMTP_FROM') ?? 'no-reply@calender-app.local';
      this.mode = 'smtp';
      this.logger.warn(
        'MailService dùng SMTP (dự phòng, có thể chậm). Cấu hình GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN + GMAIL_SENDER để bật Gmail API nhanh hơn.',
      );
    }
  }

  /**
   * Gửi 1 email. Đây là ĐIỂM DUY NHẤT quyết định tầng vận chuyển — mọi hàm bên dưới đều gọi qua đây,
   * nên toàn bộ tính năng gửi mail dùng chung một đường và không bị lệch hành vi.
   */
  private async deliver(options: Mail.Options): Promise<boolean> {
    // AN TOÀN: nếu gửi lỗi (sai SMTP_USER/PASS, sai cấu hình Gmail, mất mạng...) thì CHỈ ghi log,
    // KHÔNG ném lỗi ra ngoài. Nhờ vậy một email hỏng KHÔNG BAO GIỜ làm sập cả server — kể cả khi
    // được gọi kiểu "bắn rồi quên" (void ...) hay trong cron. Endpoint test dùng deliverOrThrow.
    try {
      await this.deliverOrThrow(options);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Tách LỖI MẠNG khỏi LỖI ĐĂNG NHẬP: trước đây câu nào cũng bảo "kiểm tra
      // SMTP_USER/SMTP_PASS", nên lỗi không ra được Internet lại bị đi soi mật khẩu.
      const network =
        /ENETUNREACH|EHOSTUNREACH|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|ESOCKET/.test(message) ||
        /connection timeout|greeting never received|timed? ?out|socket close/i.test(message);
      const hint = network
        ? `Máy chủ KHÔNG kết nối được tới ${this.config.get<string>('SMTP_HOST') ?? 'SMTP host'}:${this.config.get<string>('SMTP_PORT') ?? '587'} — vấn đề MẠNG, không phải mật khẩu. Thường do nhà cung cấp chặn cổng SMTP hoặc không có IPv6. Cân nhắc dùng Gmail API (GMAIL_*) hoặc Brevo (BREVO_*) vì cả hai gửi qua HTTPS.`
        : `Kiểm tra SMTP_USER/SMTP_PASS (App Password Gmail 16 ký tự) hoặc cấu hình GMAIL_* trong .env.`;
      this.logger.error(
        `Gửi email tới "${options.to}" THẤT BẠI (tầng ${this.mode}): ${message}. ` +
          hint +
          ` Server vẫn chạy bình thường, chỉ email này không gửi được.`,
      );
      return false;
    }
  }

  /** Gửi email và NÉM lỗi nếu thất bại. Chỉ dùng cho endpoint test (/api/mail/test) để báo kết quả
   *  thật cho người gọi — NestJS tự bắt lỗi trong controller nên không làm sập tiến trình. */
  private async deliverOrThrow(options: Mail.Options): Promise<void> {
    const mail: Mail.Options = { from: this.fromAddress, ...options };

    if (this.mode === 'brevo' && this.brevoApiKey && this.brevoSender) {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': this.brevoApiKey,
          'Content-Type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          sender: this.brevoSender,
          to: this.toRecipients(mail.to),
          subject: typeof mail.subject === 'string' ? mail.subject : '',
          htmlContent: typeof mail.html === 'string' ? mail.html : undefined,
          textContent: typeof mail.text === 'string' ? mail.text : undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Brevo API ${res.status}: ${body.slice(0, 300)}`);
      }
      return;
    }

    if (this.mode === 'gmail-api' && this.gmail) {
      const raw = await this.buildRawMessage(mail);
      await this.gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
      return;
    }

    // SMTP dự phòng
    await this.transporter!.sendMail(mail);
  }

  /** Dựng email thành chuỗi MIME rồi mã hóa base64url — định dạng Gmail API yêu cầu. */
  private async buildRawMessage(mail: Mail.Options): Promise<string> {
    const message: Buffer = await new Promise((resolve, reject) => {
      new MailComposer(mail).compile().build((err, msg) => (err ? reject(err) : resolve(msg)));
    });
    return message
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  /** Tách "Tên <email@x>" hoặc "email@x" thành { name?, email }. */
  private parseAddress(input: string): { name?: string; email: string } {
    const s = (input ?? '').trim();
    const m = s.match(/^(.*)<([^>]+)>\s*$/);
    if (m) {
      const name = m[1].trim().replace(/^["']|["']$/g, '');
      return { name: name || undefined, email: m[2].trim() };
    }
    return { email: s };
  }

  /** Chuẩn hóa trường "to" của nodemailer thành mảng { email } cho Brevo (chỉ dùng chuỗi email). */
  private toRecipients(to: Mail.Options['to']): { email: string }[] {
    const raw =
      typeof to === 'string'
        ? to
        : Array.isArray(to)
          ? to.map((t) => (typeof t === 'string' ? t : (t as any)?.address ?? '')).join(',')
          : ((to as any)?.address ?? '');
    return raw
      .split(',')
      .map((p: string) => this.parseAddress(p))
      .filter((a: { email: string }) => !!a.email)
      .map((a: { email: string }) => ({ email: a.email }));
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
    const note = params.message?.trim();
    // Nếu người dùng nhập nội dung tùy chỉnh -> hiện dòng đó nổi bật ở đầu email.
    const noteLine = note ? `<p style="font-size:16px;color:#111827;margin:0 0 8px">📌 ${note}</p>` : '';
    const noteText = note ? `${note}\n` : '';

    const sent = await this.deliver({
      to: params.to,
      subject: `Nhắc lịch: ${note || title}`,
      text: `${noteText}Sự kiện "${title}" sẽ bắt đầu vào ${timeLabel}${params.location ? ` tại ${params.location}` : ''}.`,
      html: `${noteLine}<p>Sự kiện <strong>${title}</strong> sẽ bắt đầu vào <strong>${timeLabel}</strong>${locationLine}.</p>`,
    });

    if (sent) this.logger.log(`Đã gửi email nhắc lịch tới ${params.to} — sự kiện "${title}"`);
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
    const sent = await this.deliver({
      to: params.to,
      subject: `Tài liệu đã mở: ${title}`,
      text: `Tài liệu "${params.fileName}" của sự kiện "${title}" đã có thể xem/tải.${
        params.availableUntil ? ` Xem được đến ${new Date(params.availableUntil).toLocaleString('vi-VN')}.` : ''
      }`,
      html: `<p>Tài liệu <strong>${params.fileName}</strong> của sự kiện <strong>${title}</strong> đã có thể xem/tải${untilLine}.</p>`,
    });
    if (sent) this.logger.log(`Đã gửi email "tài liệu đã mở" tới ${params.to} — "${params.fileName}"`);
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

    const sent = await this.deliver({
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

    if (sent) this.logger.log(`Đã gửi email mời tới ${params.to} — sự kiện "${params.eventTitle}"`);
  }

  /** Email báo được người khác CHIA SẺ LỊCH cho mình. */
  async sendCalendarShared(params: { to: string; ownerEmail: string; role: 'viewer' | 'editor' }): Promise<void> {
    const roleLabel = params.role === 'editor' ? 'chỉnh sửa' : 'chỉ xem';
    const appUrl = (process.env.CORS_ORIGIN || '').split(',')[0].trim();
    const openBtn = appUrl
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-top:8px">
           <tr><td><a href="${appUrl}" style="display:block;text-align:center;padding:12px 0;border-radius:8px;background:#1d4ed8;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px">Mở lịch</a></td></tr>
         </table>`
      : '';
    const sent = await this.deliver({
      to: params.to,
      subject: `${params.ownerEmail} đã chia sẻ lịch với bạn`,
      text: `${params.ownerEmail} vừa chia sẻ lịch của họ với bạn (quyền: ${roleLabel}). Đăng nhập để xem.${appUrl ? `\n${appUrl}` : ''}`,
      html: `
      <div style="background:#f3f4f6;padding:24px 0;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
        <div style="max-width:480px;margin:0 auto">
          <div style="background:#0f766e;border-radius:12px 12px 0 0;padding:16px 28px">
            <span style="color:#ffffff;font-size:16px;font-weight:600;letter-spacing:.2px">👥 Chia sẻ lịch</span>
          </div>
          <div style="background:#ffffff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:28px">
            <p style="margin:0 0 6px;color:#6b7280;font-size:13px">Bạn được chia sẻ một lịch</p>
            <h1 style="margin:0 0 18px;font-size:20px;line-height:1.35;color:#111827">${params.ownerEmail}</h1>
            <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f9fafb;border-radius:10px;padding:6px 16px;margin-bottom:6px">
              <tr><td style="padding:6px 0;color:#374151;font-size:14px">🔑&nbsp;&nbsp;Quyền: <strong>${roleLabel}</strong></td></tr>
            </table>
            ${openBtn}
            <p style="margin:20px 0 0;color:#9ca3af;font-size:12px;line-height:1.5">Đăng nhập bằng chính email này để xem lịch được chia sẻ.</p>
          </div>
        </div>
      </div>
      `,
    });
    if (sent) this.logger.log(`Đã gửi email chia sẻ lịch tới ${params.to} (chủ: ${params.ownerEmail})`);
  }

  /**
   * Email báo được MỜI VÀO NHÓM. Trước đây mời nhóm chỉ ghi 1 dòng vào group_members,
   * không gửi mail gì — người được mời không mở web thì không hề biết.
   *
   * Không kèm nút Đồng ý/Từ chối như lời mời SỰ KIỆN: vào nhóm cần đăng nhập để thấy
   * lịch và khung chat của nhóm, nên chỉ dẫn họ mở app rồi bấm Đồng ý ở chuông.
   */
  async sendGroupInvite(params: { to: string; groupName: string; inviterEmail: string }): Promise<void> {
    const appUrl = (process.env.CORS_ORIGIN || '').split(',')[0].trim();
    const openBtn = appUrl
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-top:8px">
           <tr><td><a href="${appUrl}" style="display:block;text-align:center;padding:12px 0;border-radius:8px;background:#1d4ed8;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px">Mở lịch để phản hồi</a></td></tr>
         </table>`
      : '';
    const sent = await this.deliver({
      to: params.to,
      subject: `${params.inviterEmail} mời bạn vào nhóm "${params.groupName}"`,
      text: `${params.inviterEmail} vừa mời bạn vào nhóm "${params.groupName}". Đăng nhập bằng chính email này rồi bấm Đồng ý ở chuông thông báo.${appUrl ? `
${appUrl}` : ''}`,
      html: `
      <div style="background:#f3f4f6;padding:24px 0;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
        <div style="max-width:480px;margin:0 auto">
          <div style="background:#0f766e;border-radius:12px 12px 0 0;padding:16px 28px">
            <span style="color:#ffffff;font-size:16px;font-weight:600;letter-spacing:.2px">👥 Lời mời vào nhóm</span>
          </div>
          <div style="background:#ffffff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:28px">
            <p style="margin:0 0 6px;color:#6b7280;font-size:13px">Bạn được mời vào một nhóm</p>
            <h1 style="margin:0 0 18px;font-size:20px;line-height:1.35;color:#111827">${params.groupName}</h1>
            <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f9fafb;border-radius:10px;padding:6px 16px;margin-bottom:6px">
              <tr><td style="padding:6px 0;color:#374151;font-size:14px">✉️&nbsp;&nbsp;Người mời: <strong>${params.inviterEmail}</strong></td></tr>
            </table>
            ${openBtn}
            <p style="margin:20px 0 0;color:#9ca3af;font-size:12px;line-height:1.5">Đăng nhập bằng chính email này, lời mời sẽ hiện ở chuông thông báo để bạn bấm Đồng ý hoặc Từ chối.</p>
          </div>
        </div>
      </div>
      `,
    });
    if (sent) this.logger.log(`Đã gửi email mời nhóm "${params.groupName}" tới ${params.to}`);
  }

  /** Email báo được CẤP quyền CHỈNH SỬA một sự kiện. */
  async sendEventEditorGranted(params: { to: string; eventTitle: string; startTime: string }): Promise<void> {
    const timeLabel = this.formatTime(params.startTime);
    const sent = await this.deliver({
      to: params.to,
      subject: `Bạn được cấp quyền chỉnh sửa: ${params.eventTitle}`,
      text: `Bạn vừa được cấp quyền CHỈNH SỬA sự kiện "${params.eventTitle}" (${timeLabel}). Bạn có thể sửa tiêu đề, địa điểm, mô tả của sự kiện.`,
      html: `
      <div style="background:#f3f4f6;padding:24px 0;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
        <div style="max-width:480px;margin:0 auto">
          <div style="background:#7c3aed;border-radius:12px 12px 0 0;padding:16px 28px">
            <span style="color:#ffffff;font-size:16px;font-weight:600;letter-spacing:.2px">✏️ Quyền chỉnh sửa</span>
          </div>
          <div style="background:#ffffff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:28px">
            <p style="margin:0 0 6px;color:#6b7280;font-size:13px">Bạn được cấp quyền chỉnh sửa sự kiện</p>
            <h1 style="margin:0 0 18px;font-size:20px;line-height:1.35;color:#111827">${params.eventTitle}</h1>
            <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f9fafb;border-radius:10px;padding:6px 16px;margin-bottom:6px">
              <tr><td style="padding:6px 0;color:#374151;font-size:14px">🕐&nbsp;&nbsp;${timeLabel}</td></tr>
            </table>
            <p style="margin:18px 0 0;color:#6b7280;font-size:13px;line-height:1.5">Bạn có thể sửa tiêu đề, địa điểm và mô tả của sự kiện này.</p>
          </div>
        </div>
      </div>
      `,
    });
    if (sent) this.logger.log(`Đã gửi email cấp quyền chỉnh sửa tới ${params.to} — "${params.eventTitle}"`);
  }

  /** Email báo sự kiện được CẬP NHẬT (đổi giờ/tiêu đề/địa điểm) tới khách mời. */
  async sendEventUpdated(params: ReminderEmailParams): Promise<void> {
    const timeLabel = this.formatTime(params.startTime);
    const loc = params.location ? ` tại <strong>${params.location}</strong>` : '';
    const sent = await this.deliver({
      to: params.to,
      subject: `Cập nhật sự kiện: ${params.eventTitle}`,
      text: `Sự kiện "${params.eventTitle}" vừa được cập nhật. Thời gian: ${timeLabel}${params.location ? ` tại ${params.location}` : ''}.`,
      html: `<p>Sự kiện <strong>${params.eventTitle}</strong> vừa được cập nhật.</p><p>Thời gian mới: <strong>${timeLabel}</strong>${loc}.</p>`,
    });
    if (sent) this.logger.log(`Đã gửi email cập nhật tới ${params.to} — "${params.eventTitle}"`);
  }

  /** Email báo sự kiện bị HUỶ tới khách mời. */
  async sendEventCancelled(params: ReminderEmailParams): Promise<void> {
    const timeLabel = this.formatTime(params.startTime);
    const sent = await this.deliver({
      to: params.to,
      subject: `Huỷ sự kiện: ${params.eventTitle}`,
      text: `Sự kiện "${params.eventTitle}" (${timeLabel}) đã bị huỷ.`,
      html: `<p>Sự kiện <strong>${params.eventTitle}</strong> (${timeLabel}) đã bị <strong>huỷ</strong>.</p>`,
    });
    if (sent) this.logger.log(`Đã gửi email huỷ tới ${params.to} — "${params.eventTitle}"`);
  }

  /** Xác nhận đặt lịch cho người vừa đặt. */
  async sendBookingConfirmation(params: ReminderEmailParams): Promise<void> {
    const timeLabel = this.formatTime(params.startTime);
    const sent = await this.deliver({
      to: params.to,
      subject: `Xác nhận đặt lịch: ${params.eventTitle}`,
      text: `Bạn đã đặt lịch "${params.eventTitle}" vào ${timeLabel}. Hẹn gặp bạn!`,
      html: `<p>Bạn đã đặt lịch <strong>${params.eventTitle}</strong> vào <strong>${timeLabel}</strong>.</p><p>Hẹn gặp bạn!</p>`,
    });
    if (sent) this.logger.log(`Đã gửi xác nhận đặt lịch tới ${params.to}`);
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
    const sent = await this.deliver({
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

  /** Gửi 1 email test đơn giản — chỉ để kiểm tra cấu hình gửi mail có hoạt động không. */
  async sendTestEmail(to: string): Promise<void> {
    await this.deliverOrThrow({
      to,
      subject: 'Test gửi mail — Calendar App',
      text: `Nếu bạn nhận được email này, cấu hình gửi mail đã hoạt động ✅ (tầng: ${this.mode})`,
      html: `<p>Nếu bạn nhận được email này, cấu hình gửi mail đã hoạt động ✅</p><p style="color:#6b7280;font-size:12px">Tầng vận chuyển: <strong>${this.mode}</strong></p>`,
    });
    this.logger.log(`Đã gửi email test tới ${to} (tầng: ${this.mode})`);
  }
}
