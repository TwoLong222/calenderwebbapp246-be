// /api/feed — CHỦ tự quản lý feed lịch công khai (yêu cầu đăng nhập).
import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import type { User } from '@supabase/supabase-js';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { FeedService } from './feed.service';
import { UpdateFeedDto } from './dto/update-feed.dto';

@UseGuards(SupabaseAuthGuard)
@Controller('feed')
export class FeedController {
  constructor(private readonly feed: FeedService) {}

  @Get('me')
  getMine(@Req() req: any, @CurrentUser() user: User) {
    return this.feed.getOrCreateOwnFeed(req.supabase, user.id);
  }

  @Patch('me')
  updateMine(@Req() req: any, @CurrentUser() user: User, @Body() dto: UpdateFeedDto) {
    return this.feed.updateOwnFeed(req.supabase, user.id, dto);
  }
}
