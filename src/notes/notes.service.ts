// NotesService: CRUD ghi chú (kiểu Keep). Dùng client gắn JWT -> RLS đảm bảo
// user chỉ đọc/ghi ghi chú của chính mình. Sắp xếp: ghim trước, mới cập nhật trước.

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CreateNoteDto } from './dto/create-note.dto';
import { UpdateNoteDto } from './dto/update-note.dto';

const COLUMNS = 'id, title, content, color, pinned, created_at, updated_at';

@Injectable()
export class NotesService {
  async list(supabase: SupabaseClient) {
    const { data, error } = await supabase
      .from('notes')
      .select(COLUMNS)
      .order('pinned', { ascending: false })
      .order('updated_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async create(supabase: SupabaseClient, userId: string, dto: CreateNoteDto) {
    const { data, error } = await supabase
      .from('notes')
      .insert({
        user_id: userId,
        title: dto.title ?? '',
        content: dto.content ?? '',
        color: dto.color ?? 'default',
        pinned: dto.pinned ?? false,
      })
      .select(COLUMNS)
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async update(supabase: SupabaseClient, id: string, dto: UpdateNoteDto) {
    const patch: Record<string, unknown> = {};
    for (const k of ['title', 'content', 'color', 'pinned'] as const) {
      if (dto[k] !== undefined) patch[k] = dto[k];
    }
    if (Object.keys(patch).length === 0) {
      const { data } = await supabase.from('notes').select(COLUMNS).eq('id', id).maybeSingle();
      if (!data) throw new NotFoundException('Không tìm thấy ghi chú.');
      return data;
    }
    const { data, error } = await supabase
      .from('notes')
      .update(patch)
      .eq('id', id)
      .select(COLUMNS)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Không tìm thấy ghi chú (hoặc không có quyền).');
    return data;
  }

  async remove(supabase: SupabaseClient, id: string) {
    const { error, count } = await supabase
      .from('notes')
      .delete({ count: 'exact' })
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    if (!count) throw new NotFoundException('Không tìm thấy ghi chú (hoặc không có quyền).');
    return { success: true };
  }
}
