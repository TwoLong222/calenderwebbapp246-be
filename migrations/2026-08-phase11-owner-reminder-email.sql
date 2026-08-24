-- =====================================================================
-- PHASE 11: Email nhắc lịch cho CHÍNH CHỦ sự kiện.
--
-- Trước đây get_due_event_reminders() chỉ gửi email cho event_attendees (khách mời).
-- Sự kiện cá nhân do user tự tạo mà KHÔNG mời ai -> không có hàng attendee -> chủ
-- không nhận được email nhắc. Migration này bổ sung phần đó, độc lập với luồng khách mời.
--
-- Chạy 1 lần trên Supabase SQL Editor (idempotent — chạy lại nhiều lần không sao).
-- =====================================================================

-- Mốc đã gửi email nhắc cho CHỦ sự kiện (để không gửi trùng ở lần quét sau).
alter table events add column if not exists owner_reminder_sent_at timestamptz;

-- Trả về các sự kiện cần gửi email nhắc cho CHỦ (owner của calendar chứa sự kiện):
--  - có đặt nhắc (reminder_minutes IS NOT NULL)
--  - thời điểm bắt đầu nằm trong "reminder_minutes" phút tới
--  - chưa gửi cho chủ (owner_reminder_sent_at IS NULL)
create or replace function get_due_owner_reminders()
returns table (
  event_id uuid,
  owner_id uuid,
  event_title text,
  start_time timestamptz,
  location text
)
language sql
stable
as $$
  select
    e.id          as event_id,
    c.owner_id    as owner_id,
    e.title       as event_title,
    e.start_time  as start_time,
    e.location    as location
  from events e
  join calendars c on c.id = e.calendar_id
  where e.owner_reminder_sent_at is null
    and e.reminder_minutes is not null
    and e.start_time > now()
    and e.start_time <= now() + make_interval(mins => e.reminder_minutes);
$$;
