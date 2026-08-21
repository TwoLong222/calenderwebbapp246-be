-- =========================================================================
-- THÙNG RÁC — Xóa mềm (soft delete) cho events
-- Chạy trong Supabase SQL Editor. Idempotent (chạy lại an toàn).
--
-- Ý tưởng: thay vì XÓA HẲN dòng, ta chỉ đánh dấu thời điểm xóa vào cột
-- deleted_at. Sự kiện có deleted_at != null coi như "trong thùng rác":
--   - Không hiện trên lịch (backend lọc deleted_at IS NULL khi liệt kê).
--   - Có thể KHÔI PHỤC (đặt deleted_at = null) hoặc XÓA VĨNH VIỄN (delete thật).
-- =========================================================================

alter table events add column if not exists deleted_at timestamptz;

-- Chỉ mục giúp lọc nhanh sự kiện chưa xóa / đang trong thùng rác
create index if not exists events_deleted_at_idx on events (deleted_at);
