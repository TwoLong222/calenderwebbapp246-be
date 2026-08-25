// /api/public/calendar/:token(.ics) — KHÔNG cần đăng nhập.
// Trả về chuỗi iCalendar để Google/Outlook/Apple Calendar "Subscribe".
import { Controller, Get, Header, Param } from '@nestjs/common';
import { FeedService } from './feed.service';

@Controller('public/calendar')
export class PublicFeedController {
  constructor(private readonly feed: FeedService) {}

  @Get(':token')
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  @Header('Content-Disposition', 'inline; filename="calendar.ics"')
  @Header('Cache-Control', 'public, max-age=3600')
  ics(@Param('token') token: string): Promise<string> {
    return this.feed.getIcs(token);
  }
}
