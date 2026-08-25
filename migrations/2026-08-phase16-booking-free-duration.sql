-- =====================================================================
-- PHASE 16 — THỜI LƯỢNG LỊCH HẸN TỰ DO
-- Trước đây trang đặt lịch chỉ cho chọn 15 / 30 / 60 phút (check constraint).
-- Nay cho nhập TỰ DO trong khoảng 5..480 phút (5 phút -> 8 tiếng).
--
-- PHỤ THUỘC: phase6c-public-booking.sql (bảng booking_pages).
-- Idempotent — chạy lại không lỗi.
-- =====================================================================

-- Bỏ ràng buộc cũ (tên do Postgres tự đặt khi khai báo inline: <bảng>_<cột>_check).
alter table booking_pages drop constraint if exists booking_pages_duration_minutes_check;

-- Ràng buộc mới: khoảng hợp lệ thay vì danh sách cố định.
alter table booking_pages drop constraint if exists booking_pages_duration_range;
alter table booking_pages
  add constraint booking_pages_duration_range
  check (duration_minutes >= 5 and duration_minutes <= 480);
