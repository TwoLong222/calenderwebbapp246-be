-- =====================================================================
-- PHASE 8 — NHẮC LỊCH LINH HOẠT (nhiều mốc nhắc / nội dung tùy chỉnh / web + mail)
-- Chạy 1 lần trên Supabase SQL Editor. CHỈ THÊM bảng/cột, KHÔNG xóa dữ liệu.
--
-- Thay cột đơn events.reminder_minutes (1 mốc) bằng bảng event_reminders (nhiều mốc).
--   * event_reminders.minutes_before : nhắc trước bao nhiêu PHÚT (0 = ngay lúc bắt đầu).
--   * events.reminder_message         : nội dung thông báo tùy chỉnh; NULL = dùng tên sự kiện.
-- Cột reminder_minutes cũ GIỮ NGUYÊN để các sự kiện cũ vẫn được cron cũ nhắc (tương thích ngược).
--
-- Thông báo trong-app: bảng notifications (chuông lưu lại, xem được cả khi lúc đó không mở app).
-- Chống gửi trùng ở cron: bảng event_reminder_sent (mỗi (mốc nhắc, người nhận) chỉ gửi 1 lần).
-- =====================================================================

-- 1) Nhiều mốc nhắc cho mỗi sự kiện --------------------------------------------------
create table if not exists event_reminders (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  -- 0..2.016.000 phút = tối đa 200 tuần (khớp giới hạn "số ≤ 200" ở giao diện, mọi đơn vị).
  minutes_before int not null check (minutes_before >= 0 and minutes_before <= 2016000),
  created_at timestamptz not null default now()
);
create index if not exists event_reminders_event_idx on event_reminders(event_id);

-- RLS cho event_reminders: XEM nếu xem được sự kiện; QUẢN LÝ nếu ghi được sự kiện
-- (mirror chính sách của event_attachments — dùng helper can_write_calendar / is_group_member).
alter table event_reminders enable row level security;
drop policy if exists "view reminders of viewable events" on event_reminders;
create policy "view reminders of viewable events" on event_reminders for select
  using (exists (select 1 from events e where e.id = event_reminders.event_id));
drop policy if exists "manage reminders if can write event" on event_reminders;
create policy "manage reminders if can write event" on event_reminders for all
  using (
    exists (select 1 from events e where e.id = event_reminders.event_id
      and (can_write_calendar(e.calendar_id) or (e.group_id is not null and is_group_member(e.group_id))))
  )
  with check (
    exists (select 1 from events e where e.id = event_reminders.event_id
      and (can_write_calendar(e.calendar_id) or (e.group_id is not null and is_group_member(e.group_id))))
  );

-- 2) Nội dung thông báo tùy chỉnh (NULL = hiện tên sự kiện) ---------------------------
alter table events add column if not exists reminder_message text;

-- 3) Thông báo trong-app (chuông) ----------------------------------------------------
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null default 'reminder',   -- 'reminder' (mở rộng loại khác sau)
  title text not null,
  body text,
  event_id uuid references events(id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notifications_user_idx on notifications(user_id, created_at desc);

alter table notifications enable row level security;

-- User CHỈ thấy/sửa/xóa thông báo của chính mình. INSERT do backend (service_role) tạo ở cron.
drop policy if exists "own notifications select" on notifications;
create policy "own notifications select" on notifications for select using (user_id = auth.uid());
drop policy if exists "own notifications update" on notifications;
create policy "own notifications update" on notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own notifications delete" on notifications;
create policy "own notifications delete" on notifications for delete using (user_id = auth.uid());

-- 4) Chống gửi trùng ở cron ----------------------------------------------------------
create table if not exists event_reminder_sent (
  reminder_id uuid not null references event_reminders(id) on delete cascade,
  email text not null,
  sent_at timestamptz not null default now(),
  primary key (reminder_id, email)
);
-- Chỉ backend (service_role, bypass RLS) đụng bảng này. Bật RLS + không policy = user JWT không truy cập được.
alter table event_reminder_sent enable row level security;

-- 5) RPC: các mốc nhắc ĐÃ TỚI GIỜ (cửa sổ [start - minutes_before, start]) ------------
--    Cho phép trễ tối đa 2 phút để mốc "ngay lúc bắt đầu" (minutes_before = 0) vẫn kịp gửi.
create or replace function get_due_reminders()
returns table (
  reminder_id uuid,
  event_id uuid,
  event_title text,
  reminder_message text,
  start_time timestamptz,
  location text,
  creator_id uuid,
  creator_email text
)
language sql
stable
as $$
  select
    r.id            as reminder_id,
    e.id            as event_id,
    e.title         as event_title,
    e.reminder_message as reminder_message,
    e.start_time    as start_time,
    e.location      as location,
    e.creator_id    as creator_id,
    e.creator_email as creator_email
  from event_reminders r
  join events e on e.id = r.event_id
  where e.deleted_at is null
    and e.start_time > now() - interval '2 minutes'
    and e.start_time <= now() + make_interval(mins => r.minutes_before);
$$;

-- 6) Bật Realtime cho notifications (FE nghe INSERT để hiện chuông + toast ngay) -------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table notifications;
  end if;
end $$;

-- =====================================================================
-- ROLLBACK (bỏ comment nếu muốn gỡ):
-- alter publication supabase_realtime drop table notifications;
-- drop function if exists get_due_reminders();
-- drop table if exists event_reminder_sent cascade;
-- drop table if exists notifications cascade;
-- drop table if exists event_reminders cascade;
-- alter table events drop column if exists reminder_message;
-- =====================================================================
