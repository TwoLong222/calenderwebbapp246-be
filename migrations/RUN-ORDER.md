# Thứ tự & cách chạy migration (Supabase SQL Editor)

Chạy trong **Supabase Dashboard › SQL Editor › New query**: mở file → copy toàn bộ → dán →
**Run**. KHÔNG cần chạy `npm start` / server — file `.sql` tác động thẳng lên database.

## ⚠️ Đọc trước khi chạy

- Nếu DB đã dựng từ `calendar_schema.sql` (bản mới) thì **phần lớn thứ đã có sẵn**. Nhiều
  file dưới đây là **bản vá cho DB đời cũ** — chạy trên DB mới sẽ báo lỗi kiểu
  `already exists` / `does not exist` / `cannot change name of input parameter`.
- **Các lỗi đó VÔ HẠI**: mỗi lần Run là 1 giao dịch riêng, lỗi thì không áp dụng gì, DB
  không hỏng. Gặp lỗi ở file **[cũ/vá]** → cứ **BỎ QUA**, sang file kế.
- Chỉ cần bận tâm nếu file **[BẮT BUỘC]** (tính năng) báo lỗi → khi đó gửi câu lỗi để xử lý.

## Cần cái gì thì chạy cái đó (đường tắt)

- **Người được chia sẻ không thấy lịch** → chạy `2026-08-phase6d-calendar-sharing.sql`
- **Chia sẻ giới hạn khoảng ngày (từ → đến)** → chạy phase6d **rồi** `2026-08-phase14-share-date-range.sql`
- **Link .ics công khai báo lỗi** → chạy `2026-08-phase13-calendar-feed.sql`

Ba file trên chỉ THÊM cái mới nên chạy sạch trên mọi DB.

---

## Nếu dựng DB từ đầu (project Supabase trắng) — chạy full theo thứ tự

Ký hiệu: **[NỀN]** nền tảng · **[cũ/vá]** vá đời cũ, bỏ qua nếu lỗi · **[BẮT BUỘC]** tính năng.

1. `../calendar_schema.sql` — **[NỀN]** bảng gốc + RLS cơ bản
2. `2026-08-trash-soft-delete.sql` — **[NỀN]** cột `deleted_at`
3. `2026-08-fix-calendars-name-column.sql` — **[cũ/vá]** đổi `summary`→`name` (DB mới đã đúng)
4. `2026-08-fix-events-missing-columns.sql` — **[cũ/vá]** vá cột events
5. `2026-08-fix-attendees-respond-token.sql` — **[cũ/vá]** token trả lời lời mời
6. `2026-08-fix-attendees-see-invited-events.sql` — **[cũ/vá]** hàm `is_event_attendee` (DB mới đã có)
7. `2026-08-phase3-comments.sql` — bình luận
8. `2026-08-phase5-user-settings.sql` — cài đặt người dùng
9. `2026-08-phase6-event-reminders.sql` — nhắc lịch
10. `2026-08-phase6c-public-booking.sql` — đặt lịch công khai (booking)
11. `2026-08-phase6d-calendar-sharing.sql` — **[BẮT BUỘC]** chia sẻ lịch
12. `2026-08-phase6e-attachments.sql` — tài liệu đính kèm
13. `2026-08-phase6f-task-completed.sql` — task xong
14. `2026-08-phase7-groups.sql` — nhóm
15. `2026-08-phase7-notes.sql` — ghi chú
16. `2026-08-phase7b-group-chat.sql` — chat nhóm
17. `2026-08-phase7c-group-meet.sql` — Google Meet nhóm
18. `2026-08-phase8-attachment-scheduling.sql` — hẹn giờ mở tài liệu
19. `2026-08-phase9-accepted-only-visibility.sql` — chỉ hiện sự kiện đã đồng ý
20. `2026-08-phase10-see-events-files-on-accept.sql` — thấy file khi đồng ý
21. `2026-08-phase11-owner-reminder-email.sql` — email nhắc cho chủ
22. `2026-08-phase12-group-invite-consent.sql` — mời nhóm cần đồng ý
23. `2026-08-enable-realtime-events.sql` — bật realtime events
24. `2026-08-phase13-calendar-feed.sql` — **[BẮT BUỘC]** feed .ics công khai
25. `2026-08-phase14-share-date-range.sql` — **[BẮT BUỘC]** chia sẻ giới hạn khoảng ngày (chạy SAU phase6d)

> Quy tắc: file **[cũ/vá]** báo lỗi → BỎ QUA. File **[BẮT BUỘC]** / **[NỀN]** báo lỗi → gửi câu lỗi để xử lý.
