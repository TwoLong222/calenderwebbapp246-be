// Decorator tiện dụng: dùng @CurrentUser() trong tham số của controller method
// để lấy trực tiếp user Supabase đã được SupabaseAuthGuard xác thực,
// thay vì phải tự viết request.user mỗi lần.
//
// Ví dụ: me(@CurrentUser() user: User) { return user.email; }

import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { User } from '@supabase/supabase-js';

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): User => {
  const request = ctx.switchToHttp().getRequest();
  return request.user;
});
