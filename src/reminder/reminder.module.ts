import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { ReminderService } from './reminder.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule, MailModule],
  providers: [ReminderService],
})
export class ReminderModule {}