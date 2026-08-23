-- =========================================================================
-- PHASE 7 — NHÓM LÊN LỊCH CÙNG NHAU (real-time)
-- =========================================================================
-- File này CHỈ THÊM bảng/cột/policy mới. KHÔNG xóa, KHÔNG sửa dữ liệu cũ.
-- Chạy an toàn nhiều lần (idempotent nhờ "if not exists" / "drop policy if exists").
--
-- Mô hình:
--   groups          — 1 nhóm, gắn với 1 calendars row riêng (lịch nhóm) + join_code.
--   group_members   — thành viên nhóm (mời theo email; joined_at=null nghĩa là chưa tham gia).
--   events.group_id — sự kiện thuộc nhóm nào (null = sự kiện cá nhân như cũ).
--
-- Bảo mật: RLS thêm MỚI (permissive -> cộng dồn theo OR với policy cũ). Sự kiện cá
-- nhân vẫn theo policy cũ; thành viên nhóm được đọc/ghi sự kiện có group_id của nhóm mình.
-- =========================================================================

-- ---------- Bảng groups ----------
create table if not exists groups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null default 'Nhóm mới',
  calendar_id uuid not null references calendars (id) on delete cascade,
  join_code text not null unique default encode(gen_random_bytes(6), 'hex'),
  created_at timestamptz not null default now()
);
create index if not exists groups_owner_idx on groups (owner_id);

-- ---------- Bảng group_members ----------
create table if not exists group_members (
  group_id uuid not null references groups (id) on delete cascade,
  user_id uuid references auth.users (id) on delete cascade,
  email text not null,
  role text not null default 'member',      -- 'owner' | 'member'
  joined_at timestamptz,                     -- null = đã mời nhưng chưa tham gia
  created_at timestamptz not null default now(),
  primary key (group_id, email)
);
create index if not exists group_members_user_idx on group_members (user_id);

-- ---------- Cột group_id trên events ----------
alter table events add column if not exists group_id uuid references groups (id) on delete cascade;
create index if not exists events_group_idx on events (group_id);

-- =========================================================================
-- Helper: caller có phải thành viên (đã tham gia) của nhóm gid không?
-- SECURITY DEFINER để tránh RLS đệ quy khi policy của group_members lại query
-- chính group_members.
-- =========================================================================
create or replace function is_group_member(gid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from group_members m
    where m.group_id = gid
      and m.user_id = auth.uid()
      and m.joined_at is not null
  );
$$;

create or replace function is_group_owner(gid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from groups g where g.id = gid and g.owner_id = auth.uid()
  );
$$;

-- =========================================================================
-- RLS
-- =========================================================================
alter table groups enable row level security;
alter table group_members enable row level security;

-- ----- groups -----
drop policy if exists "read groups i belong to" on groups;
create policy "read groups i belong to" on groups
  for select using (owner_id = auth.uid() or is_group_member(id));

drop policy if exists "create my groups" on groups;
create policy "create my groups" on groups
  for insert with check (owner_id = auth.uid());

drop policy if exists "owner updates group" on groups;
create policy "owner updates group" on groups
  for update using (owner_id = auth.uid());

drop policy if exists "owner deletes group" on groups;
create policy "owner deletes group" on groups
  for delete using (owner_id = auth.uid());

-- ----- group_members -----
drop policy if exists "read members of my groups" on group_members;
create policy "read members of my groups" on group_members
  for select using (is_group_owner(group_id) or is_group_member(group_id));

drop policy if exists "owner manages members" on group_members;
create policy "owner manages members" on group_members
  for all using (is_group_owner(group_id)) with check (is_group_owner(group_id));

-- (Việc "tự tham gia bằng mã" do backend dùng service_role thực hiện -> bỏ qua RLS.)

-- ----- calendars: cho thành viên ĐỌC calendars row của nhóm (để hiển thị) -----
drop policy if exists "members read group calendar" on calendars;
create policy "members read group calendar" on calendars
  for select using (
    exists (select 1 from groups g where g.calendar_id = calendars.id and is_group_member(g.id))
  );

-- ----- events: thành viên nhóm được đọc/ghi sự kiện có group_id của nhóm mình -----
drop policy if exists "members read group events" on events;
create policy "members read group events" on events
  for select using (group_id is not null and is_group_member(group_id));

drop policy if exists "members create group events" on events;
create policy "members create group events" on events
  for insert with check (group_id is not null and is_group_member(group_id));

drop policy if exists "members update group events" on events;
create policy "members update group events" on events
  for update using (group_id is not null and is_group_member(group_id));

drop policy if exists "members delete group events" on events;
create policy "members delete group events" on events
  for delete using (group_id is not null and is_group_member(group_id));

-- =========================================================================
-- ROLLBACK (bỏ comment nếu muốn gỡ toàn bộ Phase 7)
-- =========================================================================
-- drop policy if exists "members delete group events" on events;
-- drop policy if exists "members update group events" on events;
-- drop policy if exists "members create group events" on events;
-- drop policy if exists "members read group events" on events;
-- drop policy if exists "members read group calendar" on calendars;
-- drop policy if exists "owner manages members" on group_members;
-- drop policy if exists "read members of my groups" on group_members;
-- drop policy if exists "owner deletes group" on groups;
-- drop policy if exists "owner updates group" on groups;
-- drop policy if exists "create my groups" on groups;
-- drop policy if exists "read groups i belong to" on groups;
-- drop function if exists is_group_member(uuid);
-- drop function if exists is_group_owner(uuid);
-- alter table events drop column if exists group_id;
-- drop table if exists group_members;
-- drop table if exists groups;
