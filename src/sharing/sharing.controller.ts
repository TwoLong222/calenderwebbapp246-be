// /api/sharing — chủ lịch quản lý thành viên chia sẻ (yêu cầu đăng nhập).
import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { User } from '@supabase/supabase-js';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { SharingService } from './sharing.service';
import { AddMemberDto } from './dto/add-member.dto';

@UseGuards(SupabaseAuthGuard)
@Controller('sharing')
export class SharingController {
  constructor(private readonly sharing: SharingService) {}

  @Get('members')
  members(@Req() req: any, @CurrentUser() user: User) {
    return this.sharing.getMembers(req.supabase, user.id);
  }

  @Post('members')
  add(@Req() req: any, @CurrentUser() user: User, @Body() dto: AddMemberDto) {
    return this.sharing.addMember(req.supabase, user.id, user.email ?? '', dto);
  }

  @Delete('members/:email')
  remove(@Req() req: any, @CurrentUser() user: User, @Param('email') email: string) {
    return this.sharing.removeMember(req.supabase, user.id, email);
  }

  @Get('shared-with-me')
  sharedWithMe(@Req() req: any) {
    return this.sharing.sharedWithMe(req.supabase);
  }
}
