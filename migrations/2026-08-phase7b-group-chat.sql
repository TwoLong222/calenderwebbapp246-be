-- =========================================================================
-- PHASE 7B — CHAT NHÓM (real-time)  [Ý tưởng 1 + Ý tưởng 2]
-- =========================================================================
-- File này CHỈ THÊM bảng/cột/policy mới. KHÔNG xóa, KHÔNG sửa dữ liệu cũ.
-- Chạy an toàn nhiều lần (idempotent nhờ "if not exists" / "drop policy if exists").
-- Nếu trước đây đã chạy bản cũ của file này, cứ chạy lại bản này để bổ sung
-- các cột/policy/bảng mới (sửa tin, thu hồi, đếm chưa đọc) — không mất tin nhắn cũ.
--
-- Mô hình:
--   group_messages       — 1 tin nhắn chat của 1 nhóm, gắn với người gửi.
--                          edited_at != null  -> tin đã được chỉnh sửa.
--                          deleted_at != null -> tin đã bị thu hồi (soft delete).
--   group_message_reads  — mốc "đã đọc tới đâu" của mỗi user trong mỗi nhóm,
--                          dùng để tính số tin CHƯA ĐỌC hiển thị ở sidebar.
--
-- Bảo mật: RLS thêm MỚI, cùng kiểu với events nhóm ở Phase 7 — chỉ thành viên ĐÃ THAM
-- GIA (is_group_member) của nhóm mới đọc/gửi được tin nhắn của nhóm đó; chỉ người gửi
-- mới sửa/thu hồi được tin của chính mình; mốc "đã đọc" chỉ chủ của nó ghi được.
-- =========================================================================

-- ---------- Bảng group_messages ----------
create table if not exists group_messages (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups (id) on delete cascade,
  sender_id uuid not null references auth.users (id) on delete cascade,
  sender_email text,
  content text not null,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

-- Bổ sung cột cho ai đã lỡ tạo bảng bằng bản cũ (không có 2 cột này)
alter table group_messages add column if not exists edited_at timestamptz;
alter table group_messages add column if not exists deleted_at timestamptz;

create index if not exists group_messages_group_created_idx on group_messages (group_id, created_at);

-- ---------- Bảng group_message_reads (mốc đã đọc) ----------
create table if not exists group_message_reads (
  group_id uuid not null references groups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- =========================================================================
-- RLS
-- =========================================================================
alter table group_messages enable row level security;
alter table group_message_reads enable row level security;

-- --- group_messages ---
drop policy if exists "members read group messages" on group_messages;
create policy "members read group messages" on group_messages
  for select using (is_group_member(group_id));

drop policy if exists "members send group messages" on group_messages;
create policy "members send group messages" on group_messages
  for insert with check (is_group_member(group_id) and sender_id = auth.uid());

-- MỚI: người gửi được sửa / thu hồi (soft delete = update deleted_at) tin của chính mình
drop policy if exists "sender updates own message" on group_messages;
create policy "sender updates own message" on group_messages
  for update using (sender_id = auth.uid()) with check (sender_id = auth.uid());

drop policy if exists "sender deletes own message" on group_messages;
create policy "sender deletes own message" on group_messages
  for delete using (sender_id = auth.uid());

-- --- group_message_reads (mỗi user chỉ quản mốc đã đọc của chính mình) ---
drop policy if exists "user reads own read-marks" on group_message_reads;
create policy "user reads own read-marks" on group_message_reads
  for select using (user_id = auth.uid());

drop policy if exists "user inserts own read-marks" on group_message_reads;
create policy "user inserts own read-marks" on group_message_reads
  for insert with check (user_id = auth.uid() and is_group_member(group_id));

drop policy if exists "user updates own read-marks" on group_message_reads;
create policy "user updates own read-marks" on group_message_reads
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- =========================================================================
-- ROLLBACK (bỏ comment nếu muốn gỡ toàn bộ Phase 7B)
-- =========================================================================
-- drop policy if exists "user updates own read-marks" on group_message_reads;
-- drop policy if exists "user inserts own read-marks" on group_message_reads;
-- drop policy if exists "user reads own read-marks" on group_message_reads;
-- drop table if exists group_message_reads;
-- drop policy if exists "sender deletes own message" on group_messages;
-- drop policy if exists "sender updates own message" on group_messages;
-- drop policy if exists "members send group messages" on group_messages;
-- drop policy if exists "members read group messages" on group_messages;
-- drop table if exists group_messages;
