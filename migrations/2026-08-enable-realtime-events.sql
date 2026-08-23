-- =========================================================================
-- FIX — Bật Realtime (WebSocket) cho bảng events + event_attendees
-- =========================================================================
-- Vấn đề: FE đã lắng nghe thay đổi 2 bảng này (calendar-state.service.ts) để tự
-- cập nhật lịch không cần F5. Nhưng nếu bảng CHƯA nằm trong publication
-- 'supabase_realtime' thì Supabase KHÔNG phát sóng thay đổi -> số người đồng ý,
-- sự kiện mới/đã hủy... không tự đồng bộ giữa các máy.
--
-- Sửa: thêm 2 bảng vào publication. Dùng khối DO để kiểm tra trước, nên chạy lại
-- nhiều lần vẫn an toàn (không báo lỗi "already member"). KHÔNG xóa/sửa dữ liệu.
-- =========================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'events'
  ) then
    alter publication supabase_realtime add table events;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'event_attendees'
  ) then
    alter publication supabase_realtime add table event_attendees;
  end if;
end $$;

-- =========================================================================
-- ROLLBACK (bỏ comment nếu muốn gỡ)
-- =========================================================================
-- alter publication supabase_realtime drop table event_attendees;
-- alter publication supabase_realtime drop table events;
