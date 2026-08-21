// CommentsController: bình luận cho event. Tất cả yêu cầu đăng nhập.
//   GET    /api/events/:eventId/comments   - danh sách comment của event
//   POST   /api/events/:eventId/comments   - thêm comment
//   PATCH  /api/comments/:id                - sửa comment của mình
//   DELETE /api/comments/:id                - xóa comment của mình (hoặc chủ event xóa)

import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { User } from '@supabase/supabase-js';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';

@UseGuards(SupabaseAuthGuard)
@Controller()
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Get('events/:eventId/comments')
  list(@Req() req: any, @Param('eventId') eventId: string) {
    return this.comments.list(req.supabase, eventId);
  }

  @Post('events/:eventId/comments')
  create(
    @Req() req: any,
    @CurrentUser() user: User,
    @Param('eventId') eventId: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.comments.create(req.supabase, eventId, user.id, user.email ?? '', dto.content);
  }

  @Patch('comments/:id')
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateCommentDto) {
    return this.comments.update(req.supabase, id, dto.content);
  }

  @Delete('comments/:id')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.comments.remove(req.supabase, id);
  }
}
