-- =========================================================================
-- calendar_schema.sql  — SCHEMA CHÍNH THỨC cho backend calander/apps/api
-- Chạy trong Supabase SQL Editor (Dashboard > SQL Editor > New query).
--
-- File này được viết để KHỚP 100% với code backend hiện tại:
--   - events.service.ts   -> calendars.is_primary, events.creator_id, event_attendees.*
--   - reminder.service.ts -> event_attendees.reminder_sent_at + RPC get_due_event_reminders()
--
-- AN TOÀN CHẠY LẠI (idempotent): dùng "if not exists" / "add column if not exists" /
-- "create or replace" / "drop policy if exists". Chạy trên DB đang có dữ liệu sẽ chỉ
-- BỔ SUNG phần còn thiếu (vd cột reminder_sent_at, function get_due_event_reminders),
-- KHÔNG xoá dữ liệu cũ.
--
-- LƯU Ý MIGRATION: nếu DB cũ của bạn đang dùng tên cột 'is_default' (schema đời đầu ở
-- repo calenderwebbapp246-be) thay vì 'is_primary', xem mục [MIGRATION] ở cuối file.
-- =========================================================================

create extension if not exists "pgcrypto";
create extension if not exists "btree_gist";

-- =========================================================================
-- ENUM types (guard bằng DO block để chạy lại không lỗi "type already exists")
-- =========================================================================
do $$ begin
  if not exists (select 1 from pg_type where typname = 'event_kind') then
    create type event_kind as enum ('event', 'task', 'appointment');
  end if;
  if not exists (select 1 from pg_type where typname = 'attendee_status') then
    create type attendee_status as enum ('needsAction', 'accepted', 'declined', 'tentative');
  end if;
end $$;

-- =========================================================================
-- Bảng calendars — mỗi user có 1 "Lịch chính" (is_primary = true).
-- getPrimaryCalendarId() trong events.service.ts select đúng dòng is_primary = true.
-- =========================================================================
create table if not exists calendars (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null default 'Lịch của tôi',
  color text not null default '#4285F4',
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);
-- Phòng khi bảng đã tồn tại từ schema cũ mà thiếu cột is_primary:
alter table calendars add column if not exists is_primary boolean not null default false;

-- Mỗi user chỉ được có TỐI ĐA 1 lịch chính (getPrimaryCalendarId dùng .single()).
create unique index if not exists calendars_one_primary_per_owner
  on calendars (owner_id) where is_primary;

-- =========================================================================
-- Bảng events
-- =========================================================================
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references calendars (id) on delete cascade,
  creator_id uuid references auth.users (id) on delete set null,
  creator_email text,  -- email người tạo (để hiện "Người tạo" ở popover, nhất là khi khách xem event được mời)
  kind event_kind not null default 'event',
  title text not null default '',
  description text,
  location text,
  start_time timestamptz not null,
  end_time timestamptz not null,
  is_all_day boolean not null default false,
  color text not null default 'sky',
  recurrence_rule text,
  series_id uuid,  -- các sự kiện lặp cùng 1 chuỗi có chung series_id (để xóa cả chuỗi); null = không lặp
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Phòng khi bảng đã tồn tại mà thiếu cột:
alter table events add column if not exists creator_id uuid references auth.users (id) on delete set null;
alter table events add column if not exists creator_email text;
alter table events add column if not exists series_id uuid;
create index if not exists events_series_idx on events (series_id);

-- Index GIST khoảng thời gian -> query theo tuần + findConflicts nhanh ở phía Postgres
alter table events add column if not exists during tstzrange
  generated always as (tstzrange(start_time, end_time, '[)')) stored;
create index if not exists events_during_idx on events using gist (during);
create index if not exists events_calendar_start_idx on events (calendar_id, start_time);

-- Tự cập nhật updated_at mỗi khi UPDATE (code không set tay updated_at ở patch)
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;
drop trigger if exists events_set_updated_at on events;
create trigger events_set_updated_at
  before update on events
  for each row execute function set_updated_at();

-- =========================================================================
-- Bảng event_attendees — khách mời + trạng thái + mốc đã gửi email nhắc lịch
-- =========================================================================
create table if not exists event_attendees (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  email text not null,
  status attendee_status not null default 'needsAction',
  reminder_sent_at timestamptz,
  respond_token text,          -- token ngẫu nhiên cho link Đồng ý/Từ chối trong email
  token_expires_at timestamptz, -- hạn dùng token (7 ngày); xóa token sau khi phản hồi 1 lần
  unique (event_id, email)
);
-- Phòng khi bảng đã tồn tại mà thiếu các cột dưới:
alter table event_attendees add column if not exists reminder_sent_at timestamptz;
alter table event_attendees add column if not exists respond_token text;
alter table event_attendees add column if not exists token_expires_at timestamptz;

-- =========================================================================
-- Auto-tạo Lịch chính khi có user mới đăng ký (nếu không có bước này, user vừa
-- đăng ký sẽ không có primary calendar -> createEvent ném "Không tìm thấy Lịch chính").
-- =========================================================================
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.calendars (owner_id, name, is_primary)
  values (new.id, 'Lịch của tôi', true)
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- =========================================================================
-- Row Level Security — user chỉ thấy/sửa lịch & event của chính mình.
-- (Các API dùng client gắn JWT của user -> RLS tự áp dụng. Reminder cron dùng
--  service_role nên bypass RLS, đọc được mọi event để gửi mail.)
-- =========================================================================
alter table calendars enable row level security;
alter table events enable row level security;
alter table event_attendees enable row level security;

drop policy if exists "Users manage their own calendars" on calendars;
create policy "Users manage their own calendars"
  on calendars for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "Users manage events in their own calendars" on events;
create policy "Users manage events in their own calendars"
  on events for all
  using (exists (select 1 from calendars c where c.id = events.calendar_id and c.owner_id = auth.uid()))
  with check (exists (select 1 from calendars c where c.id = events.calendar_id and c.owner_id = auth.uid()));

drop policy if exists "Users manage attendees of their own events" on event_attendees;
create policy "Users manage attendees of their own events"
  on event_attendees for all
  using (exists (
    select 1 from events e join calendars c on c.id = e.calendar_id
    where e.id = event_attendees.event_id and c.owner_id = auth.uid()
  ))
  with check (exists (
    select 1 from events e join calendars c on c.id = e.calendar_id
    where e.id = event_attendees.event_id and c.owner_id = auth.uid()
  ));

-- =========================================================================
-- KHÁCH MỜI XEM ĐƯỢC EVENT TRÊN LỊCH CỦA MÌNH
-- Cho phép user đọc event mà EMAIL của họ được mời (khớp email trong JWT).
-- Dùng hàm SECURITY DEFINER để né RLS đệ quy giữa 2 bảng events/event_attendees.
-- =========================================================================
create or replace function is_event_attendee(evt uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from event_attendees a
    where a.event_id = evt and lower(a.email) = lower(auth.jwt() ->> 'email')
  );
$$;

-- Khách mời ĐỌC được event họ được mời (bổ sung cho policy chủ sở hữu ở trên)
drop policy if exists "Attendees can read invited events" on events;
create policy "Attendees can read invited events"
  on events for select
  using (is_event_attendee(events.id));

-- Khách mời quản lý (đọc + đổi trạng thái RSVP) CHÍNH dòng attendee của mình.
-- Policy đơn giản (so email của dòng với JWT) -> không gây đệ quy.
drop policy if exists "Users manage their own attendee row" on event_attendees;
create policy "Users manage their own attendee row"
  on event_attendees for all
  using (lower(email) = lower(auth.jwt() ->> 'email'))
  with check (lower(email) = lower(auth.jwt() ->> 'email'));

-- =========================================================================
-- RPC get_due_event_reminders() — reminder.service.ts gọi mỗi 5 phút.
-- Trả về các khách mời của event SẮP diễn ra (trong 30 phút tới) mà CHƯA được
-- gửi mail nhắc và chưa từ chối. Sau khi gửi, service set reminder_sent_at để
-- không gửi trùng ở lần quét sau.
--
-- Cột trả về khớp interface DueReminderRow trong reminder.service.ts.
-- =========================================================================
create or replace function get_due_event_reminders()
returns table (
  attendee_id uuid,
  attendee_email text,
  event_id uuid,
  event_title text,
  start_time timestamptz,
  location text
)
language sql
stable
as $$
  select
    a.id            as attendee_id,
    a.email         as attendee_email,
    e.id            as event_id,
    e.title         as event_title,
    e.start_time    as start_time,
    e.location      as location
  from event_attendees a
  join events e on e.id = a.event_id
  where a.reminder_sent_at is null
    and a.status <> 'declined'
    and e.start_time > now()
    and e.start_time <= now() + interval '30 minutes';
$$;

-- =========================================================================
-- [MIGRATION] Chỉ chạy NẾU DB cũ của bạn đang dùng cột 'is_default' (schema đời đầu).
-- Bỏ comment 2 dòng dưới để chuyển dữ liệu is_default -> is_primary rồi xoá cột cũ.
-- (Bỏ qua nếu DB của bạn đã dùng is_primary — trường hợp phổ biến vì CRUD đang chạy được.)
-- =========================================================================
-- update calendars set is_primary = is_default where is_primary is distinct from is_default;
-- alter table calendars drop column if exists is_default;
