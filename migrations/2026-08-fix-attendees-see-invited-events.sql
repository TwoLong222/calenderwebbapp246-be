-- =========================================================================
-- FIX — Cho KHÁCH MỜI thấy sự kiện họ được mời (và cập nhật TỨC THÌ qua Realtime)
-- =========================================================================
-- Vấn đề: sự kiện nằm trên lịch của NGƯỜI TẠO. Khách được mời không có quyền ĐỌC
-- sự kiện đó -> sau khi "Đồng ý", lịch của khách không hiện gì; và Supabase Realtime
-- (WebSocket) cũng KHÔNG bắn cập nhật cho khách vì Realtime tôn trọng RLS — chỉ giao
-- tin về những dòng mà user có quyền SELECT.
--
-- Sửa: thêm 2 policy (đúng như trong calendar_schema.sql):
--   1) Khách ĐỌC được sự kiện mà email của họ nằm trong khách mời (event_attendees).
--   2) Khách ĐỌC/đổi trạng thái dòng attendee CỦA CHÍNH MÌNH.
-- => Khách vừa thấy sự kiện, vừa được Realtime cập nhật ngay không cần F5.
--
-- Dùng hàm SECURITY DEFINER để tránh RLS đệ quy khi policy của events lại truy vấn
-- event_attendees. File chỉ THÊM (policy permissive cộng dồn OR). Chạy lại nhiều lần
-- vẫn an toàn, KHÔNG xóa dữ liệu.
-- =========================================================================

-- Hàm: email của user hiện tại có nằm trong khách mời của sự kiện eid không?
create or replace function is_event_attendee(eid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from event_attendees a
    where a.event_id = eid
      and lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- (1) Khách ĐỌC được sự kiện họ được mời.
drop policy if exists "attendees read invited events" on events;
create policy "attendees read invited events" on events
  for select using (is_event_attendee(id));

-- (2) Khách ĐỌC + đổi trạng thái dòng attendee CỦA CHÍNH MÌNH (cần cho Realtime
--     bắn thay đổi RSVP về đúng khách, và để khách đọc danh sách khách mời).
drop policy if exists "Users manage their own attendee row" on event_attendees;
create policy "Users manage their own attendee row"
  on event_attendees for all
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')))
  with check (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

-- =========================================================================
-- ROLLBACK (bỏ comment nếu muốn gỡ)
-- =========================================================================
-- drop policy if exists "attendees read invited events" on events;
-- drop policy if exists "Users manage their own attendee row" on event_attendees;
-- drop function if exists is_event_attendee(uuid);
