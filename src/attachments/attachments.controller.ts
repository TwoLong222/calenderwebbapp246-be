// /api/events/:id/attachments — quản lý tài liệu đính kèm (yêu cầu đăng nhập).
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { User } from '@supabase/supabase-js';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { AttachmentsService } from './attachments.service';

@UseGuards(SupabaseAuthGuard)
@Controller('events/:id/attachments')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Get()
  list(@Req() req: any, @CurrentUser() user: User, @Param('id') eventId: string) {
    return this.attachments.list(req.supabase, user.id, eventId);
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  upload(
    @Req() req: any,
    @CurrentUser() user: User,
    @Param('id') eventId: string,
    @UploadedFile() file: any,
    @Body() body: { availableFrom?: string; availableUntil?: string },
  ) {
    return this.attachments.upload(
      req.supabase,
      user.id,
      eventId,
      file,
      body?.availableFrom,
      body?.availableUntil,
    );
  }

  @Delete(':attId')
  remove(@Req() req: any, @Param('id') eventId: string, @Param('attId') attId: string) {
    return this.attachments.remove(req.supabase, eventId, attId);
  }
}
