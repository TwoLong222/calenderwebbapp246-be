// AiController: POST /api/ai/chat — nhận câu người dùng, trả về ý định đã phân tích.
// Yêu cầu đăng nhập (SupabaseAuthGuard). Không tạo/sửa/xóa gì — chỉ phân tích.

import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import type { User } from '@supabase/supabase-js';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { AiService } from './ai.service';
import { AiChatDto } from './dto/ai-chat.dto';
import { ExtractEventsDto } from './dto/extract-events.dto';

@UseGuards(SupabaseAuthGuard)
@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Post('chat')
  chat(@CurrentUser() user: User, @Body() dto: AiChatDto) {
    return this.ai.parseCommand(user.id, dto.message, dto.history);
  }

  /** Trích danh sách sự kiện từ text đọc được của 1 file PDF (dùng cho tính năng Nhập PDF). */
  @Post('extract-events')
  extractEvents(@CurrentUser() user: User, @Body() dto: ExtractEventsDto) {
    return this.ai.extractEventsFromText(user.id, dto.text);
  }
}
