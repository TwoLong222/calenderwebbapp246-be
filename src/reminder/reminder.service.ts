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

interface DueReminderRow {
  attendee_id: string;
  attendee_email: string;
  event_id: string;
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
  ) {}

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
