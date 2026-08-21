import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [AuthModule, SettingsModule],
  controllers: [AiController],
  providers: [AiService],
})
export class AiModule {}
