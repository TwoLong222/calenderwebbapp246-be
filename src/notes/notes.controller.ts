// /api/notes — CRUD ghi chú cá nhân (yêu cầu đăng nhập).
import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { User } from '@supabase/supabase-js';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { NotesService } from './notes.service';
import { CreateNoteDto } from './dto/create-note.dto';
import { UpdateNoteDto } from './dto/update-note.dto';

@UseGuards(SupabaseAuthGuard)
@Controller('notes')
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Get()
  list(@Req() req: any) {
    return this.notes.list(req.supabase);
  }

  @Post()
  create(@Req() req: any, @CurrentUser() user: User, @Body() dto: CreateNoteDto) {
    return this.notes.create(req.supabase, user.id, dto);
  }

  @Patch(':id')
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateNoteDto) {
    return this.notes.update(req.supabase, id, dto);
  }

  @Delete(':id')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.notes.remove(req.supabase, id);
  }
}
