// MailModule: gom MailService (gửi email) + MailController (endpoint test).
// Export MailService để các module khác (vd ReminderModule) import và tái sử dụng.

import { Module } from '@nestjs/common';
import { MailController } from './mail.controller';
import { MailService } from './mail.service';

@Module({
  controllers: [MailController],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
