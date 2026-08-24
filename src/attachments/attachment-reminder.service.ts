// AttachmentReminderService: cron nền, mỗi 5 phút quét các tài liệu đính kèm vừa
// TỚI GIỜ MỞ (available_from <= now) mà chưa thông báo (notified_at null), rồi gửi
// EMAIL cho khách tham gia sự kiện + đánh dấu notified_at để không gửi trùng.
//
// Phần thông báo TRONG APP do client tự quét (endpoint /attachments/recent-available) —
// đây chỉ lo phần email chạy nền (khách không cần mở app vẫn nhận được).

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SupabaseService } from '../supabase/supabase.service';
import { MailService } from '../mail/mail.service';

@Injectable()
export class AttachmentReminderService {
  private readonly logger = new Logger(AttachmentReminderService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly mailService: MailService,
  ) {}

  private get admin() {
    return this.supabaseService.adminClient;
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async notifyDueAttachments(): Promise<void> {
    const nowIso = new Date().toISOString();

    const { data, error } = await this.admin
      .from('event_attachments')
      .select('id, event_id, file_name, available_from, available_until, notified_at')
      .not('available_from', 'is', null)
      .is('notified_at', null)
      .lte('available_from', nowIso);

    if (error) {
      // Cột chưa tồn tại (migration chưa chạy) -> im lặng bỏ qua.
      if (/available_from|notified_at|column/i.test(error.message)) return;
      // Lệch giờ máy <-> Supabase (PGRST303 "JWT issued at future") -> tạm thời, chỉ cảnh báo.
      if ((error as any).code === 'PGRST303' || /issued at future|jwt/i.test(error.message)) {
        this.logger.warn(`Bỏ qua lượt quét: lệch giờ máy/Supabase (${error.message}). Kiểm tra đồng hồ hệ thống.`);
        return;
      }
      this.logger.error('Không quét được tài liệu tới giờ mở', error);
      return;
    }

    const rows = (data ?? []) as {
      id: string;
      event_id: string;
      file_name: string;
      available_until: string | null;
    }[];
    if (rows.length === 0) return;

    this.logger.log(`Có ${rows.length} tài liệu vừa tới giờ mở -> gửi thông báo`);

    for (const row of rows) {
      try {
        const { data: ev } = await this.admin
          .from('events')
          .select('title')
          .eq('id', row.event_id)
          .maybeSingle();
        const { data: guests } = await this.admin
          .from('event_attendees')
          .select('email')
          .eq('event_id', row.event_id);

        const emails = [...new Set((guests ?? []).map((g: any) => (g.email as string).toLowerCase()))];
        for (const to of emails) {
          await this.mailService.sendAttachmentAvailable({
            to,
            eventTitle: ev?.title ?? '',
            fileName: row.file_name,
            availableUntil: row.available_until,
          });
        }

        await this.admin
          .from('event_attachments')
          .update({ notified_at: new Date().toISOString() })
          .eq('id', row.id);
      } catch (err) {
        // Không đánh dấu -> lần quét sau thử lại.
        this.logger.error(`Gửi thông báo tài liệu "${row.file_name}" thất bại`, err as Error);
      }
    }
  }
}
