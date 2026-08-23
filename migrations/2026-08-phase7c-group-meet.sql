-- =========================================================================
-- PHASE 7C — GOOGLE MEET CHO SỰ KIỆN NHÓM
-- =========================================================================
-- Chỉ THÊM 1 cột để lưu link Google Meet cho mỗi sự kiện. KHÔNG xóa/sửa dữ liệu cũ.
-- Chạy lại nhiều lần vẫn an toàn (add column if not exists).
--
-- meet_link != null  -> sự kiện có phòng họp Google Meet; hiển thị nút "Tham gia Meet".
-- =========================================================================

alter table events add column if not exists meet_link text;

-- =========================================================================
-- ROLLBACK (bỏ comment nếu muốn gỡ)
-- =========================================================================
-- alter table events drop column if exists meet_link;
