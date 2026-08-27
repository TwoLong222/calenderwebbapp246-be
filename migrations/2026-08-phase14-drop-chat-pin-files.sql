-- PHASE 14 (TUỲ CHỌN) — Dọn phần ghim tin + gửi ảnh/tệp trong chat nhóm.
--
-- CHỈ CHẠY NẾU bạn đã chạy bản ĐẦU của phase13 (bản có ghim + tệp). Hai tính năng đó đã bị
-- bỏ khỏi code, nên các cột/bucket dưới đây không còn ai dùng.
--
-- KHÔNG chạy cũng không sao: cột thừa và bucket rỗng không ảnh hưởng gì tới hoạt động.
-- Nhưng nếu chạy thì XOÁ VĨNH VIỄN mọi ảnh/tệp đã gửi trong chat — cân nhắc trước.

-- ---------- 1. Trả ràng buộc về đúng nghĩa (không còn khái niệm "tin chỉ có tệp") ----------
-- Vẫn chừa tin ĐÃ THU HỒI vì deleteMessage() đặt content = ''.
alter table group_messages drop constraint if exists group_messages_not_empty;
alter table group_messages add constraint group_messages_not_empty
  check (deleted_at is not null or length(coalesce(content, '')) > 0);

-- ---------- 2. Bỏ cột ghim ----------
drop index if exists group_messages_pinned_idx;
alter table group_messages drop column if exists pinned_at;
alter table group_messages drop column if exists pinned_by;

-- ---------- 3. Bỏ cột tệp đính kèm ----------
alter table group_messages drop column if exists attachment_path;
alter table group_messages drop column if exists attachment_name;
alter table group_messages drop column if exists attachment_type;
alter table group_messages drop column if exists attachment_size;

-- ---------- 4. Bỏ bucket lưu tệp chat + policy ----------
drop policy if exists "group chat files readable by members" on storage.objects;
drop policy if exists "group chat files writable by members" on storage.objects;
drop policy if exists "group chat files deletable by owner" on storage.objects;

-- Xoá hết object trong bucket rồi mới xoá được bucket.
delete from storage.objects where bucket_id = 'group-chat';
delete from storage.buckets where id = 'group-chat';
