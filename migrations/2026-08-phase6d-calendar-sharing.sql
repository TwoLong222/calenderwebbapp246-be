-- =====================================================================
-- PHASE 6D — CHIA SẺ LỊCH (calendar sharing)
-- Chủ lịch chia sẻ lịch của mình cho người khác (theo email) với vai trò:
--   'viewer' = chỉ xem, 'editor' = xem + sửa/xoá sự kiện.
--
-- AN TOÀN: chỉ THÊM policy MỚI (permissive -> OR với policy chủ sở hữu đang có),
-- KHÔNG sửa/xoá policy cũ. Dùng hàm SECURITY DEFINER để né đệ quy RLS
-- (giống pattern is_event_attendee đã có trong calendar_schema.sql).
-- Chạy 1 lần trên Supabase SQL Editor (idempotent).
-- =====================================================================

create table if not exists calendar_members (
  id uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references calendars(id) on delete cascade,
  member_email text not null,
  role text not null default 'viewer' check (role in ('viewer', 'editor')),
  created_at timestamptz not null default now(),
  unique (calendar_id, member_email)
);
create index if not exists calendar_members_email_idx on calendar_members (lower(member_email));

alter table calendar_members enable row level security;

-- Chủ lịch toàn quyền quản lý thành viên của lịch mình.
drop policy if exists "Owner manages calendar members" on calendar_members;
create policy "Owner manages calendar members"
  on calendar_members for all
  using (exists (select 1 from calendars c where c.id = calendar_members.calendar_id and c.owner_id = auth.uid()))
  with check (exists (select 1 from calendars c where c.id = calendar_members.calendar_id and c.owner_id = auth.uid()));

-- Thành viên đọc được chính dòng thành viên của mình (để biết mình được chia sẻ lịch nào).
drop policy if exists "Members read own membership" on calendar_members;
create policy "Members read own membership"
  on calendar_members for select
  using (lower(member_email) = lower(auth.jwt() ->> 'email'));

-- ---------------------------------------------------------------------
-- Hàm kiểm tra thành viên (SECURITY DEFINER -> né RLS đệ quy)
-- ---------------------------------------------------------------------
create or replace function is_calendar_member(cal uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from calendar_members m
    where m.calendar_id = cal and lower(m.member_email) = lower(auth.jwt() ->> 'email')
  );
$$;

create or replace function is_calendar_editor(cal uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from calendar_members m
    where m.calendar_id = cal and m.role = 'editor'
      and lower(m.member_email) = lower(auth.jwt() ->> 'email')
  );
$$;

create or replace function is_event_calendar_member(evt uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select is_calendar_member((select calendar_id from events where id = evt));
$$;

create or replace function is_event_calendar_editor(evt uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select is_calendar_editor((select calendar_id from events where id = evt));
$$;

-- ---------------------------------------------------------------------
-- Policy BỔ SUNG (permissive) — thành viên đọc lịch/sự kiện được chia sẻ.
-- ---------------------------------------------------------------------
drop policy if exists "Members can read shared calendars" on calendars;
create policy "Members can read shared calendars"
  on calendars for select
  using (is_calendar_member(calendars.id));

drop policy if exists "Members can read shared events" on events;
create policy "Members can read shared events"
  on events for select
  using (is_calendar_member(events.calendar_id));

drop policy if exists "Editors can update shared events" on events;
create policy "Editors can update shared events"
  on events for update
  using (is_calendar_editor(events.calendar_id))
  with check (is_calendar_editor(events.calendar_id));

drop policy if exists "Members can read shared attendees" on event_attendees;
create policy "Members can read shared attendees"
  on event_attendees for select
  using (is_event_calendar_member(event_attendees.event_id));
