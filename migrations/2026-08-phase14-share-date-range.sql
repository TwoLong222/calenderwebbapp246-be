-- =====================================================================
-- PHASE 14 — CHIA SẺ LỊCH GIỚI HẠN KHOẢNG NGÀY
-- Khi chia sẻ lịch cho 1 người, có thể đặt khoảng ngày [share_from, share_until]:
-- người đó CHỈ thấy sự kiện có start_time nằm trong khoảng. Để trống = xem tất cả.
--
-- PHỤ THUỘC: phải chạy SAU phase6d-calendar-sharing.sql (đã tạo bảng calendar_members
-- + hàm is_calendar_member + policy "Members can read shared events").
-- File này THAY policy đọc sự kiện của thành viên bằng bản có kiểm tra khoảng ngày.
-- Idempotent — chạy lại không lỗi.
-- =====================================================================

alter table calendar_members add column if not exists share_from timestamptz;
alter table calendar_members add column if not exists share_until timestamptz;

-- Hàm kiểm tra: thành viên (theo email trong JWT) có được xem sự kiện này không,
-- xét cả khoảng ngày. SECURITY DEFINER để né RLS đệ quy (giống is_calendar_member).
create or replace function can_see_shared_event(cal uuid, evt_start timestamptz)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from calendar_members m
    where m.calendar_id = cal
      and lower(m.member_email) = lower(auth.jwt() ->> 'email')
      and (m.share_from is null or evt_start >= m.share_from)
      and (m.share_until is null or evt_start <= m.share_until)
  );
$$;

-- Thay policy đọc sự kiện chia sẻ: dùng hàm có xét khoảng ngày.
-- (is_calendar_member vẫn giữ nguyên cho policy đọc lịch + đọc attendees.)
drop policy if exists "Members can read shared events" on events;
create policy "Members can read shared events"
  on events for select
  using (can_see_shared_event(events.calendar_id, events.start_time));
