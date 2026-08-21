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

interface SocketUser {
  id: string;
  email: string;
}

@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class SchedulingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;

  constructor(private readonly supabaseService: SupabaseService) {}

  /** Xác thực token ngay khi kết nối; lưu user vào socket.data. */
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
