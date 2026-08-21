import { Module } from '@nestjs/common';
import { EventsController } from './events.controller';
import { EventResponseController } from './event-response.controller';
import { EventsService } from './events.service';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [AuthModule, MailModule, SettingsModule],
  controllers: [EventsController, EventResponseController],
  providers: [EventsService],
})
export class EventsModule {}