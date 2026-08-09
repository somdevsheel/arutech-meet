import { io, type Socket } from 'socket.io-client';
import { env } from './env';

let socket: Socket | null = null;

/** Same singleton pattern as apps/web/src/lib/socket.ts — one authenticated
 * app-level realtime connection per app session. */
export function getSocket(accessToken: string): Socket {
  if (socket && socket.connected) return socket;
  if (socket) socket.disconnect();

  socket = io(env.wsUrl, {
    auth: { token: accessToken },
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
  });
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}
