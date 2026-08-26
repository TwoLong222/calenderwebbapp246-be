-- =====================================================================
-- PHASE 17 — LINK LỊCH CÔNG KHAI (.ics) GIỚI HẠN KHOẢNG NGÀY
-- Cho phép chọn "chia sẻ sự kiện TỪ ngày ... ĐẾN ngày ..." trên link .ics công khai.
-- Để trống = chia sẻ như cũ (1 năm trước -> 2 năm sau).
--
-- PHỤ THUỘC: phase13-calendar-feed.sql (bảng calendar_feeds).
-- Idempotent — chạy lại không lỗi.
-- =====================================================================

alter table calendar_feeds add column if not exists feed_from timestamptz;
alter table calendar_feeds add column if not exists feed_until timestamptz;
