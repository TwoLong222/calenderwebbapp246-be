import { Module } from '@nestjs/common';
import { MailService } from '../mail/mail.service';
import { ReminderService } from './reminder.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [MailService, ReminderService],
})
export class ReminderModule {}