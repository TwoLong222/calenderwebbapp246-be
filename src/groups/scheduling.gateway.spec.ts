// Test cho SchedulingGateway — tập trung vào chat real-time (send-message) và emitMessage.
// Server/Socket của socket.io được giả lập tối thiểu (chỉ các hàm gateway thực sự gọi tới).

import { SchedulingGateway } from './scheduling.gateway';

describe('SchedulingGateway', () => {
  let gateway: SchedulingGateway;
  let supabaseServiceStub: any;
  let groupsServiceStub: any;
  let serverStub: any;
  let toEmit: jest.Mock;

  beforeEach(() => {
    toEmit = jest.fn();
    serverStub = { to: jest.fn(() => ({ emit: toEmit })) };

    supabaseServiceStub = {
      adminClient: { from: jest.fn() },
      getClientForUser: jest.fn(() => ({ __userClient: true })),
    };
    groupsServiceStub = { sendMessage: jest.fn() };

    gateway = new SchedulingGateway(supabaseServiceStub, groupsServiceStub);
    gateway.server = serverStub;
  });

  function makeClient(overrides: Partial<any> = {}) {
    return {
      data: {
        user: { id: 'user-1', email: 'a@b.com' },
        token: 'tok-1',
        groupRooms: new Set(['grp-1']),
        ...overrides,
      },
      emit: jest.fn(),
    };
  }

  describe('onSendMessage', () => {
    it('bỏ qua (không làm gì) nếu chưa xác thực (thiếu user/token)', async () => {
      const client = makeClient({ user: undefined, token: undefined });

      await gateway.onSendMessage(client as any, { groupId: 'grp-1', content: 'hi' });

      expect(groupsServiceStub.sendMessage).not.toHaveBeenCalled();
      expect(client.emit).not.toHaveBeenCalled();
    });

    it('bỏ qua nếu content rỗng (chỉ toàn khoảng trắng)', async () => {
      const client = makeClient();

      await gateway.onSendMessage(client as any, { groupId: 'grp-1', content: '   ' });

      expect(groupsServiceStub.sendMessage).not.toHaveBeenCalled();
    });

    it('báo lỗi group-message:error nếu client chưa join-group phòng này', async () => {
      const client = makeClient({ groupRooms: new Set(['grp-khac']) });

      await gateway.onSendMessage(client as any, { groupId: 'grp-1', content: 'hi' });

      expect(groupsServiceStub.sendMessage).not.toHaveBeenCalled();
      expect(client.emit).toHaveBeenCalledWith(
        'group-message:error',
        expect.objectContaining({ groupId: 'grp-1' }),
      );
    });

    it('lưu tin nhắn bằng client gắn JWT của user rồi phát cho cả phòng', async () => {
      const client = makeClient();
      const saved = { id: 'm1', content: 'hi' };
      groupsServiceStub.sendMessage.mockResolvedValueOnce(saved);

      await gateway.onSendMessage(client as any, { groupId: 'grp-1', content: 'hi' });

      expect(supabaseServiceStub.getClientForUser).toHaveBeenCalledWith('tok-1');
      expect(groupsServiceStub.sendMessage).toHaveBeenCalledWith(
        { __userClient: true },
        'grp-1',
        'user-1',
        'a@b.com',
        'hi',
      );
      expect(serverStub.to).toHaveBeenCalledWith('grp-1');
      expect(toEmit).toHaveBeenCalledWith('group-message:new', saved);
      expect(client.emit).not.toHaveBeenCalled();
    });

    it('báo lỗi group-message:error cho riêng người gửi nếu lưu thất bại (vd RLS chặn)', async () => {
      const client = makeClient();
      groupsServiceStub.sendMessage.mockRejectedValueOnce(new Error('RLS denied'));

      await gateway.onSendMessage(client as any, { groupId: 'grp-1', content: 'hi' });

      expect(client.emit).toHaveBeenCalledWith(
        'group-message:error',
        expect.objectContaining({ groupId: 'grp-1' }),
      );
      expect(toEmit).not.toHaveBeenCalled();
    });
  });

  describe('emitMessage', () => {
    it('phát group-message:new cho đúng phòng của nhóm', () => {
      const message = { id: 'm1', content: 'hi' };

      gateway.emitMessage('grp-1', message);

      expect(serverStub.to).toHaveBeenCalledWith('grp-1');
      expect(toEmit).toHaveBeenCalledWith('group-message:new', message);
    });
  });

  describe('emitMessageUpdate / emitMessageDelete', () => {
    it('phát group-message:updated cho đúng phòng', () => {
      const message = { id: 'm1', content: 'đã sửa', edited_at: 'x' };

      gateway.emitMessageUpdate('grp-1', message);

      expect(serverStub.to).toHaveBeenCalledWith('grp-1');
      expect(toEmit).toHaveBeenCalledWith('group-message:updated', message);
    });

    it('phát group-message:deleted cho đúng phòng', () => {
      const message = { id: 'm1', deleted_at: 'x' };

      gateway.emitMessageDelete('grp-1', message);

      expect(serverStub.to).toHaveBeenCalledWith('grp-1');
      expect(toEmit).toHaveBeenCalledWith('group-message:deleted', message);
    });
  });

  describe('onTyping', () => {
    it('phát group-message:typing cho NHỮNG NGƯỜI KHÁC trong phòng (client.to, kèm email người gõ)', () => {
      const clientToEmit = jest.fn();
      const client: any = {
        data: { user: { id: 'user-1', email: 'a@b.com' }, groupRooms: new Set(['grp-1']) },
        to: jest.fn(() => ({ emit: clientToEmit })),
      };

      gateway.onTyping(client, { groupId: 'grp-1' });

      expect(client.to).toHaveBeenCalledWith('grp-1');
      expect(clientToEmit).toHaveBeenCalledWith('group-message:typing', { groupId: 'grp-1', email: 'a@b.com' });
    });

    it('bỏ qua nếu client chưa join-group phòng đó', () => {
      const client: any = {
        data: { user: { id: 'user-1', email: 'a@b.com' }, groupRooms: new Set<string>() },
        to: jest.fn(),
      };

      gateway.onTyping(client, { groupId: 'grp-1' });

      expect(client.to).not.toHaveBeenCalled();
    });
  });

  describe('notifyGroupsChanged', () => {
    it('phát groups:changed vào đúng phòng riêng của TỪNG user (không kèm payload)', () => {
      gateway.notifyGroupsChanged(['user-1', 'user-2']);

      expect(serverStub.to).toHaveBeenNthCalledWith(1, 'user:user-1');
      expect(serverStub.to).toHaveBeenNthCalledWith(2, 'user:user-2');
      expect(toEmit).toHaveBeenCalledTimes(2);
      expect(toEmit).toHaveBeenCalledWith('groups:changed');
    });

    it('không làm gì nếu danh sách user rỗng', () => {
      gateway.notifyGroupsChanged([]);

      expect(serverStub.to).not.toHaveBeenCalled();
    });
  });

  describe('handleConnection', () => {
    it('xác thực token rồi tự join phòng riêng "user:<id>"', async () => {
      supabaseServiceStub.adminClient.auth = {
        getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-1', email: 'a@b.com' } }, error: null }),
      };
      const client: any = { handshake: { auth: { token: 'tok-1' } }, data: {}, join: jest.fn(), disconnect: jest.fn() };

      await gateway.handleConnection(client);

      expect(client.join).toHaveBeenCalledWith('user:user-1');
      expect(client.data.user).toEqual({ id: 'user-1', email: 'a@b.com' });
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('ngắt kết nối nếu thiếu token', async () => {
      const client: any = { handshake: { auth: {} }, data: {}, join: jest.fn(), disconnect: jest.fn() };

      await gateway.handleConnection(client);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.join).not.toHaveBeenCalled();
    });
  });
});
