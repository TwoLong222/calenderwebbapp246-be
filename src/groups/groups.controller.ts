// GroupsController: REST /api/groups — mọi route yêu cầu đăng nhập (SupabaseAuthGuard).
// Sau mỗi thay đổi SỰ KIỆN nhóm, phát real-time cho các thành viên online qua SchedulingGateway.

import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { User } from '@supabase/supabase-js';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { GroupsService } from './groups.service';
import { SchedulingGateway } from './scheduling.gateway';
import { CreateGroupDto } from './dto/create-group.dto';
import { InviteMemberDto } from './dto/invite-member.dto';
import { JoinGroupDto } from './dto/join-group.dto';
import { CreateGroupEventDto, UpdateGroupEventDto } from './dto/group-event.dto';
import { SendMessageDto } from './dto/send-message.dto';

@UseGuards(SupabaseAuthGuard)
@Controller('groups')
export class GroupsController {
  constructor(
    private readonly groups: GroupsService,
    private readonly gateway: SchedulingGateway,
  ) {}

  // ---------- Nhóm ----------
  @Get()
  list(@Req() req: any, @CurrentUser() user: User) {
    return this.groups.listMyGroups(req.supabase, user.id);
  }

  /** Số tin CHƯA ĐỌC theo từng nhóm { groupId: count } — cho badge ở sidebar.
   *  Đặt TRƯỚC route ':id' và dùng 2 đoạn 'chat/unread' để không đụng với GET :id. */
  @Get('chat/unread')
  unread(@Req() req: any, @CurrentUser() user: User) {
    return this.groups.getUnreadCounts(req.supabase, user.id);
  }

  @Post()
  async create(@Req() req: any, @CurrentUser() user: User, @Body() dto: CreateGroupDto) {
    const group = await this.groups.createGroup(req.supabase, user.id, user.email ?? '', dto.name);
    this.gateway.notifyGroupsChanged([user.id]);
    return group;
  }

  /** Kích hoạt các lời mời gửi theo email của user hiện tại (gọi khi mở app). */
  @Post('sync-invites')
  syncInvites(@CurrentUser() user: User) {
    return this.groups.syncInvites(user.id, user.email ?? '');
  }

  @Post('join')
  async join(@CurrentUser() user: User, @Body() dto: JoinGroupDto) {
    const group = await this.groups.joinByCode(dto.code, user.id, user.email ?? '');
    this.gateway.notifyGroupsChanged(await this.groups.listMemberUserIds(group.id));
    return group;
  }

  @Get(':id')
  get(@Req() req: any, @CurrentUser() user: User, @Param('id') id: string) {
    return this.groups.getGroup(req.supabase, user.id, id);
  }

  @Post(':id/invite')
  async invite(@Req() req: any, @CurrentUser() user: User, @Param('id') id: string, @Body() dto: InviteMemberDto) {
    const res = await this.groups.invite(req.supabase, user.id, id, dto.email);
    this.gateway.notifyGroupsChanged(await this.groups.listMemberUserIds(id));
    return res;
  }

  @Delete(':id/members')
  async removeMember(@Req() req: any, @CurrentUser() user: User, @Param('id') id: string, @Query('email') email: string) {
    const memberIds = await this.groups.listMemberUserIds(id);
    const res = await this.groups.removeMember(req.supabase, user.id, id, email);
    this.gateway.notifyGroupsChanged(memberIds); // gồm cả người vừa bị xóa -> tab của họ tự ẩn nhóm
    return res;
  }

  @Delete(':id')
  async remove(@Req() req: any, @CurrentUser() user: User, @Param('id') id: string) {
    const memberIds = await this.groups.listMemberUserIds(id);
    const res = await this.groups.deleteGroup(req.supabase, user.id, id);
    this.gateway.notifyGroupsChanged(memberIds);
    return res;
  }

  // ---------- Sự kiện nhóm ----------
  @Get(':id/events')
  listEvents(@Req() req: any, @Param('id') id: string) {
    return this.groups.listEvents(req.supabase, id);
  }

  @Post(':id/events')
  async createEvent(
    @Req() req: any,
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: CreateGroupEventDto,
  ) {
    const res = await this.groups.createEvent(req.supabase, user.id, user.email ?? '', id, dto);
    this.gateway.emitToGroup(id, 'created', res.event);
    return res;
  }

  @Patch(':id/events/:eventId')
  async updateEvent(
    @Req() req: any,
    @Param('id') id: string,
    @Param('eventId') eventId: string,
    @Body() dto: UpdateGroupEventDto,
  ) {
    const res = await this.groups.updateEvent(req.supabase, id, eventId, dto);
    this.gateway.emitToGroup(id, 'updated', res.event);
    return res;
  }

  @Delete(':id/events/:eventId')
  async deleteEvent(@Req() req: any, @Param('id') id: string, @Param('eventId') eventId: string) {
    const res = await this.groups.deleteEvent(req.supabase, id, eventId);
    this.gateway.emitToGroup(id, 'deleted', { id: eventId });
    return res;
  }

  // ---------- Chat nhóm ----------
  /** Lịch sử tin nhắn (cũ -> mới). ?before=<ISO timestamp> để lấy trang cũ hơn, ?limit=<n> (mặc định 50). */
  @Get(':id/messages')
  listMessages(
    @Req() req: any,
    @Param('id') id: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    return this.groups.listMessages(req.supabase, id, before, limit ? Number(limit) : undefined);
  }

  @Post(':id/messages')
  async sendMessage(@Req() req: any, @CurrentUser() user: User, @Param('id') id: string, @Body() dto: SendMessageDto) {
    const message = await this.groups.sendMessage(req.supabase, id, user.id, user.email ?? '', dto.content);
    this.gateway.emitMessage(id, message);
    return message;
  }

  /** Sửa nội dung 1 tin nhắn của chính mình. */
  @Patch(':id/messages/:messageId')
  async editMessage(
    @Req() req: any,
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Body() dto: SendMessageDto,
  ) {
    const message = await this.groups.editMessage(req.supabase, id, messageId, dto.content);
    this.gateway.emitMessageUpdate(id, message);
    return message;
  }

  /** Thu hồi 1 tin nhắn của chính mình (soft delete). */
  @Delete(':id/messages/:messageId')
  async deleteMessage(@Req() req: any, @Param('id') id: string, @Param('messageId') messageId: string) {
    const message = await this.groups.deleteMessage(req.supabase, id, messageId);
    this.gateway.emitMessageDelete(id, message);
    return message;
  }

  /** Đánh dấu đã đọc tới hiện tại cho nhóm này. */
  @Post(':id/messages/read')
  markRead(@Req() req: any, @CurrentUser() user: User, @Param('id') id: string) {
    return this.groups.markRead(req.supabase, id, user.id);
  }
}
