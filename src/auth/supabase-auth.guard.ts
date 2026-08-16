// Guard bảo vệ route: kiểm tra header "Authorization: Bearer <access_token>"
// gửi từ Angular, xác thực token đó với Supabase, rồi gắn user + 1 Supabase client
// (đã có sẵn JWT, tuân theo RLS) vào request để controller phía sau dùng.
//
// Cách dùng: @UseGuards(SupabaseAuthGuard) trên controller hoặc từng route method.

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(private readonly supabaseService: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Thiếu access token (header Authorization).');
    }

    const token = authHeader.slice('Bearer '.length);

    const { data, error } = await this.supabaseService.adminClient.auth.getUser(token);

    if (error || !data.user) {
      throw new UnauthorizedException('Access token không hợp lệ hoặc đã hết hạn.');
    }

    // Gắn vào request để @CurrentUser() decorator và các controller sau lấy ra dùng
    request.user = data.user;
    request.supabase = this.supabaseService.getClientForUser(token);

    return true;
  }
}
