-- =====================================================================
-- PHASE 6C — PUBLIC BOOKING (đặt lịch hẹn công khai, kiểu Calendly mini)
-- Mỗi user có 1 trang đặt lịch (slug riêng). Người ngoài mở /book/<slug>,
-- xem khung giờ trống (tính từ working hours + trừ sự kiện đang có) và đặt hẹn.
--
-- Việc tính khung trống + tạo sự kiện cho lịch chủ được BACKEND làm bằng service_role
-- (adminClient) vì người đặt KHÔNG đăng nhập. Vì vậy RLS ở đây chỉ cần cho CHỦ trang
-- tự quản lý cấu hình của mình.
-- Chạy 1 lần trên Supabase SQL Editor (idempotent).
-- =====================================================================

create table if not exists booking_pages (
  user_id uuid primary key references auth.users(id) on delete cascade,
  slug text unique not null,
  title text not null default 'Đặt lịch hẹn',
  duration_minutes int not null default 30 check (duration_minutes in (15, 30, 60)),
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function set_booking_pages_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_booking_pages_updated_at on booking_pages;
create trigger trg_booking_pages_updated_at
  before update on booking_pages
  for each row execute function set_booking_pages_updated_at();

alter table booking_pages enable row level security;

drop policy if exists "Users manage own booking page" on booking_pages;
create policy "Users manage own booking page"
  on booking_pages for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
