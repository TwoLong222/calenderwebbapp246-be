import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { ReminderService } from './reminder.service';
import { AuthModule } from '../auth/auth.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [AuthModule, MailModule, SettingsModule],
  providers: [ReminderService],
})
export class ReminderModule {}