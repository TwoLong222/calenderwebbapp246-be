// /api/booking — CHỦ trang tự quản lý cấu hình đặt lịch (yêu cầu đăng nhập).
import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import type { User } from '@supabase/supabase-js';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { BookingService } from './booking.service';
import { UpdateBookingPageDto } from './dto/update-booking-page.dto';

@UseGuards(SupabaseAuthGuard)
@Controller('booking')
export class BookingController {
  constructor(private readonly booking: BookingService) {}

  @Get('me')
  getMine(@Req() req: any, @CurrentUser() user: User) {
    return this.booking.getOrCreateOwnPage(req.supabase, user.id, user.email ?? '');
  }

  @Patch('me')
  updateMine(
    @Req() req: any,
    @CurrentUser() user: User,
    @Body() dto: UpdateBookingPageDto,
  ) {
    return this.booking.updateOwnPage(req.supabase, user.id, dto);
  }
}
