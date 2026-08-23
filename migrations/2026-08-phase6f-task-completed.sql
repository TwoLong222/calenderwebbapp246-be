-- =====================================================================
-- PHASE 6F — TRẠNG THÁI HOÀN THÀNH CHO TASK
-- Thêm cột events.completed để đánh dấu "Việc cần làm" đã xong (dùng cho trang
-- danh sách Task và cài đặt "Hiện task đã hoàn thành").
-- Chạy 1 lần trên Supabase SQL Editor (idempotent).
-- =====================================================================

alter table events add column if not exists completed boolean not null default false;
