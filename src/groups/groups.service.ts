// GroupsService — Xử lý nghiệp vụ nhóm ở máy chủ.
// Tạo/tham gia/mời nhóm, quản lý sự kiện nhóm và tin nhắn (đọc/ghi cơ sở dữ liệu).
// Lưu ý bảo mật: chủ yếu dùng quyền của chính người dùng để tuân luật bảo mật (RLS);
// chỉ vài thao tác đặc biệt mới dùng quyền admin, và có tự kiểm tra quyền trước khi ghi.

import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateGroupEventDto, UpdateGroupEventDto } from './dto/group-event.dto';
import { SendMessageDto } from './dto/send-message.dto';

@Injectable()
export class GroupsService {
  constructor(private readonly supabaseService: SupabaseService) {}

  private get admin(): SupabaseClient {
    return this.supabaseService.adminClient;
  }

  // ============================ NHÓM ============================

  /** Số nhóm tối đa một người được ở CÙNG LÚC — tính cả nhóm tự tạo lẫn nhóm được mời vào. */
  static readonly MAX_GROUPS = 5;

  /** Đếm số nhóm user đang thực sự ở trong (đã tham gia, không tính lời mời đang chờ). */
  private async countMyGroups(userId: string): Promise<number> {
    const { count, error } = await this.admin
      .from('group_members')
      .select('group_id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .not('joined_at', 'is', null);
    if (error) throw error;
    return count ?? 0;
  }

  /**
   * Chặn khi đã đủ hạn mức. Chặn ở MÁY CHỦ chứ không chỉ ẩn nút: ai gọi thẳng API
   * vẫn phải theo. Áp cho cả tạo mới, vào bằng mã, và đồng ý lời mời — nếu chỉ chặn
   * lúc tạo thì người khác mời là vẫn vượt hạn mức được.
   */
  private async assertUnderGroupLimit(userId: string, action: string): Promise<void> {
    const current = await this.countMyGroups(userId);
    if (current >= GroupsService.MAX_GROUPS) {
      throw new BadRequestException(
        `Bạn đang ở ${current} nhóm, vượt giới hạn ${GroupsService.MAX_GROUPS} nhóm nên không ${action} được. Hãy rời hoặc giải tán bớt một nhóm.`,
      );
    }
  }

  /** Tạo nhóm: tạo 1 lịch riêng cho nhóm + bản ghi nhóm + gán người tạo làm chủ (owner). */
  async createGroup(supabase: SupabaseClient, userId: string, userEmail: string, name: string) {
    await this.assertUnderGroupLimit(userId, 'tạo thêm nhóm');

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
      // Chỉ đếm thành viên ĐÃ THAM GIA (joined_at not null) — bỏ lời mời đang chờ/đã từ chối.
      const { data: members } = await supabase
        .from('group_members')
        .select('group_id')
        .in('group_id', ids)
        .not('joined_at', 'is', null);
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
      .select('user_id, email, role, joined_at, status')
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
      .upsert(
        { group_id: groupId, email: normalized, role: 'member', status: 'pending' },
        { onConflict: 'group_id,email', ignoreDuplicates: true },
      );
    if (error) throw error;
    return { ok: true, email: normalized };
  }

  /** Tham gia nhóm bằng mã: gán user hiện tại vào nhóm. */
  async joinByCode(code: string, userId: string, userEmail: string) {
    const { data: group } = await this.admin.from('groups').select('*').eq('join_code', code.trim()).maybeSingle();
    if (!group) throw new NotFoundException('Mã nhóm không đúng.');
    // Đã ở sẵn trong nhóm này thì cho qua (vào lại bằng mã không làm danh sách dài thêm).
    const { data: already } = await this.admin
      .from('group_members')
      .select('group_id')
      .eq('group_id', group.id)
      .eq('user_id', userId)
      .not('joined_at', 'is', null)
      .maybeSingle();
    if (!already) await this.assertUnderGroupLimit(userId, 'vào thêm nhóm');

    await this.admin.from('group_members').upsert(
      {
        group_id: group.id,
        user_id: userId,
        email: (userEmail || '').toLowerCase(),
        role: group.owner_id === userId ? 'owner' : 'member',
        joined_at: new Date().toISOString(),
        status: 'accepted', // vào bằng mã = chủ động -> đồng ý luôn
      },
      { onConflict: 'group_id,email' },
    );
    return this.decorate(group, userId);
  }

  /**
   * Đồng bộ lời mời khi user đăng nhập: chỉ GẮN tài khoản (user_id) vào các lời mời gửi theo
   * email của họ mà chưa gắn — VẪN để trạng thái 'pending', CHƯA vào nhóm. Người dùng phải bấm
   * Đồng ý (acceptInvite) mới thành thành viên. Trả về số lời mời đang chờ để client hiện.
   */
  async syncInvites(userId: string, userEmail: string) {
    const email = (userEmail || '').toLowerCase();
    if (!email) return { pending: 0 };
    await this.admin
      .from('group_members')
      .update({ user_id: userId })
      .eq('email', email)
      .is('user_id', null)
      .eq('status', 'pending');
    const { data } = await this.admin
      .from('group_members')
      .select('group_id')
      .eq('user_id', userId)
      .eq('status', 'pending');
    return { pending: data?.length ?? 0 };
  }

  /** Danh sách lời mời nhóm ĐANG CHỜ của user (để hiện nút Đồng ý/Từ chối). */
  async listPendingInvites(userId: string) {
    const { data, error } = await this.admin
      .from('group_members')
      .select('group_id, created_at, groups(id, name)')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      group_id: r.group_id,
      name: r.groups?.name ?? '(nhóm)',
      invited_at: r.created_at,
    }));
  }

  /** Người được mời ĐỒNG Ý -> trở thành thành viên (set joined_at + status accepted). */
  async acceptInvite(userId: string, groupId: string) {
    await this.assertUnderGroupLimit(userId, 'nhận thêm lời mời');
    const { data, error } = await this.admin
      .from('group_members')
      .update({ status: 'accepted', joined_at: new Date().toISOString() })
      .eq('group_id', groupId)
      .eq('user_id', userId)
      .eq('status', 'pending')
      .select('group_id');
    if (error) throw error;
    if (!data?.length) throw new NotFoundException('Không tìm thấy lời mời đang chờ.');
    return { ok: true };
  }

  /** Người được mời TỪ CHỐI -> giữ dòng với status='declined' (chủ nhóm vẫn thấy), joined_at
   *  vẫn null nên KHÔNG vào nhóm. */
  async declineInvite(userId: string, groupId: string) {
    const { error } = await this.admin
      .from('group_members')
      .update({ status: 'declined' })
      .eq('group_id', groupId)
      .eq('user_id', userId)
      .eq('status', 'pending');
    if (error) throw error;
    return { ok: true };
  }

  /**
   * TỰ RỜI nhóm — khác removeMember (chỉ chủ nhóm gọi được, dùng để đá người khác).
   * Chủ nhóm KHÔNG rời được: rời đi thì nhóm mất chủ, muốn dứt thì phải "giải tán nhóm".
   */
  async leaveGroup(userId: string, groupId: string) {
    const { data: group } = await this.admin.from('groups').select('owner_id').eq('id', groupId).maybeSingle();
    if (!group) throw new NotFoundException('Không tìm thấy nhóm.');
    if (group.owner_id === userId) {
      throw new ForbiddenException('Bạn là chủ nhóm — hãy giải tán nhóm thay vì rời đi.');
    }
    const { data, error } = await this.admin
      .from('group_members')
      .delete()
      .eq('group_id', groupId)
      .eq('user_id', userId)
      .select('group_id');
    if (error) throw error;
    if (!data?.length) throw new NotFoundException('Bạn không thuộc nhóm này.');
    return { ok: true };
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

  async updateEvent(
    supabase: SupabaseClient,
    groupId: string,
    eventId: string,
    dto: UpdateGroupEventDto,
    userId?: string,
  ) {
    // QUYỀN: chỉ NGƯỜI TẠO sự kiện nhóm (hoặc CHỦ NHÓM) mới được THAY ĐỔI sự kiện.
    // Thành viên khác chỉ xem, không sửa gì (kể cả tiêu đề/giờ/màu...).
    if (userId) {
      await this.assertCanModifyGroupEvent(supabase, groupId, eventId, userId);
    }

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

  async deleteEvent(supabase: SupabaseClient, groupId: string, eventId: string, userId?: string) {
    // QUYỀN: chỉ người tạo sự kiện (hoặc chủ nhóm) mới được xóa.
    if (userId) {
      await this.assertCanModifyGroupEvent(supabase, groupId, eventId, userId);
    }
    const { error } = await supabase.from('events').delete().eq('id', eventId).eq('group_id', groupId);
    if (error) throw error;
    return { id: eventId };
  }

  /** Chặn thao tác sửa/xóa sự kiện nhóm nếu user KHÔNG phải người tạo và KHÔNG phải chủ nhóm. */
  private async assertCanModifyGroupEvent(
    supabase: SupabaseClient,
    groupId: string,
    eventId: string,
    userId: string,
  ): Promise<void> {
    const { data: cur } = await supabase
      .from('events')
      .select('creator_id')
      .eq('id', eventId)
      .eq('group_id', groupId)
      .maybeSingle();
    // Sự kiện cũ chưa có creator_id -> không chặn (giữ tương thích dữ liệu cũ).
    if (!cur?.creator_id || cur.creator_id === userId) return;
    const { data: group } = await this.admin.from('groups').select('owner_id').eq('id', groupId).maybeSingle();
    if (group?.owner_id === userId) return; // chủ nhóm được toàn quyền
    throw new ForbiddenException('Chỉ người tạo sự kiện (hoặc chủ nhóm) mới được thay đổi sự kiện này.');
  }

  /** Gắn (hoặc cập nhật) link Google Meet cho một sự kiện nhóm. */
  async setMeetLink(supabase: SupabaseClient, groupId: string, eventId: string, meetLink: string) {
    const { data, error } = await supabase
      .from('events')
      .update({ meet_link: meetLink })
      .eq('id', eventId)
      .eq('group_id', groupId)
      .select('*, attendees:event_attendees(*)')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new ForbiddenException('Không cập nhật được link Meet cho sự kiện nhóm này.');
    return data;
  }

  /** Gỡ link Google Meet khỏi 1 sự kiện nhóm (đặt về null). */
  async removeMeetLink(supabase: SupabaseClient, groupId: string, eventId: string) {
    const { data, error } = await supabase
      .from('events')
      .update({ meet_link: null })
      .eq('id', eventId)
      .eq('group_id', groupId)
      .select('*, attendees:event_attendees(*)')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new ForbiddenException('Không gỡ được link Meet cho sự kiện nhóm này.');
    return data;
  }

  // ============================ CHAT NHÓM ============================

  /** Lịch sử tin nhắn của nhóm, cũ -> mới. `before` (ISO timestamp) để phân trang lùi về quá khứ. */
  async listMessages(supabase: SupabaseClient, groupId: string, before?: string, limit = 50) {
    let q = supabase
      .from('group_messages')
      .select('*')
      .eq('group_id', groupId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (before) q = q.lt('created_at', before);

    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).reverse();
  }

  /** Gửi 1 tin nhắn vào nhóm. RLS (group_messages) tự chặn nếu user không phải thành viên đã tham gia. */
  async sendMessage(
    supabase: SupabaseClient,
    groupId: string,
    userId: string,
    userEmail: string,
    dto: SendMessageDto,
  ) {
    // Tin trả lời phải trỏ tới tin CÙNG NHÓM — nếu không thì bỏ qua phần trích dẫn thay vì
    // để lọt id của nhóm khác (rò rỉ nội dung nhóm mình không thuộc về).
    let replyToId: string | null = null;
    if (dto.replyToId) {
      const { data: parent } = await supabase
        .from('group_messages')
        .select('id')
        .eq('id', dto.replyToId)
        .eq('group_id', groupId)
        .maybeSingle();
      replyToId = parent?.id ?? null;
    }

    const { data, error } = await supabase
      .from('group_messages')
      .insert({
        group_id: groupId,
        sender_id: userId,
        sender_email: userEmail || null,
        content: dto.content,
        reply_to_id: replyToId,
      })
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }

  /** Sửa nội dung 1 tin nhắn — RLS chỉ cho người gửi sửa tin của chính mình (và tin chưa thu hồi). */
  async editMessage(supabase: SupabaseClient, groupId: string, messageId: string, content: string) {
    const { data, error } = await supabase
      .from('group_messages')
      .update({ content, edited_at: new Date().toISOString() })
      .eq('id', messageId)
      .eq('group_id', groupId)
      .is('deleted_at', null)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new ForbiddenException('Bạn chỉ sửa được tin nhắn của chính mình.');
    return data;
  }

  /** Thu hồi 1 tin nhắn (soft delete): đánh dấu deleted_at + xóa nội dung. RLS: chỉ người gửi. */
  async deleteMessage(supabase: SupabaseClient, groupId: string, messageId: string) {
    const { data, error } = await supabase
      .from('group_messages')
      .update({ deleted_at: new Date().toISOString(), content: '' })
      .eq('id', messageId)
      .eq('group_id', groupId)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new ForbiddenException('Bạn chỉ thu hồi được tin nhắn của chính mình.');
    return data;
  }

  /** Đánh dấu đã đọc tới thời điểm hiện tại cho user trong 1 nhóm (upsert mốc đã đọc). */
  async markRead(supabase: SupabaseClient, groupId: string, userId: string) {
    const { error } = await supabase
      .from('group_message_reads')
      .upsert(
        { group_id: groupId, user_id: userId, last_read_at: new Date().toISOString() },
        { onConflict: 'group_id,user_id' },
      );
    if (error) throw error;
    return { ok: true };
  }

  /**
   * Số tin CHƯA ĐỌC của user cho từng nhóm mình thuộc về.
   * Chưa đọc = tin created_at > mốc đã đọc, KHÔNG phải do chính mình gửi, và chưa bị thu hồi.
   * Nhóm chưa có mốc đã đọc -> tính mọi tin của người khác.
   */
  async getUnreadCounts(supabase: SupabaseClient, userId: string): Promise<Record<string, number>> {
    const { data: groups } = await supabase.from('groups').select('id');
    const ids = (groups ?? []).map((g) => g.id as string);
    if (!ids.length) return {};

    const { data: reads } = await supabase
      .from('group_message_reads')
      .select('group_id, last_read_at')
      .eq('user_id', userId);
    const readMap = new Map<string, string>();
    for (const r of reads ?? []) readMap.set(r.group_id, r.last_read_at);

    const entries = await Promise.all(
      ids.map(async (groupId) => {
        let q = supabase
          .from('group_messages')
          .select('id', { count: 'exact', head: true })
          .eq('group_id', groupId)
          .is('deleted_at', null)
          .neq('sender_id', userId);
        const lastRead = readMap.get(groupId);
        if (lastRead) q = q.gt('created_at', lastRead);
        const { count } = await q;
        return [groupId, count ?? 0] as const;
      }),
    );
    const out: Record<string, number> = {};
    for (const [groupId, count] of entries) if (count > 0) out[groupId] = count;
    return out;
  }

  /** user_id (đã tham gia) của mọi thành viên nhóm — dùng để báo realtime "groups:changed". */
  async listMemberUserIds(groupId: string): Promise<string[]> {
    const { data } = await this.admin
      .from('group_members')
      .select('user_id')
      .eq('group_id', groupId)
      .not('user_id', 'is', null)
      .not('joined_at', 'is', null);
    return (data ?? []).map((m) => m.user_id as string);
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
