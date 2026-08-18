// AiService: gọi Gemini để PHÂN TÍCH câu tiếng Việt thành ý định + dữ liệu sự kiện.
//
// QUAN TRỌNG (bảo mật): service này CHỈ phân tích câu, KHÔNG tự tạo/sửa/xóa gì trong DB.
// Việc tạo event thật do frontend gọi lại API events có sẵn (đã có auth + RLS) sau khi
// người dùng bấm Xác nhận. AI không bao giờ chạm thẳng vào database.

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface AiParseResult {
  intent: 'create_event' | 'search_events' | 'reschedule_event' | 'delete_event' | 'unclear';
  // create_event
  title?: string;
  startTime?: string; // ISO 8601
  endTime?: string; // ISO 8601
  // search / reschedule / delete: từ khóa tên sự kiện cần thao tác
  query?: string;
  // search: khoảng thời gian (vd "tuần này")
  rangeStart?: string;
  rangeEnd?: string;
  // reschedule: giờ mới
  newStartTime?: string;
  newEndTime?: string;
  reply: string; // câu phản hồi cho người dùng
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly MODEL = 'gemini-3.6-flash';

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
Người dùng nói 1 câu để thao tác lịch. Xác định Ý ĐỊNH và trả về DUY NHẤT một JSON đúng schema, KHÔNG thêm chữ nào khác, KHÔNG markdown:
{
  "intent": "create_event" | "search_events" | "reschedule_event" | "delete_event" | "unclear",
  "title": "chỉ dùng cho create_event: tiêu đề ngắn gọn",
  "startTime": "create_event: ISO 8601 giờ bắt đầu",
  "endTime": "create_event: ISO 8601 giờ kết thúc, mặc định +1 tiếng nếu không rõ",
  "query": "search/reschedule/delete: từ khóa TÊN sự kiện cần tìm/dời/xóa (vd 'họp nhóm')",
  "rangeStart": "search: ISO 8601 đầu khoảng thời gian nếu có (vd 'tuần này')",
  "rangeEnd": "search: ISO 8601 cuối khoảng",
  "newStartTime": "reschedule: ISO 8601 giờ bắt đầu MỚI",
  "newEndTime": "reschedule: ISO 8601 giờ kết thúc mới nếu người dùng nêu",
  "reply": "một câu tiếng Việt ngắn. Với create/reschedule/delete: mô tả điều SẼ làm — KHÔNG nói 'đã ...' vì cần bấm Xác nhận"
}
Ví dụ ý định:
- "mai 3h chiều họp nhóm 1 tiếng" -> create_event
- "tuần này có họp gì" -> search_events (query rỗng, range = tuần này)
- "tìm sự kiện tập gym" -> search_events (query="tập gym")
- "dời họp nhóm sang 4h chiều" -> reschedule_event (query="họp nhóm", newStartTime=...)
- "xóa họp nhóm ngày mai" -> delete_event (query="họp nhóm")
Quy tắc: "mai"=ngày hôm sau. Chỉ điền field liên quan tới intent. Không rõ -> "unclear" + hỏi lại.`;

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
      if (!parsed?.intent) return { intent: 'unclear', reply: parsed?.reply || 'Xin lỗi, mình chưa hiểu ý bạn.' };
      return parsed;
    } catch (e) {
      this.logger.error('Lỗi gọi/parse Gemini', e as Error);
      return { intent: 'unclear', reply: 'Xin lỗi, mình chưa xử lý được câu này. Thử diễn đạt khác nhé.' };
    }
  }
}
