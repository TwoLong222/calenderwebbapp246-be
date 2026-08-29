// AttachmentsService: upload/list/xoá tài liệu đính kèm sự kiện.
//
// - File bytes: upload/download qua adminClient (bucket private 'event-files').
// - Metadata (bảng event_attachments): thao tác qua `supabase` gắn JWT -> RLS quyết định
//   ai được XEM (xem được event) và ai được QUẢN LÝ (ghi được event).

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';

const BUCKET = 'event-files';
const MAX_BYTES = 10 * 1024 * 1024; // 10MB

/** Kiểu tối giản cho file từ Multer (né phụ thuộc @types/multer). */
interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class AttachmentsService {
  constructor(private readonly supabaseService: SupabaseService) {}

  private get admin() {
    return this.supabaseService.adminClient;
  }

  async upload(
    supabase: SupabaseClient,
    userId: string,
    eventId: string,
    file: UploadedFileLike,
    availableFrom?: string | null,
    availableUntil?: string | null,
  ) {
    if (!file) throw new BadRequestException('Thiếu file.');
    if (file.size > MAX_BYTES) {
      throw new BadRequestException('File quá lớn (tối đa 10MB).');
    }

    const from = this.parseDate(availableFrom);
    const until = this.parseDate(availableUntil);
    if (from && until && until.getTime() <= from.getTime()) {
      throw new BadRequestException('Thời gian "đến" phải sau "mở từ".');
    }

    // Multer đọc tên file trong header dạng latin1 -> tên tiếng Việt bị lỗi font.
    // Giải mã lại về UTF-8 để giữ đúng dấu (vd "Phiếu thông tin sinh viên").
    const displayName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const safeName = displayName.replace(/[^\w.\-]+/g, '_').slice(0, 120);
    const path = `${eventId}/${randomUUID()}-${safeName}`;

    const up = await this.admin.storage
      .from(BUCKET)
      .upload(path, file.buffer, { contentType: file.mimetype, upsert: false });
    if (up.error) throw new BadRequestException(up.error.message);

    // Insert metadata qua client user -> RLS kiểm tra quyền GHI event.
    // Gate cột lịch chỉ ghi khi cột tồn tại (phòng khi migration chưa chạy).
    const row: Record<string, unknown> = {
      event_id: eventId,
      file_path: path,
      file_name: displayName,
      mime_type: file.mimetype,
      size_bytes: file.size,
      uploaded_by: userId,
    };
    if (from) row['available_from'] = from.toISOString();
    if (until) row['available_until'] = until.toISOString();

    let ins = await supabase
      .from('event_attachments')
      .insert(row)
      .select('id, file_name, mime_type, size_bytes, created_at')
      .single();

    // Nếu cột chưa tồn tại (migration chưa chạy) -> thử lại không kèm lịch.
    if (ins.error && /available_from|available_until|column/i.test(ins.error.message)) {
      delete row['available_from'];
      delete row['available_until'];
      ins = await supabase
        .from('event_attachments')
        .insert(row)
        .select('id, file_name, mime_type, size_bytes, created_at')
        .single();
    }

    if (ins.error) {
      // Không có quyền / lỗi -> xoá file vừa upload để không rác.
      await this.admin.storage.from(BUCKET).remove([path]);
      throw new ForbiddenException('Bạn không có quyền đính kèm cho sự kiện này.');
    }
    return ins.data;
  }

  async list(supabase: SupabaseClient, userId: string, eventId: string) {
    // Chọn '*' để lấy cả cột lịch (nếu có); không lỗi khi cột chưa tồn tại.
    const { data, error } = await supabase
      .from('event_attachments')
      .select('*')
      .eq('event_id', eventId)
      .order('created_at', { ascending: true });
    if (error) throw new BadRequestException(error.message);

    const now = Date.now();
    const out: any[] = [];
    for (const a of data ?? []) {
      const from = a.available_from ? new Date(a.available_from).getTime() : null;
      const until = a.available_until ? new Date(a.available_until).getTime() : null;
      // Người tải LÊN luôn xem được (để quản lý); khách bị chặn theo giờ.
      const isOwner = a.uploaded_by === userId;
      let status: 'available' | 'scheduled' | 'expired' = 'available';
      if (!isOwner) {
        if (from && now < from) status = 'scheduled';
        else if (until && now > until) status = 'expired';
      }
      // Chỉ tạo link tải khi được phép xem.
      let url: string | null = null;
      if (status === 'available') {
        const signed = await this.admin.storage.from(BUCKET).createSignedUrl(a.file_path, 60 * 60);
        url = signed.data?.signedUrl ?? null;
      }
      out.push({
        id: a.id,
        file_name: a.file_name,
        mime_type: a.mime_type,
        size_bytes: a.size_bytes,
        created_at: a.created_at,
        available_from: a.available_from ?? null,
        available_until: a.available_until ?? null,
        status,
        url,
      });
    }
    return out;
  }

  /**
   * Tài liệu vừa TỚI GIỜ MỞ trong 24h qua, thuộc sự kiện user xem được (RLS lo phần quyền).
   * Dùng cho thông báo TRONG APP. Bỏ file do chính user tải lên.
   */
  async recentAvailable(supabase: SupabaseClient, userId: string) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('event_attachments')
      .select('id, file_name, event_id, available_from, uploaded_by, events(title)')
      .not('available_from', 'is', null)
      .gte('available_from', since)
      .lte('available_from', now);
    if (error) return []; // cột chưa tồn tại / lỗi -> coi như không có
    return (data ?? [])
      .filter((a: any) => a.uploaded_by !== userId)
      .map((a: any) => ({
        id: a.id,
        file_name: a.file_name,
        event_id: a.event_id,
        event_title: a.events?.title ?? '',
        available_from: a.available_from,
      }));
  }

  /**
   * TẤT CẢ tài liệu thuộc các sự kiện user xem được (RLS lo phần quyền), GOM NHÓM theo sự kiện.
   * Dùng cho mục "Tệp đính kèm" trong Cài đặt — mỗi nhóm gồm thông tin sự kiện + danh sách file.
   */
  async listAllForUser(supabase: SupabaseClient, userId: string) {
    const { data, error } = await supabase
      .from('event_attachments')
      .select('*, events(id, title, start_time)')
      .order('created_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);

    const now = Date.now();
    const groups = new Map<
      string,
      { event_id: string; event_title: string; event_start: string | null; files: any[] }
    >();

    for (const a of (data ?? []) as any[]) {
      const ev = a.events ?? null;
      const from = a.available_from ? new Date(a.available_from).getTime() : null;
      const until = a.available_until ? new Date(a.available_until).getTime() : null;
      const isOwner = a.uploaded_by === userId;
      let status: 'available' | 'scheduled' | 'expired' = 'available';
      if (!isOwner) {
        if (from && now < from) status = 'scheduled';
        else if (until && now > until) status = 'expired';
      }
      // Chỉ tạo link tải khi được phép xem.
      let url: string | null = null;
      if (status === 'available') {
        const signed = await this.admin.storage.from(BUCKET).createSignedUrl(a.file_path, 60 * 60);
        url = signed.data?.signedUrl ?? null;
      }

      if (!groups.has(a.event_id)) {
        groups.set(a.event_id, {
          event_id: a.event_id,
          event_title: ev?.title ?? '(Sự kiện không còn)',
          event_start: ev?.start_time ?? null,
          files: [],
        });
      }
      groups.get(a.event_id)!.files.push({
        id: a.id,
        event_id: a.event_id,
        file_name: a.file_name,
        mime_type: a.mime_type,
        size_bytes: a.size_bytes,
        created_at: a.created_at,
        available_from: a.available_from ?? null,
        available_until: a.available_until ?? null,
        status,
        url,
      });
    }

    // Nhóm có sự kiện diễn ra gần/mới nhất lên đầu; nhóm không rõ thời gian xuống cuối.
    return [...groups.values()].sort((x, y) => {
      const tx = x.event_start ? new Date(x.event_start).getTime() : -Infinity;
      const ty = y.event_start ? new Date(y.event_start).getTime() : -Infinity;
      return ty - tx;
    });
  }

  /** Chuỗi ISO -> Date, bỏ qua rỗng/không hợp lệ. */
  private parseDate(v?: string | null): Date | null {
    if (!v) return null;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }

  async remove(supabase: SupabaseClient, eventId: string, attId: string) {
    const { data: row } = await supabase
      .from('event_attachments')
      .select('id, file_path')
      .eq('id', attId)
      .eq('event_id', eventId)
      .maybeSingle();
    if (!row) throw new NotFoundException('Không tìm thấy tệp đính kèm.');

    const { error, count } = await supabase
      .from('event_attachments')
      .delete({ count: 'exact' })
      .eq('id', attId);
    if (error) throw new BadRequestException(error.message);
    if (!count) throw new ForbiddenException('Bạn không có quyền xoá tệp này.');

    await this.admin.storage.from(BUCKET).remove([row.file_path]);
    return { success: true };
  }
}
