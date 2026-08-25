-- =====================================================================
-- PREREQ HELPERS cho phase6e (attachments) & phase8 (flexible-reminders)
-- 2 hàm này được các migration đó THAM CHIẾU nhưng chưa từng được lưu thành file
-- (trước đây tạo tay trong Supabase cũ). Chạy file này TRƯỚC phase6e / phase8.
--
-- PHỤ THUỘC: is_calendar_member / is_calendar_editor (phase6d). Chạy phase6d trước.
-- Idempotent — chạy lại không lỗi.
-- =====================================================================

-- Quyền GHI 1 lịch: chủ lịch HOẶC editor được chia sẻ.
create or replace function can_write_calendar(cal uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from calendars c where c.id = cal and c.owner_id = auth.uid())
      or is_calendar_editor(cal);
$$;

-- Quyền ĐỌC 1 lịch: chủ lịch HOẶC thành viên được chia sẻ.
create or replace function has_calendar_access(cal uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from calendars c where c.id = cal and c.owner_id = auth.uid())
      or is_calendar_member(cal);
$$;
