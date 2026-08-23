-- =====================================================================
-- PHASE 10 — KHÁCH THẤY SỰ KIỆN NGAY KHI ĐƯỢC MỜI, NHƯNG TÀI LIỆU
-- CHỈ XEM ĐƯỢC SAU KHI "ĐỒNG Ý".
--
-- Đây là bản CHỐT thay cho phase9 (phase9 giới hạn cả sự kiện = chỉ khi accepted).
-- - events: khách được mời (mọi trạng thái) đều ĐỌC được sự kiện.
-- - event_attachments: chỉ khách ĐÃ ĐỒNG Ý (accepted) — hoặc chủ lịch / editor —
--   mới xem/tải được tài liệu.
--
-- Chạy 1 lần trên Supabase SQL Editor (idempotent). KHÔNG cần chạy phase9 nữa;
-- cũng KHÔNG cần fix-attendees-see-invited-events (file này bao trùm cả hai).
-- =====================================================================

-- Hàm: user hiện tại có phải KHÁCH MỜI (bất kể trạng thái) của sự kiện không.
create or replace function can_see_invited_event(evt uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from event_attendees a
    where a.event_id = evt
      and lower(a.email) = lower(auth.jwt() ->> 'email')
  );
$$;

-- Hàm: user hiện tại có phải khách ĐÃ ĐỒNG Ý (accepted) của sự kiện không.
create or replace function is_accepted_attendee(evt uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from event_attendees a
    where a.event_id = evt
      and lower(a.email) = lower(auth.jwt() ->> 'email')
      and a.status = 'accepted'
  );
$$;

-- ---------------------------------------------------------------------
-- SỰ KIỆN: khách THẤY NGAY khi được mời (gỡ giới hạn accepted-only của phase9)
-- ---------------------------------------------------------------------
drop policy if exists "Attendees can read accepted events" on events;   -- phase9 (accepted-only)
drop policy if exists "Attendees can read invited events" on events;    -- bản gốc
drop policy if exists "attendees read invited events" on events;        -- bản của phuongbao (tránh trùng)
create policy "attendees read invited events"
  on events for select
  using (can_see_invited_event(id));

-- ---------------------------------------------------------------------
-- TÀI LIỆU: chỉ khách ĐÃ ĐỒNG Ý (hoặc chủ lịch / editor) mới XEM được
-- ---------------------------------------------------------------------
drop policy if exists "View attachments of viewable events" on event_attachments;
drop policy if exists "View attachments if accepted or manager" on event_attachments;
create policy "View attachments if accepted or manager"
  on event_attachments for select
  using (
    is_accepted_attendee(event_attachments.event_id)
    or exists (
      select 1 from events e join calendars c on c.id = e.calendar_id
      where e.id = event_attachments.event_id and c.owner_id = auth.uid()
    )
    or is_event_calendar_editor(event_attachments.event_id)
  );
