import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';
import { GroupRealtimeGateway } from './scheduling.gateway';

// GroupsModule — Gom mọi thành phần của tính năng nhóm (nhận yêu cầu, xử lý, real-time) thành một khối.
@Module({
  imports: [AuthModule],
  controllers: [GroupsController],
  providers: [GroupsService, GroupRealtimeGateway],
})
export class GroupsModule {}
