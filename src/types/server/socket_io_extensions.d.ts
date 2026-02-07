/**
 * Socket.io runtime field augmentations used by the hub.
 *
 * The hub attaches extra properties to `socket` during the handshake
 * (robot_id, authorized, instance_id). In JS + @ts-check those need
 * to be declared to avoid TS2339.
 */

export {};

declare module 'socket.io' {
  interface Socket {
    authorized?: boolean;
    robot_id?: string;
    instance_id?: string;
    [key: string]: unknown;
  }
}
