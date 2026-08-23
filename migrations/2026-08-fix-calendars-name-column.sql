-- =========================================================================
-- FIX — calendars thiếu cột "name"
-- =========================================================================
-- calendar_schema.sql hiện tại định nghĩa calendars.name, nhưng DB này được tạo
-- từ một bản schema cũ hơn (dùng "summary"/"description" kiểu Google Calendar) —
-- cột "name" chưa từng được thêm, và trigger handle_new_user() (chạy khi user mới
-- đăng ký) vẫn đang insert vào "summary". Lỗi này không lộ ra cho tới Phase 7
-- (tạo nhóm) vì đó là chỗ đầu tiên trong code thật sự ĐỌC/GHI cột calendars.name
-- -> PostgREST báo "Could not find the 'name' column of 'calendars' in the schema cache".
--
-- File này CHỈ THÊM cột + đồng bộ lại trigger cho khớp calendar_schema.sql hiện tại.
-- KHÔNG xóa summary/description (giữ lại phòng khi có chỗ khác còn phụ thuộc).
-- Idempotent — an toàn chạy lại nhiều lần.
-- =========================================================================

alter table calendars add column if not exists name text not null default 'Lịch của tôi';

-- "summary" là cột NOT NULL nhưng KHÔNG có default — trigger handle_new_user() mới (chỉ
-- insert owner_id/name/is_primary) sẽ làm insert user mới lỗi (vi phạm NOT NULL) nếu vẫn
-- giữ ràng buộc này. Không còn code nào đọc/ghi "summary" nữa -> bỏ NOT NULL cho an toàn.
alter table calendars alter column summary drop not null;

-- Giữ lại tên lịch cũ (đang nằm ở "summary") thay vì để mặc định chung chung.
update calendars set name = summary where summary is not null and summary <> '';

-- Đồng bộ trigger tạo Lịch chính cho user mới: insert vào "name" thay vì "summary".
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.calendars (owner_id, name, is_primary)
  values (new.id, 'Lịch của tôi', true)
  on conflict do nothing;
  return new;
end $$;
