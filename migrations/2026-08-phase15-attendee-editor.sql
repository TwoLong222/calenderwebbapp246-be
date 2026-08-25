-- =====================================================================
-- PHASE 15 — PHÂN QUYỀN KHÁCH MỜI TRONG SỰ KIỆN (viewer / editor)
-- Mỗi khách mời của 1 sự kiện có thể được cấp quyền "chỉnh sửa" (can_edit=true):
--   được SỬA nội dung sự kiện (giờ/tiêu đề/địa điểm/mô tả). KHÔNG xoá, không quản khách.
--
-- PHỤ THUỘC: bảng event_attendees (đã có ở calendar_schema.sql / phase sớm).
-- Idempotent — chạy lại không lỗi.
-- =====================================================================

alter table event_attendees add column if not exists can_edit boolean not null default false;

-- Hàm kiểm tra: user hiện tại (theo email trong JWT) có phải khách mời được quyền sửa sự kiện này không.
-- SECURITY DEFINER để né RLS đệ quy (giống is_event_attendee đã có).
create or replace function is_event_attendee_editor(evt uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from event_attendees a
    where a.event_id = evt
      and a.can_edit = true
      and lower(a.email) = lower(auth.jwt() ->> 'email')
  );
$$;

-- Policy BỔ SUNG (permissive): khách mời có can_edit được UPDATE sự kiện.
drop policy if exists "Attendee editors can update events" on events;
create policy "Attendee editors can update events"
  on events for update
  using (is_event_attendee_editor(events.id))
  with check (is_event_attendee_editor(events.id));
