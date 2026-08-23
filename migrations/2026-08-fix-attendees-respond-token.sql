-- =========================================================================
-- FIX — Bổ sung cột cho KHÁCH MỜI (event_attendees)
-- =========================================================================
-- Bug: tạo/sửa sự kiện CÓ KHÁCH MỜI bị lỗi 500 vì code chèn 2 cột respond_token
-- và token_expires_at (dùng cho link Đồng ý/Từ chối trong email) nhưng bảng
-- event_attendees chưa có 2 cột này.
--
-- File chỉ THÊM cột, KHÔNG xóa/sửa dữ liệu cũ. Chạy lại nhiều lần vẫn an toàn.
-- =========================================================================

alter table event_attendees add column if not exists respond_token text;
alter table event_attendees add column if not exists token_expires_at timestamptz;

-- Tra cứu nhanh khi khách bấm link trong email
create index if not exists event_attendees_respond_token_idx on event_attendees (respond_token);

-- =========================================================================
-- ROLLBACK (bỏ comment nếu muốn gỡ)
-- =========================================================================
-- drop index if exists event_attendees_respond_token_idx;
-- alter table event_attendees drop column if exists token_expires_at;
-- alter table event_attendees drop column if exists respond_token;
