-- =========================================================================
-- PHASE 3 — Event Comments / Notes
-- Chạy trong Supabase SQL Editor. Idempotent (chạy lại an toàn).
-- =========================================================================

-- Bảng bình luận cho từng event
create table if not exists event_comments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  user_email text,                       -- email người bình luận (để hiển thị)
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists event_comments_event_idx on event_comments (event_id, created_at);

-- Tự cập nhật updated_at khi sửa comment (dùng lại hàm set_updated_at đã có trong schema chính)
drop trigger if exists event_comments_set_updated_at on event_comments;
create trigger event_comments_set_updated_at
  before update on event_comments
  for each row execute function set_updated_at();

-- =========================================================================
-- Hàm kiểm tra user có QUYỀN TRUY CẬP event không (chủ event HOẶC khách được mời).
-- SECURITY DEFINER để né RLS đệ quy giữa các bảng.
-- =========================================================================
create or replace function can_access_event(evt uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select
    exists (
      select 1 from events e join calendars c on c.id = e.calendar_id
      where e.id = evt and c.owner_id = auth.uid()
    )
    or exists (
      select 1 from event_attendees a
      where a.event_id = evt and lower(a.email) = lower(auth.jwt() ->> 'email')
    );
$$;

-- Hàm kiểm tra user có phải CHỦ của event (để xóa comment kiểm duyệt)
create or replace function is_event_owner(evt uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from events e join calendars c on c.id = e.calendar_id
    where e.id = evt and c.owner_id = auth.uid()
  );
$$;

-- =========================================================================
-- RLS cho event_comments
-- =========================================================================
alter table event_comments enable row level security;

-- Đọc: ai truy cập được event thì đọc được comment của event đó
drop policy if exists "Read comments of accessible events" on event_comments;
create policy "Read comments of accessible events"
  on event_comments for select
  using (can_access_event(event_id));

-- Thêm: chỉ thêm comment CHÍNH MÌNH, và phải có quyền truy cập event
drop policy if exists "Insert own comment on accessible event" on event_comments;
create policy "Insert own comment on accessible event"
  on event_comments for insert
  with check (user_id = auth.uid() and can_access_event(event_id));

-- Sửa: chỉ sửa comment của chính mình
drop policy if exists "Update own comment" on event_comments;
create policy "Update own comment"
  on event_comments for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Xóa: comment của mình HOẶC mình là chủ event (kiểm duyệt)
drop policy if exists "Delete own comment or as event owner" on event_comments;
create policy "Delete own comment or as event owner"
  on event_comments for delete
  using (user_id = auth.uid() or is_event_owner(event_id));

-- Bật realtime cho bảng comments (bỏ qua nếu báo "already member")
alter publication supabase_realtime add table event_comments;
