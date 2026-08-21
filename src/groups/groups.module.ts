import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';
import { SchedulingGateway } from './scheduling.gateway';

// GroupsModule: nhóm lên lịch cùng nhau.
// Import AuthModule để dùng SupabaseAuthGuard + SupabaseService (adminClient cho gateway).
@Module({
  imports: [AuthModule],
  controllers: [GroupsController],
  providers: [GroupsService, SchedulingGateway],
})
export class GroupsModule {}
