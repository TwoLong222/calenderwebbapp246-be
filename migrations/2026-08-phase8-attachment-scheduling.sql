-- =====================================================================
-- PHASE 8 — HẸN GIỜ XEM TÀI LIỆU ĐÍNH KÈM
-- Thêm cho event_attachments:
--   - available_from : khách chỉ xem/tải được TỪ mốc này (null = xem ngay)
--   - available_until: hết xem/tải SAU mốc này (null = không giới hạn)
--   - notified_at    : đánh dấu đã gửi thông báo "file đã mở" (chống gửi trùng)
-- Chạy 1 lần trên Supabase SQL Editor (idempotent).
-- =====================================================================

alter table event_attachments add column if not exists available_from timestamptz;
alter table event_attachments add column if not exists available_until timestamptz;
alter table event_attachments add column if not exists notified_at timestamptz;

-- Hỗ trợ cron quét nhanh các file sắp/đã tới giờ mở mà chưa thông báo
create index if not exists event_attachments_avail_idx
  on event_attachments (available_from)
  where available_from is not null and notified_at is null;
