-- =====================================================================
-- PHASE 9 — KHÁCH CHỈ THẤY SỰ KIỆN SAU KHI "ĐỒNG Ý"
-- Trước đây: khách được mời thấy ngay mọi sự kiện (mọi trạng thái RSVP).
-- Giờ: khách chỉ ĐỌC được sự kiện (và tài liệu đính kèm) khi status = 'accepted'.
-- Lời mời chưa trả lời -> xem ở trang "Lời mời" (API dùng service_role, lọc theo email)
-- và bấm Đồng ý/Từ chối; vẫn sửa được dòng attendee của mình (policy cũ giữ nguyên).
-- Chạy 1 lần trên Supabase SQL Editor (idempotent).
-- =====================================================================

-- Hàm: user hiện tại có phải khách ĐÃ ĐỒNG Ý của sự kiện không (so email trong JWT).
create or replace function is_accepted_attendee(evt uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from event_attendees a
    where a.event_id = evt
      and lower(a.email) = lower(auth.jwt() ->> 'email')
      and a.status = 'accepted'
  );
$$;

-- Thay policy cũ (thấy mọi event được mời) bằng policy mới (chỉ event đã đồng ý).
drop policy if exists "Attendees can read invited events" on events;
drop policy if exists "Attendees can read accepted events" on events;
create policy "Attendees can read accepted events"
  on events for select
  using (is_accepted_attendee(events.id));
