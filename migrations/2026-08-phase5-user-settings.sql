-- =====================================================================
-- PHASE 5 — SETTINGS & PERSONALIZATION
-- Bảng user_settings: mỗi user 1 hàng, lưu toàn bộ tuỳ chọn cá nhân.
-- Bảo mật bằng RLS: user chỉ đọc/ghi hàng của CHÍNH MÌNH (auth.uid() = user_id).
-- Chạy 1 lần trên Supabase SQL Editor (idempotent — có IF NOT EXISTS / DROP POLICY IF EXISTS).
-- =====================================================================

create table if not exists user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,

  -- General
  language text not null default 'vi'
    check (language in ('vi', 'en')),
  timezone text not null default 'Asia/Ho_Chi_Minh',
  date_format text not null default 'DD/MM/YYYY'
    check (date_format in ('DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD')),
  time_format text not null default '24h'
    check (time_format in ('12h', '24h')),
  -- 0 = Chủ Nhật, 1 = Thứ Hai
  start_of_week smallint not null default 1
    check (start_of_week in (0, 1)),

  -- Calendar
  default_calendar_view text not null default 'week'
    check (default_calendar_view in ('day', 'week', 'month', 'year')),
  default_calendar_id uuid references calendars(id) on delete set null,
  working_days smallint[] not null default '{1,2,3,4,5}',
  working_start time not null default '08:00',
  working_end time not null default '17:00',
  show_weekends boolean not null default true,
  show_declined_events boolean not null default false,
  show_completed_tasks boolean not null default true,
  show_current_time boolean not null default true,
  time_slot_duration smallint not null default 30
    check (time_slot_duration in (15, 30, 60)),

  -- Appearance
  theme text not null default 'system'
    check (theme in ('light', 'dark', 'system')),

  -- Notifications
  default_reminder integer,               -- phút; NULL = không nhắc
  browser_notifications boolean not null default false,

  -- Privacy
  event_default_privacy text not null default 'private'
    check (event_default_privacy in ('private', 'public')),

  -- Email preferences (bật/tắt từng loại email). Backend kiểm tra trước khi gửi.
  email_preferences jsonb not null default jsonb_build_object(
    'event_reminder', true,
    'event_invitation', true,
    'rsvp_update', true,
    'event_updated', true,
    'event_cancelled', true,
    'booking_confirmation', true,
    'booking_notification', true
  ),

  -- AI Assistant
  ai_settings jsonb not null default jsonb_build_object(
    'enabled', true,
    'allow_search', true,
    'allow_create', true,
    'allow_update', true,
    'allow_delete', false
  ),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Tự cập nhật updated_at mỗi lần UPDATE
create or replace function set_user_settings_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_user_settings_updated_at on user_settings;
create trigger trg_user_settings_updated_at
  before update on user_settings
  for each row execute function set_user_settings_updated_at();

-- ---------------------------------------------------------------------
-- RLS: user chỉ thao tác trên hàng của chính mình
-- ---------------------------------------------------------------------
alter table user_settings enable row level security;

drop policy if exists "Users read own settings" on user_settings;
create policy "Users read own settings"
  on user_settings for select
  using (auth.uid() = user_id);

drop policy if exists "Users insert own settings" on user_settings;
create policy "Users insert own settings"
  on user_settings for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users update own settings" on user_settings;
create policy "Users update own settings"
  on user_settings for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users delete own settings" on user_settings;
create policy "Users delete own settings"
  on user_settings for delete
  using (auth.uid() = user_id);
