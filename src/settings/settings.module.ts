// SettingsModule: gom SettingsController + SettingsService.
// Import AuthModule để dùng SupabaseAuthGuard + SupabaseService.
// Export SettingsService để ReminderModule/MailModule kiểm tra email_preferences.

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SettingsController } from './settings.controller';
import { AccountController } from './account.controller';
import { SettingsService } from './settings.service';

@Module({
  imports: [AuthModule],
  controllers: [SettingsController, AccountController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
