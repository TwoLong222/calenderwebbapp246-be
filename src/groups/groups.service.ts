// GroupsService: logic cho tính năng "Nhóm lên lịch cùng nhau".
//
// Quy ước client Supabase:
//   - `supabase` (truyền từ controller) = client GẮN JWT của user -> tuân RLS.
//     Dùng cho các thao tác thay mặt user (đọc nhóm, tạo lịch/nhóm, CRUD sự kiện nhóm).
//   - `adminClient` (service_role, BYPASS RLS) = dùng cho việc ghi bảng group_members
//     có kiểm soát (mời/tham gia bằng mã/đồng bộ lời mời), nơi RLS người-dùng không tiện.
//
// Bảo mật: mọi RLS trong migrations/2026-08-phase7-groups.sql vẫn được áp cho `supabase`.
// Với các thao tác dùng adminClient, service TỰ kiểm tra quyền (owner? / đúng mã?) trước khi ghi.

import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateGroupEventDto, UpdateGroupEventDto } from './dto/group-event.dto';

@Injectable()
export class GroupsService {
  constructor(private readonly supabaseService: SupabaseService) {}

  private get admin(): SupabaseClient {
    return this.supabaseService.adminClient;
  }

  // ============================ NHÓM ============================

  /** Tạo nhóm: tạo 1 lịch riêng cho nhóm + bản ghi nhóm + gán người tạo làm chủ (owner). */
  async createGroup(supabase: SupabaseClient, userId: string, userEmail: string, name: string) {
    // 1) Lịch riêng của nhóm (owner_id = người tạo, không phải lịch chính)
    const { data: cal, error: calErr } = await supabase
      .from('calendars')
      .insert({ owner_id: userId, name, is_primary: false })
      .select('id')
      .single();
    if (calErr) throw calErr;

    // 2) Bản ghi nhóm
    const { data: group, error: grpErr } = await supabase
      .from('groups')
      .insert({ owner_id: userId, name, calendar_id: cal.id })
      .select('*')
      .single();
    if (grpErr) throw grpErr;

    // 3) Gán chủ nhóm làm thành viên (đã tham gia) — dùng admin để không vướng thứ tự RLS
    await this.admin.from('group_members').insert({
      group_id: group.id,
      user_id: userId,
      email: userEmail,
      role: 'owner',
      joined_at: new Date().toISOString(),
    });

    return this.decorate(group, userId);
  }

  /** Danh sách nhóm user thuộc về (chủ hoặc thành viên đã tham gia). */
  async listMyGroups(supabase: SupabaseClient, userId: string) {
    const { data, error } = await supabase.from('groups').select('*').order('created_at', { ascending: true });
    if (error) throw error;
    const groups = data ?? [];

    // Đếm số thành viên mỗi nhóm (1 truy vấn)
    const ids = groups.map((g) => g.id);
    const counts = new Map<string, number>();
    if (ids.length) {
      const { data: members } = await supabase.from('group_members').select('group_id').in('group_id', ids);
      for (const m of members ?? []) counts.set(m.group_id, (counts.get(m.group_id) ?? 0) + 1);
    }
    return groups.map((g) => ({ ...this.decorate(g, userId), memberCount: counts.get(g.id) ?? 0 }));
  }

  /** Chi tiết 1 nhóm + danh sách thành viên. */
  async getGroup(supabase: SupabaseClient, userId: string, groupId: string) {
    const { data: group, error } = await supabase.from('groups').select('*').eq('id', groupId).maybeSingle();
    if (error) throw error;
    if (!group) throw new NotFoundException('Không tìm thấy nhóm (hoặc bạn không thuộc nhóm này).');

    const { data: members } = await supabase
      .from('group_members')
      .select('user_id, email, role, joined_at')
      .eq('group_id', groupId)
      .order('created_at', { ascending: true });

    return { ...this.decorate(group, userId), members: members ?? [] };
  }

  /** Chủ nhóm mời 1 email vào nhóm (chưa tham gia -> joined_at=null). */
  async invite(supabase: SupabaseClient, userId: string, groupId: string, email: string) {
    await this.assertOwner(supabase, userId, groupId);
    const normalized = email.trim().toLowerCase();
    // upsert theo (group_id, email): nếu đã mời rồi thì không lỗi
    const { error } = await this.admin
      .from('group_members')
      .upsert({ group_id: groupId, email: normalized, role: 'member' }, { onConflict: 'group_id,email', ignoreDuplicates: true });
    if (error) throw error;
    return { ok: true, email: normalized };
  }

  /** Tham gia nhóm bằng mã: gán user hiện tại vào nhóm. */
  async joinByCode(code: string, userId: string, userEmail: string) {
    const { data: group } = await this.admin.from('groups').select('*').eq('join_code', code.trim()).maybeSingle();
    if (!group) throw new NotFoundException('Mã nhóm không đúng.');

    await this.admin.from('group_members').upsert(
      {
        group_id: group.id,
        user_id: userId,
        email: (userEmail || '').toLowerCase(),
        role: group.owner_id === userId ? 'owner' : 'member',
        joined_at: new Date().toISOString(),
      },
      { onConflict: 'group_id,email' },
    );
    return this.decorate(group, userId);
  }

  /**
   * Đồng bộ lời mời: khi user đăng nhập, mọi lời mời gửi theo email của họ (joined_at=null,
   * user_id=null) được kích hoạt -> gán user_id + joined_at. Nhờ vậy mời-bằng-email tự vào nhóm.
   */
  async syncInvites(userId: string, userEmail: string) {
    const email = (userEmail || '').toLowerCase();
    if (!email) return { joined: 0 };
    const { data, error } = await this.admin
      .from('group_members')
      .update({ user_id: userId, joined_at: new Date().toISOString() })
      .eq('email', email)
      .is('joined_at', null)
      .select('group_id');
    if (error) throw error;
    return { joined: data?.length ?? 0 };
  }

  /** Chủ nhóm xóa 1 thành viên (không xóa được chính chủ nhóm). */
  async removeMember(supabase: SupabaseClient, userId: string, groupId: string, email: string) {
    await this.assertOwner(supabase, userId, groupId);
    const normalized = email.trim().toLowerCase();
    const { data: group } = await this.admin.from('groups').select('owner_id').eq('id', groupId).maybeSingle();
    const { data: target } = await this.admin
      .from('group_members')
      .select('user_id, role')
      .eq('group_id', groupId)
      .eq('email', normalized)
      .maybeSingle();
    if (target?.role === 'owner' || (group && target?.user_id === group.owner_id)) {
      throw new ForbiddenException('Không thể xóa chủ nhóm.');
    }
    await this.admin.from('group_members').delete().eq('group_id', groupId).eq('email', normalized);
    return { ok: true };
  }

  /** Chủ nhóm giải tán nhóm (xóa nhóm -> cascade xóa thành viên, sự kiện, lịch nhóm). */
  async deleteGroup(supabase: SupabaseClient, userId: string, groupId: string) {
    await this.assertOwner(supabase, userId, groupId);
    const { data: group } = await this.admin.from('groups').select('calendar_id').eq('id', groupId).maybeSingle();
    await this.admin.from('groups').delete().eq('id', groupId);
    if (group?.calendar_id) await this.admin.from('calendars').delete().eq('id', group.calendar_id);
    return { ok: true };
  }

  // ============================ SỰ KIỆN NHÓM ============================

  async listEvents(supabase: SupabaseClient, groupId: string) {
    const { data, error } = await supabase
      .from('events')
      .select('*, attendees:event_attendees(*)')
      .eq('group_id', groupId)
      .is('deleted_at', null)
      .order('start_time', { ascending: true });
    if (error) throw error;
    return data ?? [];
  }

  async createEvent(
    supabase: SupabaseClient,
    userId: string,
    userEmail: string,
    groupId: string,
    dto: CreateGroupEventDto,
  ) {
    const calendarId = await this.getGroupCalendarId(supabase, groupId);
    const conflicts = dto.isAllDay ? [] : await this.findConflicts(supabase, groupId, dto.startTime, dto.endTime);

    const { data: event, error } = await supabase
      .from('events')
      .insert({
        calendar_id: calendarId,
        group_id: groupId,
        title: dto.title,
        description: dto.description ?? null,
        location: dto.location ?? null,
        start_time: dto.startTime,
        end_time: dto.endTime,
        is_all_day: dto.isAllDay ?? false,
        kind: dto.kind ?? 'event',
        color: dto.color ?? 'sky',
        creator_id: userId,
        creator_email: userEmail || null,
      })
      .select('*, attendees:event_attendees(*)')
      .single();
    if (error) throw error;
    return { event, conflicts };
  }

  async updateEvent(supabase: SupabaseClient, groupId: string, eventId: string, dto: UpdateGroupEventDto) {
    const patch: Record<string, unknown> = {};
    if (dto.title !== undefined) patch['title'] = dto.title;
    if (dto.description !== undefined) patch['description'] = dto.description;
    if (dto.location !== undefined) patch['location'] = dto.location;
    if (dto.startTime !== undefined) patch['start_time'] = dto.startTime;
    if (dto.endTime !== undefined) patch['end_time'] = dto.endTime;
    if (dto.isAllDay !== undefined) patch['is_all_day'] = dto.isAllDay;
    if (dto.kind !== undefined) patch['kind'] = dto.kind;
    if (dto.color !== undefined) patch['color'] = dto.color;

    const nextStart = dto.startTime;
    const nextEnd = dto.endTime;
    const conflicts =
      nextStart && nextEnd ? await this.findConflicts(supabase, groupId, nextStart, nextEnd, eventId) : [];

    const { data: event, error } = await supabase
      .from('events')
      .update(patch)
      .eq('id', eventId)
      .eq('group_id', groupId)
      .select('*, attendees:event_attendees(*)')
      .maybeSingle();
    if (error) throw error;
    if (!event) throw new ForbiddenException('Bạn không có quyền sửa sự kiện nhóm này.');
    return { event, conflicts };
  }

  async deleteEvent(supabase: SupabaseClient, groupId: string, eventId: string) {
    const { error } = await supabase.from('events').delete().eq('id', eventId).eq('group_id', groupId);
    if (error) throw error;
    return { id: eventId };
  }

  // ============================ HỖ TRỢ ============================

  private async getGroupCalendarId(supabase: SupabaseClient, groupId: string): Promise<string> {
    const { data, error } = await supabase.from('groups').select('calendar_id').eq('id', groupId).maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundException('Không tìm thấy nhóm.');
    return data.calendar_id;
  }

  private async findConflicts(
    supabase: SupabaseClient,
    groupId: string,
    startTime: string,
    endTime: string,
    excludeId?: string,
  ) {
    let q = supabase
      .from('events')
      .select('id, title, start_time, end_time')
      .eq('group_id', groupId)
      .eq('is_all_day', false)
      .eq('kind', 'event')
      .is('deleted_at', null)
      .lt('start_time', endTime)
      .gt('end_time', startTime);
    if (excludeId) q = q.neq('id', excludeId);
    const { data, error } = await q;
    if (error) throw error;
    return data ?? [];
  }

  /** Kiểm tra user là chủ nhóm (dùng client user -> tuân RLS đọc groups). */
  private async assertOwner(supabase: SupabaseClient, userId: string, groupId: string): Promise<void> {
    const { data } = await supabase.from('groups').select('owner_id').eq('id', groupId).maybeSingle();
    if (!data || data.owner_id !== userId) {
      throw new ForbiddenException('Chỉ chủ nhóm mới được thực hiện thao tác này.');
    }
  }

  /** Gắn thêm role của user hiện tại cho tiện hiển thị ở frontend. */
  private decorate<T extends { owner_id: string }>(group: T, userId: string) {
    return { ...group, myRole: group.owner_id === userId ? 'owner' : 'member' };
  }
}
