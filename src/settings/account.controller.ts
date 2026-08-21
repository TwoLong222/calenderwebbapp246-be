// AccountController: các thao tác tài khoản nhạy cảm.
// DELETE /api/account — xoá vĩnh viễn tài khoản của CHÍNH user đang đăng nhập.
//
// User id lấy từ JWT (KHÔNG nhận từ body) -> không thể xoá nhầm người khác.
// Xoá auth user bằng adminClient -> cascade tự xoá calendars/events/attendees/user_settings
// (đều ON DELETE CASCADE tới auth.users).

import {
  Controller,
  Delete,
  InternalServerErrorException,
  UseGuards,
} from '@nestjs/common';
import type { User } from '@supabase/supabase-js';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { SupabaseService } from '../supabase/supabase.service';

@UseGuards(SupabaseAuthGuard)
@Controller('account')
export class AccountController {
  constructor(private readonly supabaseService: SupabaseService) {}

  @Delete()
  async deleteOwnAccount(@CurrentUser() user: User) {
    const { error } = await this.supabaseService.adminClient.auth.admin.deleteUser(
      user.id,
    );
    if (error) {
      throw new InternalServerErrorException(
        `Xoá tài khoản thất bại: ${error.message}`,
      );
    }
    return { success: true };
  }
}
