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

    for (const row of rows) {
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
}
