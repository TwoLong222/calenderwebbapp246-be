import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { AttachmentsService } from './attachments.service';
import { AttachmentsController } from './attachments.controller';
import { AttachmentReminderService } from './attachment-reminder.service';

@Module({
  imports: [AuthModule, MailModule],
  controllers: [AttachmentsController],
  providers: [AttachmentsService, AttachmentReminderService],
})
export class AttachmentsModule {}
