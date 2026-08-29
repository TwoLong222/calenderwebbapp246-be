import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { SettingsModule } from '../settings/settings.module';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';
import { GroupRealtimeGateway } from './scheduling.gateway';

// GroupsModule — Gom mọi thành phần của tính năng nhóm (nhận yêu cầu, xử lý, real-time) thành một khối.
@Module({
  // MailModule: gửi email mời nhóm. SettingsModule: tôn trọng công tắc email của người nhận.
  imports: [AuthModule, MailModule, SettingsModule],
  controllers: [GroupsController],
  providers: [GroupsService, GroupRealtimeGateway],
})
export class GroupsModule {}
