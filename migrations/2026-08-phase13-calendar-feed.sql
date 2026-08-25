-- =====================================================================
-- PHASE 13 — PUBLIC CALENDAR FEED (link đăng ký lịch công khai, dạng .ics)
-- Mỗi user có 1 token bí mật. Người khác lấy link
--   https://<backend>/api/public/calendar/<token>.ics
-- rồi "Subscribe" trong Google Calendar / Outlook / Apple Calendar. Các app đó
-- tự động tải lại định kỳ -> sự kiện tự cập nhật (thường 6–24h/lần tuỳ app).
--
-- Backend phục vụ feed bằng adminClient (service_role) vì người đăng ký KHÔNG đăng nhập,
-- nên RLS ở đây chỉ cần cho CHỦ tự quản lý (bật/tắt, đổi token) feed của mình.
-- Chạy 1 lần trên Supabase SQL Editor (idempotent).
-- =====================================================================

create table if not exists calendar_feeds (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token text unique not null,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function set_calendar_feeds_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_calendar_feeds_updated_at on calendar_feeds;
create trigger trg_calendar_feeds_updated_at
  before update on calendar_feeds
  for each row execute function set_calendar_feeds_updated_at();

alter table calendar_feeds enable row level security;

drop policy if exists "Users manage own calendar feed" on calendar_feeds;
create policy "Users manage own calendar feed"
  on calendar_feeds for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
