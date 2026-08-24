// Test cho GroupsService — tập trung vào chức năng TẠO NHÓM và các thao tác quản lý nhóm
// (mời/tham gia bằng mã/xóa thành viên/giải tán nhóm). Supabase client được giả lập bằng
// 1 query-builder chainable tối thiểu, đủ cho các phương thức (from/select/eq/insert/...).

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { GroupsService } from './groups.service';

type Result = { data?: any; error?: any; count?: number };

/** Query-builder giả lập: mọi hàm chain trả về chính nó; single/maybeSingle và await trực
 *  tiếp (không gọi single) đều resolve về `result` truyền vào. */
function makeBuilder(result: Result = { data: null, error: null }) {
  const builder: any = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    neq: jest.fn(() => builder),
    not: jest.fn(() => builder),
    order: jest.fn(() => builder),
    in: jest.fn(() => builder),
    is: jest.fn(() => builder),
    lt: jest.fn(() => builder),
    gt: jest.fn(() => builder),
    limit: jest.fn(() => builder),
    insert: jest.fn(() => builder),
    update: jest.fn(() => builder),
    upsert: jest.fn(() => builder),
    delete: jest.fn(() => builder),
    single: jest.fn(() => Promise.resolve(result)),
    maybeSingle: jest.fn(() => Promise.resolve(result)),
    then: (resolve: (v: Result) => any, reject?: (e: any) => any) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}

describe('GroupsService', () => {
  let service: GroupsService;
  let userFrom: jest.Mock;
  let adminFrom: jest.Mock;

  beforeEach(() => {
    userFrom = jest.fn();
    adminFrom = jest.fn();

    const supabaseServiceStub = { adminClient: { from: adminFrom } } as any;
    service = new GroupsService(supabaseServiceStub);
  });

  function userClient() {
    return { from: userFrom } as any;
  }

  describe('createGroup', () => {
    it('tạo lịch riêng + bản ghi nhóm + gán người tạo làm chủ (owner)', async () => {
      const cal = { id: 'cal-1' };
      const group = {
        id: 'grp-1',
        owner_id: 'user-1',
        name: 'Nhóm Toán',
        calendar_id: 'cal-1',
      };

      const calBuilder = makeBuilder({ data: cal, error: null });
      const groupBuilder = makeBuilder({ data: group, error: null });
      userFrom
        .mockReturnValueOnce(calBuilder)
        .mockReturnValueOnce(groupBuilder);

      const memberBuilder = makeBuilder({ data: null, error: null });
      adminFrom.mockReturnValueOnce(memberBuilder);

      const result = await service.createGroup(
        userClient(),
        'user-1',
        'a@b.com',
        'Nhóm Toán',
      );

      expect(userFrom).toHaveBeenNthCalledWith(1, 'calendars');
      expect(calBuilder.insert).toHaveBeenCalledWith({
        owner_id: 'user-1',
        name: 'Nhóm Toán',
        is_primary: false,
      });

      expect(userFrom).toHaveBeenNthCalledWith(2, 'groups');
      expect(groupBuilder.insert).toHaveBeenCalledWith({
        owner_id: 'user-1',
        name: 'Nhóm Toán',
        calendar_id: 'cal-1',
      });

      expect(adminFrom).toHaveBeenCalledWith('group_members');
      expect(memberBuilder.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          group_id: 'grp-1',
          user_id: 'user-1',
          email: 'a@b.com',
          role: 'owner',
        }),
      );
      expect(memberBuilder.insert.mock.calls[0][0].joined_at).toEqual(
        expect.any(String),
      );

      expect(result).toEqual({ ...group, myRole: 'owner' });
    });

    it('ném lỗi ngay nếu tạo lịch riêng cho nhóm thất bại (không tạo nhóm mồ côi)', async () => {
      const calErr = new Error('insert calendars failed');
      userFrom.mockReturnValueOnce(makeBuilder({ data: null, error: calErr }));

      await expect(
        service.createGroup(userClient(), 'user-1', 'a@b.com', 'Nhóm Toán'),
      ).rejects.toThrow(calErr);
      expect(adminFrom).not.toHaveBeenCalled();
    });
  });

  describe('listMyGroups', () => {
    it('đếm đúng số thành viên cho từng nhóm', async () => {
      const groups = [
        { id: 'g1', owner_id: 'user-1' },
        { id: 'g2', owner_id: 'user-2' },
      ];
      userFrom
        .mockReturnValueOnce(makeBuilder({ data: groups, error: null }))
        .mockReturnValueOnce(
          makeBuilder({
            data: [{ group_id: 'g1' }, { group_id: 'g1' }, { group_id: 'g2' }],
            error: null,
          }),
        );

      const result = await service.listMyGroups(userClient(), 'user-1');

      expect(result).toEqual([
        { id: 'g1', owner_id: 'user-1', myRole: 'owner', memberCount: 2 },
        { id: 'g2', owner_id: 'user-2', myRole: 'member', memberCount: 1 },
      ]);
    });

    it('trả về mảng rỗng, không truy vấn group_members, khi user chưa thuộc nhóm nào', async () => {
      userFrom.mockReturnValueOnce(makeBuilder({ data: [], error: null }));

      const result = await service.listMyGroups(userClient(), 'user-1');

      expect(result).toEqual([]);
      expect(userFrom).toHaveBeenCalledTimes(1);
    });
  });

  describe('getGroup', () => {
    it('ném NotFoundException khi nhóm không tồn tại hoặc user không thuộc nhóm (RLS chặn)', async () => {
      userFrom.mockReturnValueOnce(makeBuilder({ data: null, error: null }));

      await expect(
        service.getGroup(userClient(), 'user-1', 'grp-x'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('invite', () => {
    it('chặn mời thành viên nếu người gọi không phải chủ nhóm', async () => {
      userFrom.mockReturnValueOnce(
        makeBuilder({ data: { owner_id: 'someone-else' }, error: null }),
      );

      await expect(
        service.invite(userClient(), 'user-1', 'grp-1', 'x@y.com'),
      ).rejects.toThrow(ForbiddenException);
      expect(adminFrom).not.toHaveBeenCalled();
    });

    it('chuẩn hóa email về chữ thường trước khi upsert', async () => {
      userFrom.mockReturnValueOnce(
        makeBuilder({ data: { owner_id: 'user-1' }, error: null }),
      );
      const upsertBuilder = makeBuilder({ error: null });
      adminFrom.mockReturnValueOnce(upsertBuilder);

      const result = await service.invite(
        userClient(),
        'user-1',
        'grp-1',
        '  Foo@Bar.com  ',
      );

      expect(upsertBuilder.upsert).toHaveBeenCalledWith(
        { group_id: 'grp-1', email: 'foo@bar.com', role: 'member' },
        { onConflict: 'group_id,email', ignoreDuplicates: true },
      );
      expect(result).toEqual({ ok: true, email: 'foo@bar.com' });
    });
  });

  describe('joinByCode', () => {
    it('ném NotFoundException khi mã nhóm không đúng', async () => {
      adminFrom.mockReturnValueOnce(makeBuilder({ data: null, error: null }));

      await expect(
        service.joinByCode('sai-ma', 'user-1', 'a@b.com'),
      ).rejects.toThrow(NotFoundException);
    });

    it('gán role member cho người tham gia không phải chủ nhóm', async () => {
      const group = { id: 'grp-1', owner_id: 'owner-id' };
      adminFrom.mockReturnValueOnce(makeBuilder({ data: group, error: null }));
      const upsertBuilder = makeBuilder({ data: null, error: null });
      adminFrom.mockReturnValueOnce(upsertBuilder);

      const result = await service.joinByCode('ma-hop-le', 'user-1', 'a@b.com');

      expect(upsertBuilder.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          group_id: 'grp-1',
          user_id: 'user-1',
          email: 'a@b.com',
          role: 'member',
        }),
        { onConflict: 'group_id,email' },
      );
      expect(result).toEqual({ ...group, myRole: 'member' });
    });
  });

  describe('removeMember', () => {
    it('không cho xóa chủ nhóm khỏi nhóm', async () => {
      userFrom.mockReturnValueOnce(
        makeBuilder({ data: { owner_id: 'user-1' }, error: null }),
      );
      adminFrom
        .mockReturnValueOnce(
          makeBuilder({ data: { owner_id: 'user-1' }, error: null }),
        )
        .mockReturnValueOnce(
          makeBuilder({
            data: { user_id: 'user-1', role: 'owner' },
            error: null,
          }),
        );

      await expect(
        service.removeMember(userClient(), 'user-1', 'grp-1', 'owner@x.com'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('xóa thành viên thường thành công', async () => {
      userFrom.mockReturnValueOnce(
        makeBuilder({ data: { owner_id: 'user-1' }, error: null }),
      );
      const deleteBuilder = makeBuilder({ error: null });
      adminFrom
        .mockReturnValueOnce(
          makeBuilder({ data: { owner_id: 'user-1' }, error: null }),
        )
        .mockReturnValueOnce(
          makeBuilder({
            data: { user_id: 'member-2', role: 'member' },
            error: null,
          }),
        )
        .mockReturnValueOnce(deleteBuilder);

      const result = await service.removeMember(
        userClient(),
        'user-1',
        'grp-1',
        'member2@x.com',
      );

      expect(deleteBuilder.delete).toHaveBeenCalled();
      expect(result).toEqual({ ok: true });
    });
  });

  describe('deleteGroup', () => {
    it('chặn giải tán nhóm nếu không phải chủ nhóm', async () => {
      userFrom.mockReturnValueOnce(
        makeBuilder({ data: { owner_id: 'someone-else' }, error: null }),
      );

      await expect(
        service.deleteGroup(userClient(), 'user-1', 'grp-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('chủ nhóm giải tán -> xóa nhóm rồi xóa luôn lịch riêng của nhóm', async () => {
      userFrom.mockReturnValueOnce(
        makeBuilder({ data: { owner_id: 'user-1' }, error: null }),
      );
      const deleteGroupBuilder = makeBuilder({ error: null });
      const deleteCalBuilder = makeBuilder({ error: null });
      adminFrom
        .mockReturnValueOnce(
          makeBuilder({ data: { calendar_id: 'cal-1' }, error: null }),
        )
        .mockReturnValueOnce(deleteGroupBuilder)
        .mockReturnValueOnce(deleteCalBuilder);

      const result = await service.deleteGroup(userClient(), 'user-1', 'grp-1');

      expect(adminFrom).toHaveBeenNthCalledWith(2, 'groups');
      expect(deleteGroupBuilder.delete).toHaveBeenCalled();
      expect(adminFrom).toHaveBeenNthCalledWith(3, 'calendars');
      expect(deleteCalBuilder.delete).toHaveBeenCalled();
      expect(result).toEqual({ ok: true });
    });
  });

  describe('listMemberUserIds', () => {
    it('chỉ lấy user_id của thành viên ĐÃ tham gia (bỏ lời mời chưa joined_at, bỏ user_id null)', async () => {
      const builder = makeBuilder({
        data: [{ user_id: 'user-1' }, { user_id: 'user-2' }],
        error: null,
      });
      adminFrom.mockReturnValueOnce(builder);

      const result = await service.listMemberUserIds('grp-1');

      expect(adminFrom).toHaveBeenCalledWith('group_members');
      expect(builder.eq).toHaveBeenCalledWith('group_id', 'grp-1');
      expect(result).toEqual(['user-1', 'user-2']);
    });

    it('trả về mảng rỗng khi không có thành viên nào', async () => {
      adminFrom.mockReturnValueOnce(makeBuilder({ data: [], error: null }));

      const result = await service.listMemberUserIds('grp-1');

      expect(result).toEqual([]);
    });
  });

  describe('listMessages', () => {
    it('trả về tin nhắn theo thứ tự cũ -> mới (đảo ngược kết quả DESC từ DB)', async () => {
      const messages = [
        { id: 'm3', content: 'ba', created_at: '2026-08-21T10:02:00Z' },
        { id: 'm2', content: 'hai', created_at: '2026-08-21T10:01:00Z' },
        { id: 'm1', content: 'một', created_at: '2026-08-21T10:00:00Z' },
      ];
      const builder = makeBuilder({ data: messages, error: null });
      userFrom.mockReturnValueOnce(builder);

      const result = await service.listMessages(userClient(), 'grp-1');

      expect(userFrom).toHaveBeenCalledWith('group_messages');
      expect(builder.eq).toHaveBeenCalledWith('group_id', 'grp-1');
      expect(builder.limit).toHaveBeenCalledWith(50);
      expect(result.map((m: any) => m.id)).toEqual(['m1', 'm2', 'm3']);
    });

    it('lọc theo before khi có phân trang lùi về quá khứ', async () => {
      const builder = makeBuilder({ data: [], error: null });
      userFrom.mockReturnValueOnce(builder);

      await service.listMessages(userClient(), 'grp-1', '2026-08-21T10:00:00Z', 20);

      expect(builder.lt).toHaveBeenCalledWith('created_at', '2026-08-21T10:00:00Z');
      expect(builder.limit).toHaveBeenCalledWith(20);
    });

    it('ném lỗi khi truy vấn thất bại (vd RLS chặn vì không phải thành viên)', async () => {
      const dbErr = new Error('permission denied');
      userFrom.mockReturnValueOnce(makeBuilder({ data: null, error: dbErr }));

      await expect(service.listMessages(userClient(), 'grp-1')).rejects.toThrow(dbErr);
    });
  });

  describe('sendMessage', () => {
    it('lưu tin nhắn với đúng sender_id/email và group_id', async () => {
      const saved = { id: 'm1', group_id: 'grp-1', sender_id: 'user-1', sender_email: 'a@b.com', content: 'Chào cả nhóm' };
      const builder = makeBuilder({ data: saved, error: null });
      userFrom.mockReturnValueOnce(builder);

      const result = await service.sendMessage(userClient(), 'grp-1', 'user-1', 'a@b.com', 'Chào cả nhóm');

      expect(userFrom).toHaveBeenCalledWith('group_messages');
      expect(builder.insert).toHaveBeenCalledWith({
        group_id: 'grp-1',
        sender_id: 'user-1',
        sender_email: 'a@b.com',
        content: 'Chào cả nhóm',
      });
      expect(result).toEqual(saved);
    });

    it('ném lỗi khi RLS chặn (user không phải thành viên đã tham gia)', async () => {
      const dbErr = new Error('new row violates row-level security policy');
      userFrom.mockReturnValueOnce(makeBuilder({ data: null, error: dbErr }));

      await expect(
        service.sendMessage(userClient(), 'grp-1', 'stranger-1', 'x@y.com', 'xin chào'),
      ).rejects.toThrow(dbErr);
    });
  });

  describe('editMessage', () => {
    it('cập nhật nội dung + đặt edited_at cho tin của chính mình', async () => {
      const saved = { id: 'm1', content: 'đã sửa', edited_at: '2026-08-21T10:05:00Z' };
      const builder = makeBuilder({ data: saved, error: null });
      userFrom.mockReturnValueOnce(builder);

      const result = await service.editMessage(userClient(), 'grp-1', 'm1', 'đã sửa');

      expect(userFrom).toHaveBeenCalledWith('group_messages');
      expect(builder.update).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'đã sửa', edited_at: expect.any(String) }),
      );
      expect(builder.eq).toHaveBeenCalledWith('id', 'm1');
      expect(builder.eq).toHaveBeenCalledWith('group_id', 'grp-1');
      expect(result).toEqual(saved);
    });

    it('ném ForbiddenException khi không có dòng nào bị sửa (tin của người khác/đã thu hồi)', async () => {
      userFrom.mockReturnValueOnce(makeBuilder({ data: null, error: null }));

      await expect(service.editMessage(userClient(), 'grp-1', 'm1', 'x')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('deleteMessage', () => {
    it('soft delete: đặt deleted_at + xóa nội dung tin của chính mình', async () => {
      const saved = { id: 'm1', content: '', deleted_at: '2026-08-21T10:06:00Z' };
      const builder = makeBuilder({ data: saved, error: null });
      userFrom.mockReturnValueOnce(builder);

      const result = await service.deleteMessage(userClient(), 'grp-1', 'm1');

      expect(builder.update).toHaveBeenCalledWith(
        expect.objectContaining({ deleted_at: expect.any(String), content: '' }),
      );
      expect(result).toEqual(saved);
    });

    it('ném ForbiddenException khi thu hồi tin không phải của mình', async () => {
      userFrom.mockReturnValueOnce(makeBuilder({ data: null, error: null }));

      await expect(service.deleteMessage(userClient(), 'grp-1', 'm1')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('markRead', () => {
    it('upsert mốc đã đọc theo (group_id, user_id)', async () => {
      const builder = makeBuilder({ error: null });
      userFrom.mockReturnValueOnce(builder);

      const result = await service.markRead(userClient(), 'grp-1', 'user-1');

      expect(userFrom).toHaveBeenCalledWith('group_message_reads');
      expect(builder.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ group_id: 'grp-1', user_id: 'user-1', last_read_at: expect.any(String) }),
        { onConflict: 'group_id,user_id' },
      );
      expect(result).toEqual({ ok: true });
    });
  });

  describe('getUnreadCounts', () => {
    it('đếm tin chưa đọc theo từng nhóm, dùng mốc đã đọc nếu có; bỏ nhóm có count 0', async () => {
      // 1) groups
      userFrom.mockReturnValueOnce(makeBuilder({ data: [{ id: 'g1' }, { id: 'g2' }], error: null }));
      // 2) reads (chỉ g1 có mốc đã đọc)
      userFrom.mockReturnValueOnce(
        makeBuilder({ data: [{ group_id: 'g1', last_read_at: '2026-08-21T10:00:00Z' }], error: null }),
      );
      // 3) count cho g1 (có mốc -> dùng gt), 4) count cho g2 (không mốc)
      const g1Builder = makeBuilder({ count: 2 });
      const g2Builder = makeBuilder({ count: 0 });
      userFrom.mockReturnValueOnce(g1Builder).mockReturnValueOnce(g2Builder);

      const result = await service.getUnreadCounts(userClient(), 'user-1');

      expect(g1Builder.gt).toHaveBeenCalledWith('created_at', '2026-08-21T10:00:00Z');
      expect(g1Builder.neq).toHaveBeenCalledWith('sender_id', 'user-1');
      expect(g2Builder.gt).not.toHaveBeenCalled();
      expect(result).toEqual({ g1: 2 }); // g2 count 0 -> không xuất hiện
    });

    it('trả về object rỗng khi user chưa thuộc nhóm nào', async () => {
      userFrom.mockReturnValueOnce(makeBuilder({ data: [], error: null }));

      const result = await service.getUnreadCounts(userClient(), 'user-1');

      expect(result).toEqual({});
      expect(userFrom).toHaveBeenCalledTimes(1);
    });
  });
});
