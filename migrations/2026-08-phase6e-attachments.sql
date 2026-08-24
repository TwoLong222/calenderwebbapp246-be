-- =====================================================================
-- ĐÍNH KÈM & PHÂN PHÁT TÀI LIỆU THEO LỊCH (adapted cho schema nhánh phuongbao)
-- File lưu ở Supabase Storage (bucket private 'event-files'); metadata ở bảng
-- event_attachments. Upload/download đi qua BACKEND (adminClient) nên bucket để
-- private; RLS bảng metadata quyết định ai XEM / ai QUẢN LÝ (theo quyền event).
--
-- Cột hẹn giờ phân phát:
--   available_from : khách chỉ xem/tải được TỪ mốc này (null = xem ngay)
--   available_until: hết xem/tải SAU mốc này (null = không giới hạn)
--   notified_at    : đã gửi email "file đã mở" (chống gửi trùng ở cron)
--
-- Dùng helper có sẵn của schema này: has_calendar_access / can_write_calendar /
-- is_group_member. Chạy 1 lần trên Supabase (idempotent).
-- =====================================================================

-- Bucket private (nếu chưa có)
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
  available_from timestamptz,
  available_until timestamptz,
  notified_at timestamptz,
  created_at timestamptz not null default now()
);

-- Bổ sung cột nếu bảng đã tồn tại từ trước (an toàn khi chạy lại)
alter table event_attachments add column if not exists available_from timestamptz;
alter table event_attachments add column if not exists available_until timestamptz;
alter table event_attachments add column if not exists notified_at timestamptz;

create index if not exists event_attachments_event_idx on event_attachments(event_id);
-- Hỗ trợ cron quét nhanh file vừa tới giờ mở mà chưa thông báo
create index if not exists event_attachments_avail_idx
  on event_attachments (available_from)
  where available_from is not null and notified_at is null;

alter table event_attachments enable row level security;

-- XEM: ai xem được event thì xem được đính kèm của event đó
-- (subquery tự kế thừa RLS SELECT của bảng events: chủ lịch / được chia sẻ / khách mời / nhóm).
drop policy if exists "View attachments of viewable events" on event_attachments;
create policy "View attachments of viewable events"
  on event_attachments for select
  using (exists (select 1 from events e where e.id = event_attachments.event_id));

-- QUẢN LÝ (thêm/sửa/xoá): ai được GHI vào event thì quản lý được đính kèm của nó
-- (chủ lịch, editor được chia sẻ, hoặc thành viên nhóm nếu là sự kiện nhóm).
drop policy if exists "Manage attachments if can edit event" on event_attachments;
drop policy if exists "Manage attachments if can write event" on event_attachments;
create policy "Manage attachments if can write event"
  on event_attachments for all
  using (
    exists (
      select 1 from events e
      where e.id = event_attachments.event_id
        and (
          can_write_calendar(e.calendar_id)
          or (e.group_id is not null and is_group_member(e.group_id))
        )
    )
  )
  with check (
    exists (
      select 1 from events e
      where e.id = event_attachments.event_id
        and (
          can_write_calendar(e.calendar_id)
          or (e.group_id is not null and is_group_member(e.group_id))
        )
    )
  );

-- =====================================================================
-- ROLLBACK (bỏ comment nếu muốn gỡ):
-- drop table if exists event_attachments cascade;
-- delete from storage.buckets where id = 'event-files';
-- =====================================================================
