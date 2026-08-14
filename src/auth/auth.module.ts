// AuthModule: gom SupabaseService + SupabaseAuthGuard + AuthController lại với nhau.
// Export SupabaseService và SupabaseAuthGuard để các module khác (vd EventsModule ở
// Giai đoạn sau) import và tái sử dụng, không phải tạo lại.

import { Module } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { AuthController } from './auth.controller';
import { SupabaseAuthGuard } from './supabase-auth.guard';

@Module({
  controllers: [AuthController],
  providers: [SupabaseService, SupabaseAuthGuard],
  exports: [SupabaseService, SupabaseAuthGuard],
})
export class AuthModule {}
