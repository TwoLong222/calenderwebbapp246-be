-- =====================================================================
-- PHASE 6A — NHẮC LỊCH TUỲ CHỈNH TỪNG SỰ KIỆN
-- Thêm cột events.reminder_minutes (số phút trước giờ bắt đầu để nhắc).
--   NULL  = không nhắc.
--   30    = nhắc trước 30 phút, v.v.
-- Cập nhật get_due_event_reminders() để dùng reminder_minutes thay vì cố định 30 phút.
-- Chạy 1 lần trên Supabase SQL Editor (idempotent).
-- =====================================================================

alter table events add column if not exists reminder_minutes int;

-- Giữ hành vi cũ: các sự kiện đã có (trước khi có cột này) vẫn nhắc trước 30 phút.
-- Chỉ chạy 1 lần lúc migrate; sự kiện tạo sau đó do API đặt giá trị (có thể là NULL = không nhắc).
update events set reminder_minutes = 30 where reminder_minutes is null;

-- RPC mới: nhắc khi thời điểm bắt đầu nằm trong "reminder_minutes" phút tới,
-- bỏ qua sự kiện không đặt nhắc (reminder_minutes IS NULL) hoặc khách đã từ chối.
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
    and e.reminder_minutes is not null
    and e.start_time > now()
    and e.start_time <= now() + make_interval(mins => e.reminder_minutes);
$$;
