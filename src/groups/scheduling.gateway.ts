// SchedulingGateway: máy chủ WebSocket (socket.io) cho tính năng nhóm.
//
// - Xác thực: client gửi kèm access token của Supabase trong handshake.auth.token.
//   Gateway xác thực bằng adminClient.auth.getUser(token); sai -> ngắt kết nối.
// - Phòng (room) = groupId. Client emit 'join-group' để vào phòng của nhóm mình.
// - Khi có thay đổi sự kiện nhóm (controller gọi emitToGroup), phát cho mọi thành viên
//   đang online trong phòng -> lịch của họ cập nhật TỨC THÌ, không cần reload.
// - Presence: theo dõi ai đang online trong mỗi nhóm, phát danh sách khi có người vào/ra.

import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { SupabaseService } from '../supabase/supabase.service';
import { GroupsService } from './groups.service';

interface SocketUser {
  id: string;
  email: string;
}

@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class SchedulingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly groupsService: GroupsService,
  ) {}

  /** Xác thực token ngay khi kết nối; lưu user + token vào socket.data. */
  async handleConnection(client: Socket): Promise<void> {
    const token = (client.handshake.auth?.token as string) || '';
    if (!token) {
      client.disconnect(true);
      return;
    }
    const { data, error } = await this.supabaseService.adminClient.auth.getUser(token);
    if (error || !data.user) {
      client.disconnect(true);
      return;
    }
    client.data.user = { id: data.user.id, email: data.user.email ?? '' } as SocketUser;
    client.data.token = token;
    // Phòng riêng theo user (KHÁC phòng theo nhóm) — nơi nhận thông báo "danh sách nhóm
    // vừa đổi" (tạo/tham gia/mời/xóa thành viên/giải tán), kể cả với nhóm mà client CHƯA
    // 'join-group' (vd vừa được thêm vào 1 nhóm mới, chưa kịp tải lại danh sách).
    client.join(`user:${data.user.id}`);
  }

  handleDisconnect(client: Socket): void {
    // socket.io tự rời mọi room khi ngắt; chỉ cần phát lại presence cho các phòng client từng ở.
    const rooms = (client.data.groupRooms as Set<string>) ?? new Set<string>();
    for (const groupId of rooms) {
      // Trễ 1 nhịp để room đã cập nhật xong sau khi disconnect
      setTimeout(() => this.emitPresence(groupId), 0);
    }
  }

  /** Client xin vào phòng của 1 nhóm — chỉ cho vào nếu thực sự là thành viên. */
  @SubscribeMessage('join-group')
  async onJoinGroup(@ConnectedSocket() client: Socket, @MessageBody() body: { groupId: string }): Promise<void> {
    const user = client.data.user as SocketUser | undefined;
    const groupId = body?.groupId;
    if (!user || !groupId) return;

    const isMember = await this.isMember(groupId, user.id);
    if (!isMember) return;

    client.join(groupId);
    const rooms = (client.data.groupRooms as Set<string>) ?? new Set<string>();
    rooms.add(groupId);
    client.data.groupRooms = rooms;
    this.emitPresence(groupId);
  }

  @SubscribeMessage('leave-group')
  onLeaveGroup(@ConnectedSocket() client: Socket, @MessageBody() body: { groupId: string }): void {
    const groupId = body?.groupId;
    if (!groupId) return;
    client.leave(groupId);
    (client.data.groupRooms as Set<string>)?.delete(groupId);
    this.emitPresence(groupId);
  }

  /** Controller gọi hàm này SAU mỗi thay đổi sự kiện nhóm để phát cho phòng. */
  emitToGroup(groupId: string, type: 'created' | 'updated' | 'deleted', payload: unknown): void {
    this.server?.to(groupId).emit(`group-event:${type}`, { groupId, payload });
  }

  /** Controller gọi hàm này SAU khi gửi tin nhắn qua REST để phát cho phòng (không lặp lại INSERT). */
  emitMessage(groupId: string, message: unknown): void {
    this.server?.to(groupId).emit('group-message:new', message);
  }

  /** Phát tin nhắn vừa được CHỈNH SỬA cho phòng. */
  emitMessageUpdate(groupId: string, message: unknown): void {
    this.server?.to(groupId).emit('group-message:updated', message);
  }

  /** Phát tin nhắn vừa bị THU HỒI cho phòng (chỉ cần id để client ẩn/đánh dấu). */
  emitMessageDelete(groupId: string, message: unknown): void {
    this.server?.to(groupId).emit('group-message:deleted', message);
  }

  /**
   * Controller gọi hàm này SAU khi tạo/tham gia/mời/xóa thành viên/giải tán nhóm, để mọi
   * thành viên (kể cả đang mở nhiều tab, hoặc chưa 'join-group' phòng nhóm này) tự tải lại
   * danh sách nhóm NGAY — không cần bấm F5. Cố ý không gửi kèm payload: để client tự gọi lại
   * API (nguồn sự thật duy nhất), tránh phải đồng bộ hình dạng dữ liệu qua nhiều đường.
   */
  notifyGroupsChanged(userIds: string[]): void {
    for (const userId of userIds) this.server?.to(`user:${userId}`).emit('groups:changed');
  }

  /**
   * Chat real-time: client gửi tin nhắn thẳng qua socket (không cần round-trip REST).
   * Yêu cầu client đã 'join-group' phòng này trước đó (đảm bảo họ nhận lại được tin nhắn
   * của chính mình qua broadcast). Việc kiểm tra "có phải thành viên nhóm" do RLS của
   * bảng group_messages đảm nhiệm khi insert bằng client gắn JWT của chính user.
   */
  @SubscribeMessage('send-message')
  async onSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { groupId: string; content: string },
  ): Promise<void> {
    const user = client.data.user as SocketUser | undefined;
    const token = client.data.token as string | undefined;
    const groupId = body?.groupId;
    const content = (body?.content ?? '').trim();
    if (!user || !token || !groupId || !content) return;

    const rooms = (client.data.groupRooms as Set<string>) ?? new Set<string>();
    if (!rooms.has(groupId)) {
      client.emit('group-message:error', { groupId, message: 'Bạn cần vào phòng nhóm (join-group) trước khi chat.' });
      return;
    }

    try {
      const userClient = this.supabaseService.getClientForUser(token);
      const message = await this.groupsService.sendMessage(userClient, groupId, user.id, user.email, content);
      this.server?.to(groupId).emit('group-message:new', message);
    } catch {
      client.emit('group-message:error', { groupId, message: 'Không gửi được tin nhắn.' });
    }
  }

  /**
   * "Đang gõ…" — sự kiện tạm thời, KHÔNG lưu DB. Phát cho những người khác trong phòng
   * (không gửi lại cho chính người đang gõ). Client tự ẩn sau vài giây nếu không có tin mới.
   */
  @SubscribeMessage('typing')
  onTyping(@ConnectedSocket() client: Socket, @MessageBody() body: { groupId: string }): void {
    const user = client.data.user as SocketUser | undefined;
    const groupId = body?.groupId;
    if (!user || !groupId) return;
    const rooms = (client.data.groupRooms as Set<string>) ?? new Set<string>();
    if (!rooms.has(groupId)) return;
    client.to(groupId).emit('group-message:typing', { groupId, email: user.email });
  }

  /** Phát danh sách email đang online trong 1 nhóm. */
  private emitPresence(groupId: string): void {
    const room = this.server?.sockets?.adapter?.rooms?.get(groupId);
    const emails = new Set<string>();
    if (room) {
      for (const socketId of room) {
        const s = this.server.sockets.sockets.get(socketId);
        const u = s?.data?.user as SocketUser | undefined;
        if (u?.email) emails.add(u.email);
      }
    }
    this.server?.to(groupId).emit('presence', { groupId, online: [...emails] });
  }

  private async isMember(groupId: string, userId: string): Promise<boolean> {
    const { data } = await this.supabaseService.adminClient
      .from('group_members')
      .select('user_id')
      .eq('group_id', groupId)
      .eq('user_id', userId)
      .not('joined_at', 'is', null)
      .maybeSingle();
    return !!data;
  }
}
