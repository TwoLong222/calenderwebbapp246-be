-- =====================================================================
-- PHASE 12: Lời mời nhóm cần ĐỒNG Ý (consent) thay vì tự vào nhóm.
--
-- Trước đây: mời bằng email -> khi người đó đăng nhập là TỰ vào nhóm (syncInvites set joined_at).
-- Nay: mời bằng email -> tạo lời mời "đang chờ"; người được mời phải bấm ĐỒNG Ý mới thành
-- thành viên (joined_at được set). Bấm TỪ CHỐI -> giữ dòng với status='declined' để chủ nhóm biết.
-- Vào bằng MÃ/LINK vẫn vào thẳng (status='accepted').
--
-- is_group_member() vốn đã gate bằng joined_at IS NOT NULL nên "đang chờ"/"từ chối"
-- (joined_at null) KHÔNG được coi là thành viên -> không xem được lịch/chat nhóm. An toàn.
--
-- Chạy 1 lần trên Supabase SQL Editor (idempotent).
-- =====================================================================

alter table group_members
  add column if not exists status text not null default 'accepted';

-- Backfill dữ liệu cũ: đã tham gia -> accepted; đã mời nhưng chưa tham gia -> pending.
-- Không đụng các dòng đã 'declined' (để chạy lại nhiều lần vẫn an toàn).
update group_members
  set status = case when joined_at is not null then 'accepted' else 'pending' end
  where status <> 'declined';
