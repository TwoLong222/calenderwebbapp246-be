import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SettingsModule } from '../settings/settings.module';
import { MailModule } from '../mail/mail.module';
import { BookingService } from './booking.service';
import { BookingController } from './booking.controller';
import { PublicBookingController } from './public-booking.controller';

@Module({
  imports: [AuthModule, SettingsModule, MailModule],
  controllers: [BookingController, PublicBookingController],
  providers: [BookingService],
})
export class BookingModule {}
