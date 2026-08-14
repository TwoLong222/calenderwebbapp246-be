// Endpoint dùng để TEST xem luồng xác thực có hoạt động đúng hay không.
// GET /api/auth/me (có prefix "api" nếu app đã setGlobalPrefix('api'))
// Yêu cầu header: Authorization: Bearer <access_token>
// Trả về thông tin user nếu token hợp lệ, báo lỗi 401 nếu không.

import { Controller, Get, UseGuards } from '@nestjs/common';
import type { User } from '@supabase/supabase-js';
import { CurrentUser } from './current-user.decorator';
import { SupabaseAuthGuard } from './supabase-auth.guard';

@Controller('auth')
export class AuthController {
  @Get('me')
  @UseGuards(SupabaseAuthGuard)
  me(@CurrentUser() user: User) {
    return { id: user.id, email: user.email };
  }
}
