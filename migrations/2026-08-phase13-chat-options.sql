-- PHASE 13 — Tuỳ chọn cho chat nhóm: TRẢ LỜI một tin cụ thể.
--
-- CHẠY Ở ĐÂU: Supabase → SQL Editor → dán toàn bộ file này → Run.
-- Chạy lại nhiều lần vẫn an toàn ("if not exists").
--
-- LƯU Ý: bản ĐẦU của file này còn có ghim tin + gửi ảnh/tệp, nhưng hai tính năng đó đã
-- được BỎ theo yêu cầu. Nếu bạn đã chạy bản cũ thì database còn thừa vài cột/bucket không
-- dùng tới — vô hại, muốn dọn thì chạy thêm phase14 (tuỳ chọn).
--
-- Ghi chú thiết kế:
--  - reply_to_id tự tham chiếu group_messages. ON DELETE SET NULL để khi tin gốc bị xoá
--    cứng thì tin trả lời vẫn còn, chỉ mất phần trích dẫn (không mất luôn cả tin).

alter table group_messages
  add column if not exists reply_to_id uuid references group_messages (id) on delete set null;
