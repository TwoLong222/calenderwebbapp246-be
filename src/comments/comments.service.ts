// CommentsService: đọc/ghi bảng event_comments.
// Dùng `supabase` gắn JWT của user (từ controller) -> RLS tự lo phân quyền:
//   - chỉ đọc comment của event mình truy cập được (chủ hoặc khách mời)
//   - chỉ sửa comment của mình; xóa comment của mình hoặc chủ event xóa được.

import { Injectable } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class CommentsService {
  async list(supabase: SupabaseClient, eventId: string) {
    const { data, error } = await supabase
      .from('event_comments')
      .select('*')
      .eq('event_id', eventId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data ?? [];
  }

  async create(supabase: SupabaseClient, eventId: string, userId: string, userEmail: string, content: string) {
    const { data, error } = await supabase
      .from('event_comments')
      .insert({ event_id: eventId, user_id: userId, user_email: userEmail, content })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async update(supabase: SupabaseClient, id: string, content: string) {
    const { data, error } = await supabase
      .from('event_comments')
      .update({ content })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async remove(supabase: SupabaseClient, id: string) {
    const { error } = await supabase.from('event_comments').delete().eq('id', id);
    if (error) throw error;
    return { id };
  }
}
