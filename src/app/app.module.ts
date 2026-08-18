import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { ScheduleModule } from '@nestjs/schedule';
import { EventsModule } from '../events/events.module';
import { ReminderModule } from '../reminder/reminder.module';
import { MailModule } from '../mail/mail.module';
import { CommentsModule } from '../comments/comments.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    AuthModule,
    EventsModule,
    ReminderModule,
    MailModule,
    CommentsModule,
    AiModule,],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
