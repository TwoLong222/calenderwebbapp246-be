// SharingService: chủ lịch quản lý thành viên được chia sẻ (theo email + vai trò),
// và liệt kê các lịch được chia sẻ CHO mình.
//
// Dùng `supabase` gắn JWT của user (RLS): chủ chỉ thao tác trên lịch chính của mình,
// RLS bảo đảm không ai sửa thành viên của lịch người khác.

import { BadRequestException, Injectable } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AddMemberDto } from './dto/add-member.dto';
import { MailService } from '../mail/mail.service';

@Injectable()
export class SharingService {
  constructor(private readonly mail: MailService) {}

  /** Danh sách thành viên được chia sẻ trên LỊCH CHÍNH của user. */
  async getMembers(supabase: SupabaseClient, userId: string) {
    const calId = await this.primaryCalendarId(supabase, userId);
    const { data, error } = await supabase
      .from('calendar_members')
      .select('member_email, role, created_at, share_from, share_until')
      .eq('calendar_id', calId)
      .order('created_at', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  /** Thêm/đổi vai trò 1 thành viên (theo email) cho lịch chính của user. */
  async addMember(
    supabase: SupabaseClient,
    userId: string,
    userEmail: string,
    dto: AddMemberDto,
  ) {
    const email = dto.email.toLowerCase().trim();
    if (email === (userEmail ?? '').toLowerCase()) {
      throw new BadRequestException('Không thể chia sẻ lịch cho chính mình.');
    }
    const calId = await this.primaryCalendarId(supabase, userId);
    // Kiểm tra đã là thành viên chưa -> chỉ gửi email khi là chia sẻ MỚI (không spam khi sửa ngày/vai trò).
    const { data: existing } = await supabase
      .from('calendar_members')
      .select('member_email')
      .eq('calendar_id', calId)
      .eq('member_email', email)
      .maybeSingle();
    const isNew = !existing;

    // Rỗng/không gửi -> null (không giới hạn). Chuẩn hoá về ISO.
    const toIso = (v?: string | null) => (v ? new Date(v).toISOString() : null);
    const { data, error } = await supabase
      .from('calendar_members')
      .upsert(
        {
          calendar_id: calId,
          member_email: email,
          role: dto.role ?? 'viewer',
          share_from: toIso(dto.shareFrom),
          share_until: toIso(dto.shareUntil),
        },
        { onConflict: 'calendar_id,member_email' },
      )
      .select('member_email, role, created_at, share_from, share_until')
      .single();
    if (error) throw new BadRequestException(error.message);

    // Email báo cho người được chia sẻ (bắn rồi quên; lỗi mail KHÔNG làm hỏng việc chia sẻ).
    if (isNew) {
      void this.mail.sendCalendarShared({
        to: email,
        ownerEmail: userEmail || '',
        role: dto.role ?? 'viewer',
      });
    }
    return data;
  }

  /** Gỡ 1 thành viên khỏi lịch chính. */
  async removeMember(supabase: SupabaseClient, userId: string, email: string) {
    const calId = await this.primaryCalendarId(supabase, userId);
    const { error } = await supabase
      .from('calendar_members')
      .delete()
      .eq('calendar_id', calId)
      .eq('member_email', email.toLowerCase());
    if (error) throw new BadRequestException(error.message);
    return { success: true };
  }

  /** Các lịch được chia sẻ CHO mình (RLS "members read own membership"). */
  async sharedWithMe(supabase: SupabaseClient) {
    const { data, error } = await supabase
      .from('calendar_members')
      .select('role, calendar:calendars(id, name, color)');
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  private async primaryCalendarId(supabase: SupabaseClient, userId: string): Promise<string> {
    const { data, error } = await supabase
      .from('calendars')
      .select('id')
      .eq('is_primary', true)
      .eq('owner_id', userId)
      .single();
    if (error || !data) throw new BadRequestException('Không tìm thấy lịch chính.');
    return data.id;
  }
}
