// EventsController: REST endpoint /api/events — tất cả đều yêu cầu đăng nhập
// (bảo vệ bởi SupabaseAuthGuard đã tạo ở tính năng Auth).

import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { User } from '@supabase/supabase-js';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { RsvpDto } from './dto/rsvp.dto';
import { SetMeetDto } from './dto/set-meet.dto';
import { EventsService } from './events.service';

@UseGuards(SupabaseAuthGuard)
@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  list(@Req() req: any, @CurrentUser() user: User) {
    // Truyền email + id: email để lấy sự kiện ĐƯỢC MỜI; id để nhận diện sự kiện của
    // chính mình khi lọc bỏ lời mời chưa Đồng ý.
    return this.eventsService.listEvents(req.supabase, user.email ?? '', user.id);
  }

  /** Danh sách sự kiện trong thùng rác của user */
  @Get('trash')
  listTrash(@Req() req: any, @CurrentUser() user: User) {
    return this.eventsService.listTrash(req.supabase, user.id);
  }

  /** Khôi phục 1 sự kiện từ thùng rác */
  @Post(':id/restore')
  restore(@Req() req: any, @Param('id') id: string) {
    return this.eventsService.restoreEvent(req.supabase, id);
  }

  /** Xóa vĩnh viễn 1 sự kiện trong thùng rác */
  @Delete(':id/purge')
  purge(@Req() req: any, @Param('id') id: string) {
    return this.eventsService.purgeEvent(req.supabase, id);
  }

  @Post()
  create(@Req() req: any, @CurrentUser() user: User, @Body() dto: CreateEventDto) {
    return this.eventsService.createEvent(req.supabase, user.id, user.email ?? '', dto);
  }

  @Patch(':id')
  update(@Req() req: any, @CurrentUser() user: User, @Param('id') id: string, @Body() dto: UpdateEventDto) {
    // Truyền user.id để kiểm tra quyền: chỉ người tạo mới được đổi giờ bắt đầu/kết thúc.
    return this.eventsService.updateEvent(req.supabase, id, dto, user.id);
  }

  @Delete(':id')
  remove(@Req() req: any, @Param('id') id: string, @Query('scope') scope?: string) {
    return this.eventsService.deleteEvent(req.supabase, id, scope === 'series' ? 'series' : 'single');
  }

  /** User tự đặt trạng thái tham dự (Có/Không/Có thể) cho event — dùng chính email của mình */
  @Post(':id/rsvp')
  rsvp(@Req() req: any, @CurrentUser() user: User, @Param('id') id: string, @Body() dto: RsvpDto) {
    return this.eventsService.rsvp(req.supabase, id, user.email ?? '', dto.status);
  }

  /** Gắn link Google Meet vào 1 sự kiện (cá nhân). */
  @Post(':id/meet')
  setMeet(@Req() req: any, @Param('id') id: string, @Body() dto: SetMeetDto) {
    return this.eventsService.setMeetLink(req.supabase, id, dto.meetLink);
  }

  /** Gỡ link Google Meet khỏi 1 sự kiện (cá nhân). */
  @Delete(':id/meet')
  removeMeet(@Req() req: any, @Param('id') id: string) {
    return this.eventsService.removeMeetLink(req.supabase, id);
  }
}
