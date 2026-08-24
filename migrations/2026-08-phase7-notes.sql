-- =====================================================================
-- PHASE 7 — GHI CHÚ (kiểu Google Keep)
-- Bảng notes: mỗi user tự tạo/sửa/xoá ghi chú của mình. Có màu + ghim.
-- Bảo mật bằng RLS: user chỉ thao tác trên hàng của CHÍNH MÌNH.
-- Chạy 1 lần trên Supabase SQL Editor (idempotent).
-- =====================================================================

create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '',
  content text not null default '',
  -- Màu thẻ ghi chú (khớp bảng màu ở frontend)
  color text not null default 'default'
    check (color in ('default', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink')),
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists notes_user_idx on notes(user_id);

-- Tự cập nhật updated_at mỗi lần UPDATE
create or replace function set_notes_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_notes_updated_at on notes;
create trigger trg_notes_updated_at
  before update on notes
  for each row execute function set_notes_updated_at();

-- ---------------------------------------------------------------------
-- RLS: user chỉ thao tác trên ghi chú của chính mình
-- ---------------------------------------------------------------------
alter table notes enable row level security;

drop policy if exists "Users read own notes" on notes;
create policy "Users read own notes"
  on notes for select
  using (auth.uid() = user_id);

drop policy if exists "Users insert own notes" on notes;
create policy "Users insert own notes"
  on notes for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users update own notes" on notes;
create policy "Users update own notes"
  on notes for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users delete own notes" on notes;
create policy "Users delete own notes"
  on notes for delete
  using (auth.uid() = user_id);
