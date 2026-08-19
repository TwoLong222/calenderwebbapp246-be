// AiService: gọi Gemini để PHÂN TÍCH câu tiếng Việt thành ý định + dữ liệu sự kiện.
//
// QUAN TRỌNG (bảo mật): service này CHỈ phân tích câu, KHÔNG tự tạo/sửa/xóa gì trong DB.
// Việc tạo event thật do frontend gọi lại API events có sẵn (đã có auth + RLS) sau khi
// người dùng bấm Xác nhận. AI không bao giờ chạm thẳng vào database.

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SettingsService } from '../settings/settings.service';

export interface AiParseResult {
  intent: 'create_event' | 'plan_schedule' | 'search_events' | 'reschedule_event' | 'delete_event' | 'unclear';
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
  count?: number;
  durationMinutes?: number;
  planStart?: string;
  planEnd?: string;
  preferredStartHour?: number;
  preferredEndHour?: number;
  allowedWeekdays?: number[];
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

  constructor(
    private readonly config: ConfigService,
    private readonly settings: SettingsService,
  ) {}

  /** Chặn hành động AI theo ai_settings của user (defense-in-depth, không chỉ ẩn UI). */
  private enforceAiPermission(result: AiParseResult, ai: any): AiParseResult {
    const denied = (label: string): AiParseResult => ({
      intent: 'unclear',
      reply: `Bạn đã tắt quyền ${label} của AI trong Cài đặt → Trợ lý AI.`,
    });
    switch (result.intent) {
      case 'create_event':
        return ai?.allow_create === false ? denied('tạo sự kiện') : result;
      case 'reschedule_event':
        return ai?.allow_update === false ? denied('cập nhật sự kiện') : result;
      case 'delete_event':
        return ai?.allow_delete === false ? denied('xoá sự kiện') : result;
      case 'search_events':
      case 'plan_schedule':
        return ai?.allow_search === false ? denied('tìm kiếm lịch') : result;
      default:
        return result;
    }
  }

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

    // PHASE 5: AI bị tắt trong Cài đặt -> không xử lý.
    const ai = (await this.settings.adminGetSettings(userId)).ai_settings ?? {};
    if (ai.enabled === false) {
      return { intent: 'unclear', reply: 'Trợ lý AI đang tắt. Bật lại trong Cài đặt → Trợ lý AI.' };
    }

    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      return { intent: 'unclear', reply: 'Trợ lý AI chưa được cấu hình (thiếu GEMINI_API_KEY).' };
    }

    const now = new Date();
    const systemPrompt = `Bạn là trợ lý lịch tiếng Việt. Bây giờ là ${now.toISOString()} (giờ Việt Nam UTC+7).
Người dùng nói 1 câu để thao tác lịch. Xác định Ý ĐỊNH và trả về DUY NHẤT một JSON đúng schema, KHÔNG thêm chữ nào khác, KHÔNG markdown:
{
  "intent": "create_event" | "plan_schedule" | "search_events" | "reschedule_event" | "delete_event" | "unclear",
  "count": "plan_schedule only: number of sessions, default 1",
  "durationMinutes": "plan_schedule only: minutes per session, default 60",
  "planStart": "plan_schedule only: ISO start of planning window",
  "planEnd": "plan_schedule only: ISO end of planning window",
  "preferredStartHour": "plan_schedule only: earliest local hour (0-23)",
  "preferredEndHour": "plan_schedule only: latest local hour (0-24)",
  "allowedWeekdays": "plan_schedule only: allowed JS weekdays, Sunday=0 through Saturday=6",
  "planningRule": "Use plan_schedule when user asks to schedule multiple sessions into free time. The client chooses exact free slots; never invent them.",
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
Quy tắc QUAN TRỌNG:
- "mai"=ngày hôm sau, "thứ 4 tuần sau"... -> suy ra được NGÀY là ok.
- Nhưng GIỜ thì KHÔNG được tự chế. Nếu người dùng KHÔNG nói giờ cụ thể (vd "mai đi học" — thiếu giờ),
  BẮT BUỘC trả "intent":"unclear" và "reply" hỏi lại giờ (vd "Mấy giờ vậy bạn?"). TUYỆT ĐỐI không mặc định 8:00 hay giờ bất kỳ.
- Thời LƯỢNG thì được mặc định 1 tiếng nếu người dùng không nói.
- reschedule: nếu không có giờ mới -> "unclear" hỏi "Dời sang lúc nào?".
- Chỉ điền field liên quan tới intent. Không rõ ý -> "unclear" + hỏi lại.`;

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.MODEL}:generateContent`;
      const reqBody = JSON.stringify({
        contents: [{ parts: [{ text: `${systemPrompt}\n\nCâu người dùng: "${userText}"` }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
      });

      // Model có thể bị quá tải (503) hoặc rate-limit (429) tạm thời -> tự thử lại tối đa 3 lần
      let data: any;
      let ok = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: reqBody,
        });
        data = await res.json();
        if (res.ok) {
          ok = true;
          break;
        }
        if ((res.status === 503 || res.status === 429) && attempt < 3) {
          this.logger.warn(`Gemini ${res.status} (quá tải), thử lại lần ${attempt}...`);
          await new Promise((r) => setTimeout(r, 1000 * attempt));
          continue;
        }
        this.logger.error(`Gemini lỗi ${res.status}: ${JSON.stringify(data?.error ?? data)}`);
        break;
      }

      if (!ok) {
        return { intent: 'unclear', reply: 'Trợ lý AI đang quá tải, bạn thử lại sau vài giây nhé.' };
      }

      const raw: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!raw) return { intent: 'unclear', reply: 'Xin lỗi, mình chưa hiểu ý bạn.' };

      const parsed = JSON.parse(raw) as AiParseResult;
      if (!parsed?.intent) return { intent: 'unclear', reply: parsed?.reply || 'Xin lỗi, mình chưa hiểu ý bạn.' };
      return this.enforceAiPermission(parsed, ai);
    } catch (e) {
      this.logger.error('Lỗi gọi/parse Gemini', e as Error);
      return { intent: 'unclear', reply: 'Xin lỗi, mình chưa xử lý được câu này. Thử diễn đạt khác nhé.' };
    }
  }
}
