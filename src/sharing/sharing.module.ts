import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { SharingService } from './sharing.service';
import { SharingController } from './sharing.controller';

@Module({
  imports: [AuthModule, MailModule],
  controllers: [SharingController],
  providers: [SharingService],
})
export class SharingModule {}
