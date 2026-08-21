-- =====================================================================
-- PHASE 6E — ĐÍNH KÈM TÀI LIỆU VÀO SỰ KIỆN
-- File lưu ở Supabase Storage (bucket private 'event-files'), metadata ở bảng
-- event_attachments. Upload/download đi qua BACKEND (adminClient) nên bucket để
-- private; RLS bảng metadata quyết định ai xem/quản lý được (theo quyền event).
-- Chạy 1 lần trên Supabase SQL Editor (idempotent).
-- =====================================================================

-- Tạo bucket private (nếu chưa có)
insert into storage.buckets (id, name, public)
values ('event-files', 'event-files', false)
on conflict (id) do nothing;

create table if not exists event_attachments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  file_path text not null,     -- đường dẫn trong bucket
  file_name text not null,     -- tên gốc để hiển thị
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists event_attachments_event_idx on event_attachments(event_id);

alter table event_attachments enable row level security;

-- XEM: ai xem được event thì xem được đính kèm của event đó.
drop policy if exists "View attachments of viewable events" on event_attachments;
create policy "View attachments of viewable events"
  on event_attachments for select
  using (exists (select 1 from events e where e.id = event_attachments.event_id));

-- QUẢN LÝ (thêm/xoá): chủ event hoặc editor của lịch được chia sẻ.
drop policy if exists "Manage attachments if can edit event" on event_attachments;
create policy "Manage attachments if can edit event"
  on event_attachments for all
  using (
    exists (select 1 from events e join calendars c on c.id = e.calendar_id
            where e.id = event_attachments.event_id and c.owner_id = auth.uid())
    or is_event_calendar_editor(event_attachments.event_id)
  )
  with check (
    exists (select 1 from events e join calendars c on c.id = e.calendar_id
            where e.id = event_attachments.event_id and c.owner_id = auth.uid())
    or is_event_calendar_editor(event_attachments.event_id)
  );
