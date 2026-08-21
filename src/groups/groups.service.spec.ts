// Test cho GroupsService — tập trung vào chức năng TẠO NHÓM và các thao tác quản lý nhóm
// (mời/tham gia bằng mã/xóa thành viên/giải tán nhóm). Supabase client được giả lập bằng
// 1 query-builder chainable tối thiểu, đủ cho các phương thức (from/select/eq/insert/...).

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { GroupsService } from './groups.service';

type Result = { data?: any; error?: any };

/** Query-builder giả lập: mọi hàm chain trả về chính nó; single/maybeSingle và await trực
 *  tiếp (không gọi single) đều resolve về `result` truyền vào. */
function makeBuilder(result: Result = { data: null, error: null }) {
  const builder: any = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    neq: jest.fn(() => builder),
    order: jest.fn(() => builder),
    in: jest.fn(() => builder),
    is: jest.fn(() => builder),
    lt: jest.fn(() => builder),
    gt: jest.fn(() => builder),
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
});
