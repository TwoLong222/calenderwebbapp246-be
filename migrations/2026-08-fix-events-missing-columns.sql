-- =========================================================================
-- FIX — bảng events thiếu nhiều cột mà code hiện tại (events.service.ts) luôn insert
-- =========================================================================
-- Cùng gốc với lỗi calendars.name đã sửa trước đó: calendar_schema.sql đã được cập nhật
-- theo thời gian nhưng DB này chưa từng chạy lại các "alter table add column if not
-- exists" tương ứng. Hậu quả: MỌI lần tạo sự kiện cá nhân (POST /api/events) đang
-- lỗi 500 vì insert vào cột không tồn tại (color/series_id/creator_email).
--
-- Idempotent — an toàn chạy lại nhiều lần. Không xóa cột cũ (vd reminder_minutes_before
-- không còn code nào dùng, nhưng để nguyên phòng khi có nơi khác còn phụ thuộc).
-- =========================================================================

alter table events add column if not exists color text not null default 'sky';
alter table events add column if not exists series_id uuid;
alter table events add column if not exists creator_email text;

create index if not exists events_series_idx on events (series_id);
create index if not exists events_calendar_start_idx on events (calendar_id, start_time);

-- Index GIST khoảng thời gian (dùng cho các truy vấn "trùng lịch" nếu sau này chuyển
-- sang dùng &&; hiện findConflicts() đang tự so start/end nên không bắt buộc, nhưng
-- calendar_schema.sql khai báo cột này nên thêm cho khớp).
alter table events add column if not exists during tstzrange
  generated always as (tstzrange(start_time, end_time, '[)')) stored;
create index if not exists events_during_idx on events using gist (during);
