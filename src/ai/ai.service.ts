// AiService: gọi Gemini để PHÂN TÍCH câu tiếng Việt thành ý định + dữ liệu sự kiện.
//
// QUAN TRỌNG (bảo mật): service này CHỈ phân tích câu, KHÔNG tự tạo/sửa/xóa gì trong DB.
// Việc tạo event thật do frontend gọi lại API events có sẵn (đã có auth + RLS) sau khi
// người dùng bấm Xác nhận. AI không bao giờ chạm thẳng vào database.

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface AiParseResult {
  intent: 'create_event' | 'unclear';
  title?: string;
  startTime?: string; // ISO 8601
  endTime?: string; // ISO 8601
  reply: string; // câu phản hồi cho người dùng
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly MODEL = 'gemini-2.0-flash';

  // Rate-limit đơn giản trong bộ nhớ: tối đa 20 request / user / giờ
  private readonly hits = new Map<string, number[]>();
  private readonly LIMIT = 20;
  private readonly WINDOW_MS = 60 * 60 * 1000;

  constructor(private readonly config: ConfigService) {}

  private checkRateLimit(userId: string): void {
    const now = Date.now();
    const arr = (this.hits.get(userId) ?? []).filter((t) => now - t < this.WINDOW_MS);
    if (arr.length >= this.LIMIT) {
      throw new Error('Bạn đã dùng trợ lý AI quá nhiều trong 1 giờ. Thử lại sau nhé.');
    }
    arr.push(now);
    this.hits.set(userId, arr);
  }

  async parseCommand(userId: string, userText: string): Promise<AiParseResult> {
    this.checkRateLimit(userId);

    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      return { intent: 'unclear', reply: 'Trợ lý AI chưa được cấu hình (thiếu GEMINI_API_KEY).' };
    }

    const now = new Date();
    const systemPrompt = `Bạn là trợ lý lịch tiếng Việt. Bây giờ là ${now.toISOString()} (giờ Việt Nam UTC+7).
Người dùng nói 1 câu để TẠO sự kiện. Hãy trả về DUY NHẤT một JSON đúng schema dưới đây, KHÔNG thêm chữ nào khác, KHÔNG markdown:
{
  "intent": "create_event" hoặc "unclear",
  "title": "tiêu đề sự kiện, ngắn gọn",
  "startTime": "thời điểm bắt đầu dạng ISO 8601, suy luận từ câu nói và ngày hôm nay",
  "endTime": "thời điểm kết thúc dạng ISO 8601; nếu không rõ thời lượng thì mặc định 1 tiếng sau startTime",
  "reply": "một câu tiếng Việt ngắn xác nhận lại điều bạn hiểu"
}
Quy tắc:
- "mai"/"ngày mai" = ngày hôm sau; "chiều" nếu không có giờ cụ thể thì hiểu là giờ đã nêu.
- Nếu KHÔNG suy ra được thời gian rõ ràng, đặt "intent":"unclear" và "reply" hỏi lại người dùng.`;

    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this.MODEL}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${systemPrompt}\n\nCâu người dùng: "${userText}"` }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
        }),
      });

      const data: any = await res.json();
      if (!res.ok) {
        this.logger.error(`Gemini lỗi ${res.status}: ${JSON.stringify(data?.error ?? data)}`);
        return { intent: 'unclear', reply: 'Trợ lý AI đang gặp lỗi kết nối. Thử lại sau nhé.' };
      }

      const raw: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!raw) return { intent: 'unclear', reply: 'Xin lỗi, mình chưa hiểu ý bạn.' };

      const parsed = JSON.parse(raw) as AiParseResult;
      if (parsed.intent !== 'create_event') {
        return { intent: 'unclear', reply: parsed.reply || 'Bạn nói rõ hơn về thời gian giúp mình nhé.' };
      }
      return parsed;
    } catch (e) {
      this.logger.error('Lỗi gọi/parse Gemini', e as Error);
      return { intent: 'unclear', reply: 'Xin lỗi, mình chưa xử lý được câu này. Thử diễn đạt khác nhé.' };
    }
  }
}
