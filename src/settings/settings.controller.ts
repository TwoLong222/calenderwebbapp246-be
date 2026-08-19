// SettingsController: REST /api/settings — yêu cầu đăng nhập (SupabaseAuthGuard).
// GET   /api/settings  -> lấy (tự tạo mặc định nếu chưa có)
// PATCH /api/settings  -> cập nhật (chỉ field gửi lên), trả settings mới nhất.

import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import type { User } from '@supabase/supabase-js';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';

@UseGuards(SupabaseAuthGuard)
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get(@Req() req: any, @CurrentUser() user: User) {
    return this.settings.getSettings(req.supabase, user.id);
  }

  @Patch()
  update(
    @Req() req: any,
    @CurrentUser() user: User,
    @Body() dto: UpdateSettingsDto,
  ) {
    return this.settings.updateSettings(req.supabase, user.id, dto);
  }
}
