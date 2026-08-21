// /api/public/booking — KHÔNG cần đăng nhập. Người ngoài xem khung trống + đặt lịch.
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { BookingService } from './booking.service';
import { CreateBookingDto } from './dto/create-booking.dto';

@Controller('public/booking')
export class PublicBookingController {
  constructor(private readonly booking: BookingService) {}

  @Get(':slug')
  page(@Param('slug') slug: string) {
    return this.booking.getPublicPage(slug);
  }

  @Get(':slug/slots')
  slots(@Param('slug') slug: string) {
    return this.booking.getSlots(slug);
  }

  @Post(':slug')
  book(@Param('slug') slug: string, @Body() dto: CreateBookingDto) {
    return this.booking.createBooking(slug, dto);
  }
}
