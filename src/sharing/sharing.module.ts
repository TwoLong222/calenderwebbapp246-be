import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SharingService } from './sharing.service';
import { SharingController } from './sharing.controller';

@Module({
  imports: [AuthModule],
  controllers: [SharingController],
  providers: [SharingService],
})
export class SharingModule {}
