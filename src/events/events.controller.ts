// EventsController: REST endpoint /api/events — tất cả đều yêu cầu đăng nhập
// (bảo vệ bởi SupabaseAuthGuard đã tạo ở tính năng Auth).

import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { User } from '@supabase/supabase-js';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { EventsService } from './events.service';

@UseGuards(SupabaseAuthGuard)
@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  list(@Req() req: any) {
    return this.eventsService.listEvents(req.supabase);
  }

  @Post()
  create(@Req() req: any, @CurrentUser() user: User, @Body() dto: CreateEventDto) {
    return this.eventsService.createEvent(req.supabase, user.id, dto);
  }

  @Patch(':id')
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateEventDto) {
    return this.eventsService.updateEvent(req.supabase, id, dto);
  }

  @Delete(':id')
  remove(@Req() req: any, @Param('id') id: string, @Query('scope') scope?: string) {
    return this.eventsService.deleteEvent(req.supabase, id, scope === 'series' ? 'series' : 'single');
  }
}
