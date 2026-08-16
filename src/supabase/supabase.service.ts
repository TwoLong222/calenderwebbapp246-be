// SupabaseService: nơi DUY NHẤT trong backend tạo Supabase client.
//
// Có 2 loại client:
// 1. adminClient — dùng SERVICE_ROLE_KEY, có quyền BYPASS RLS hoàn toàn.
//    Chỉ dùng cho việc xác thực JWT (auth.getUser) và các tác vụ hệ thống nội bộ
//    (vd: sau này viết cron job gửi email nhắc lịch cần đọc mọi event bất kể của ai).
//    KHÔNG dùng adminClient để truy vấn dữ liệu thay mặt người dùng.
//
// 2. getClientForUser(token) — dùng ANON_KEY + gắn kèm JWT của người dùng vào header.
//    Mọi truy vấn qua client này sẽ TỰ ĐỘNG tuân theo đúng RLS policy đã viết trong
//    calendar_schema.sql, vì Supabase nhận diện đúng auth.uid() từ JWT gửi lên.
//    -> Đây là client mà các API sự kiện/lịch (Giai đoạn sau) sẽ dùng.

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  readonly adminClient: SupabaseClient;

  constructor(private readonly config: ConfigService) {
    const url = this.config.get<string>('SUPABASE_URL');
    const serviceRoleKey = this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY');

    if (!url || !serviceRoleKey) {
      throw new Error(
        'Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong file apps/api/.env — kiểm tra lại file .env đã điền đủ giá trị chưa.',
      );
    }

    this.adminClient = createClient(url, serviceRoleKey);
  }

  /** Trả về 1 Supabase client mới, gắn JWT của user hiện tại -> mọi query qua client này tuân theo RLS */
  getClientForUser(accessToken: string): SupabaseClient {
    const url = this.config.get<string>('SUPABASE_URL')!;
    const anonKey = this.config.get<string>('SUPABASE_ANON_KEY')!;

    return createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false },
    });
  }
}
