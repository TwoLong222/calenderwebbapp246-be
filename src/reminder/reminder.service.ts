// ReminderService: cron job chạy nền, cứ mỗi 5 phút quét 1 lần xem có khách mời nào
// cần gửi email nhắc lịch không (dựa vào hàm SQL get_due_event_reminders()), gửi email,
// rồi đánh dấu reminder_sent_at để không gửi trùng lần sau.
//
// Lưu ý: dùng adminClient (service_role key) vì đây là tác vụ hệ thống chạy nền,
// không gắn với phiên đăng nhập của bất kỳ user cụ thể nào — không có JWT để dùng RLS client.

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SupabaseService } from '../supabase/supabase.service';
import { MailService } from '../mail/mail.service';
import { SettingsService } from '../settings/settings.service';

interface DueReminderRow {
  attendee_id: string;
  attendee_email: string;
  event_id: string;
  event_title: string;
  start_time: string;
  location: string | null;
}

/** 1 mốc nhắc (event_reminders) đã tới giờ — từ RPC get_due_reminders(). */
interface DueReminderV2Row {
  reminder_id: string;
  event_id: string;
  event_title: string;
  reminder_message: string | null;
  start_time: string;
  location: string | null;
  creator_id: string | null;
  creator_email: string | null;
}

/** Sự kiện cần gửi email nhắc cho CHÍNH CHỦ (get_due_owner_reminders, phase11). */
interface OwnerReminderRow {
  event_id: string;
  owner_id: string;
  event_title: string;
  start_time: string;
  location: string | null;
}

@Injectable()
export class ReminderService {
  private readonly logger = new Logger(ReminderService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly mailService: MailService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * NHẮC LỊCH LINH HOẠT (Phase 8): mỗi PHÚT quét các mốc nhắc (event_reminders) tới giờ,
   * gửi SONG SONG (1) thông báo trong-app (bảng notifications -> chuông + toast realtime)
   * và (2) email. Người nhận = người tạo + khách đã Đồng ý. Mỗi (mốc nhắc, người nhận)
   * chỉ gửi 1 lần nhờ bảng event_reminder_sent.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async dispatchDueReminders(): Promise<void> {
    const admin = this.supabaseService.adminClient;
    const { data, error } = await admin.rpc('get_due_reminders');
    if (error) {
      this.logger.error('Không lấy được mốc nhắc tới hạn', error);
      return;
    }
    const rows = (data ?? []) as DueReminderV2Row[];
    if (rows.length === 0) return;

    for (const row of rows) {
      // Người nhận: người tạo + khách đã Đồng ý (map lower->email gốc để khử trùng).
      const recipients = new Map<string, string>();
      if (row.creator_email) recipients.set(row.creator_email.toLowerCase(), row.creator_email);
      const { data: atts } = await admin
        .from('event_attendees')
        .select('email, status')
        .eq('event_id', row.event_id);
      for (const a of atts ?? []) {
        if (a.status === 'accepted' && a.email) recipients.set(a.email.toLowerCase(), a.email);
      }
      if (recipients.size === 0) continue;

      // Đã gửi cho ai (với mốc nhắc này) rồi thì bỏ qua.
      const { data: sentRows } = await admin
        .from('event_reminder_sent')
        .select('email')
        .eq('reminder_id', row.reminder_id);
      const sent = new Set((sentRows ?? []).map((r: any) => (r.email as string).toLowerCase()));

      for (const [lower, email] of recipients) {
        if (sent.has(lower)) continue;

        // Ghi dấu đã gửi TRƯỚC (khóa (reminder_id,email)) -> chống gửi trùng khi 2 lần quét chồng nhau.
        const { error: markErr } = await admin
          .from('event_reminder_sent')
          .insert({ reminder_id: row.reminder_id, email });
        if (markErr) continue; // trùng khóa -> đã gửi -> bỏ qua

        // (1) Thông báo TRONG-APP nếu người nhận là user đã đăng ký.
        const uid = await this.settings.resolveUserIdByEmail(email);
        if (uid) {
          const title = row.reminder_message?.trim() || row.event_title || 'Sự kiện';
          await admin.from('notifications').insert({
            user_id: uid,
            type: 'reminder',
            title,
            body: this.startLabel(row.start_time),
            event_id: row.event_id,
          });
        }

        // (2) EMAIL (tôn trọng preference event_reminder).
        try {
          if (await this.settings.isEmailEnabledForEmail(email, 'event_reminder')) {
            await this.mailService.sendEventReminder({
              to: email,
              eventTitle: row.event_title,
              startTime: row.start_time,
              location: row.location,
              message: row.reminder_message,
            });
          }
        } catch (err) {
          this.logger.error(`Gửi email nhắc (linh hoạt) thất bại cho ${email}`, err as Error);
        }
      }
    }
  }

  private startLabel(iso: string): string {
    return `Bắt đầu lúc ${new Date(iso).toLocaleString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      day: 'numeric',
      month: 'numeric',
    })}`;
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async sendDueReminders(): Promise<void> {
    const { data, error } = await this.supabaseService.adminClient.rpc('get_due_event_reminders');

    if (error) {
      this.logger.error('Không lấy được danh sách nhắc lịch cần gửi', error);
      return;
    }

    const rows = (data ?? []) as DueReminderRow[];
    if (rows.length === 0) return;

    this.logger.log(`Tìm thấy ${rows.length} email nhắc lịch cần gửi`);

    // PHASE 5: tôn trọng email_preferences — email của user đã TẮT "event_reminder"
    // thì bỏ qua (vẫn đánh dấu reminder_sent_at để không quét lại vô hạn).
    const disabledEmails = await this.getReminderDisabledEmails();

    for (const row of rows) {
      if (disabledEmails.has(row.attendee_email.toLowerCase())) {
        await this.supabaseService.adminClient
          .from('event_attendees')
          .update({ reminder_sent_at: new Date().toISOString() })
          .eq('id', row.attendee_id);
        continue;
      }
      try {
        await this.mailService.sendEventReminder({
          to: row.attendee_email,
          eventTitle: row.event_title,
          startTime: row.start_time,
          location: row.location,
        });

        await this.supabaseService.adminClient
          .from('event_attendees')
          .update({ reminder_sent_at: new Date().toISOString() })
          .eq('id', row.attendee_id);
      } catch (err) {
        // Không đánh dấu reminder_sent_at nếu gửi thất bại -> lần quét kế tiếp (5 phút sau) sẽ thử lại
        this.logger.error(`Gửi email nhắc lịch thất bại cho ${row.attendee_email}`, err as Error);
      }
    }
  }

  /**
   * Cron RIÊNG: nhắc qua email cho CHÍNH CHỦ sự kiện (kể cả sự kiện cá nhân không mời ai).
   * Cần đã chạy migration 2026-08-phase11 (cột owner_reminder_sent_at + hàm get_due_owner_reminders).
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async sendDueOwnerReminders(): Promise<void> {
    const { data, error } = await this.supabaseService.adminClient.rpc('get_due_owner_reminders');
    if (error) {
      // Nhiều khả năng chưa chạy migration -> chỉ cảnh báo, không spam lỗi.
      this.logger.warn(`get_due_owner_reminders lỗi (đã chạy migration phase11 chưa?): ${error.message}`);
      return;
    }
    const rows = (data ?? []) as OwnerReminderRow[];
    if (rows.length === 0) return;
    this.logger.log(`Tìm thấy ${rows.length} email nhắc lịch (chủ sự kiện) cần gửi`);

    const { emailById, disabledIds } = await this.getUserEmailMap();

    for (const row of rows) {
      const markSent = () =>
        this.supabaseService.adminClient
          .from('events')
          .update({ owner_reminder_sent_at: new Date().toISOString() })
          .eq('id', row.event_id);

      const email = emailById.get(row.owner_id);
      // Không có email, hoặc chủ đã TẮT nhắc qua email -> đánh dấu để khỏi quét lại vô hạn.
      if (!email || disabledIds.has(row.owner_id)) {
        await markSent();
        continue;
      }
      try {
        await this.mailService.sendEventReminder({
          to: email,
          eventTitle: row.event_title,
          startTime: row.start_time,
          location: row.location,
        });
        await markSent();
      } catch (err) {
        // Gửi lỗi -> KHÔNG đánh dấu, lần quét sau (5 phút) thử lại.
        this.logger.error(`Gửi email nhắc (chủ sự kiện) thất bại cho ${email}`, err as Error);
      }
    }
  }

  /** Map user_id -> email, và tập user_id đã TẮT nhắc lịch qua email (dùng cho nhắc chủ sự kiện). */
  private async getUserEmailMap(): Promise<{ emailById: Map<string, string>; disabledIds: Set<string> }> {
    const emailById = new Map<string, string>();
    const disabledIds = new Set<string>();
    try {
      const { data: rows } = await this.supabaseService.adminClient
        .from('user_settings')
        .select('user_id, email_preferences');
      for (const r of (rows ?? []) as any[]) {
        if (r.email_preferences?.event_reminder === false) disabledIds.add(r.user_id as string);
      }
      const { data: list } = await this.supabaseService.adminClient.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });
      for (const u of list?.users ?? []) {
        if (u.email) emailById.set(u.id, u.email);
      }
    } catch (err) {
      this.logger.warn(`Không đọc được map user->email: ${(err as Error).message}`);
    }
    return { emailById, disabledIds };
  }

  /**
   * Trả về Set email (lowercase) của những user đã TẮT nhắc lịch qua email.
   * Bước 1: đọc user_settings có event_reminder = false.
   * Bước 2: map các user_id đó -> email qua Supabase Auth Admin.
   */
  private async getReminderDisabledEmails(): Promise<Set<string>> {
    const disabled = new Set<string>();
    try {
      const { data: rows } = await this.supabaseService.adminClient
        .from('user_settings')
        .select('user_id, email_preferences');

      const disabledIds = new Set(
        (rows ?? [])
          .filter((r: any) => r.email_preferences?.event_reminder === false)
          .map((r: any) => r.user_id as string),
      );
      if (disabledIds.size === 0) return disabled;

      const { data: list } =
        await this.supabaseService.adminClient.auth.admin.listUsers({
          page: 1,
          perPage: 1000,
        });
      for (const u of list?.users ?? []) {
        if (disabledIds.has(u.id) && u.email) disabled.add(u.email.toLowerCase());
      }
    } catch (err) {
      this.logger.warn(`Không đọc được email_preferences: ${(err as Error).message}`);
    }
    return disabled;
  }
}
