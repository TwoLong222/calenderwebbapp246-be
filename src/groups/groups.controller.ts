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

  @Post()
  create(@Req() req: any, @CurrentUser() user: User, @Body() dto: CreateGroupDto) {
    return this.groups.createGroup(req.supabase, user.id, user.email ?? '', dto.name);
  }

  /** Kích hoạt các lời mời gửi theo email của user hiện tại (gọi khi mở app). */
  @Post('sync-invites')
  syncInvites(@CurrentUser() user: User) {
    return this.groups.syncInvites(user.id, user.email ?? '');
  }

  @Post('join')
  join(@CurrentUser() user: User, @Body() dto: JoinGroupDto) {
    return this.groups.joinByCode(dto.code, user.id, user.email ?? '');
  }

  @Get(':id')
  get(@Req() req: any, @CurrentUser() user: User, @Param('id') id: string) {
    return this.groups.getGroup(req.supabase, user.id, id);
  }

  @Post(':id/invite')
  invite(@Req() req: any, @CurrentUser() user: User, @Param('id') id: string, @Body() dto: InviteMemberDto) {
    return this.groups.invite(req.supabase, user.id, id, dto.email);
  }

  @Delete(':id/members')
  removeMember(@Req() req: any, @CurrentUser() user: User, @Param('id') id: string, @Query('email') email: string) {
    return this.groups.removeMember(req.supabase, user.id, id, email);
  }

  @Delete(':id')
  remove(@Req() req: any, @CurrentUser() user: User, @Param('id') id: string) {
    return this.groups.deleteGroup(req.supabase, user.id, id);
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
}
