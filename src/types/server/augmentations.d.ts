/**
 * Server System - Module Augmentations
 *
 * Declara tipos para módulos do servidor HTTP/WebSocket.
 */

// ============================================================
// Socket Engine
// ============================================================

declare module '#server/engine/socket' {
    export type AgentRegistryEntry = {
        robot_id: string;
        socket_id: string;
        identity: Record<string, unknown>;
        last_seen: number;
        [key: string]: unknown;
    };

    export function init(httpServer: unknown): unknown;
    export function getIO(): { fetchSockets(): Promise<any[]>; [key: string]: any } | null;
    export function getRegistry(): AgentRegistryEntry[];
    export function sendCommand(
        command: string,
        payload: Record<string, unknown>,
        robotId?: string | null
    ): string | null;
    export function notify(event: string, data?: unknown): void;
    export function notifyAgent(event: string, data?: unknown): boolean;
    export function broadcastTaskUpdate(taskId: string, data: unknown): void;
    export function on(event: string, handler: (...args: unknown[]) => void): unknown;
    export function once(event: string, handler: (...args: unknown[]) => void): unknown;
    export function off(event: string, handler: (...args: unknown[]) => void): unknown;
    export function emit(event: string, ...args: unknown[]): unknown;
    export function sendToClient(clientId: string, eventName: string, data: unknown): void;
    export function connectExternal(port?: number): Promise<{
        on: (event: string, handler: (...args: unknown[]) => void) => void;
        off: (event: string, handler: (...args: unknown[]) => void) => void;
        emit: (event: string, data: unknown) => void;
        sendToClient: (clientId: string, eventName: string, data: unknown) => void;
        connected: () => boolean;
        disconnect: () => void;
    }>;
    export function stop(): Promise<void>;
}

// ============================================================
// Middleware
// ============================================================

declare module '#server/middleware/schema_guard' {
    export function validateRequest(schema: unknown): (req: unknown, res: unknown, next: unknown) => void;
    export function validateQuery(schema: unknown): (req: unknown, res: unknown, next: unknown) => void;
    export function validateBody(schema: unknown): (req: unknown, res: unknown, next: unknown) => void;
}

declare module '#server/middleware/auth' {
    export function requireAuth(req: unknown, res: unknown, next: unknown): void;
    export function optionalAuth(req: unknown, res: unknown, next: unknown): void;
}

// ============================================================
// API Controllers
// ============================================================

declare module '#server/api/controllers/dna' {
    export function getDna(req: unknown, res: unknown): Promise<void>;
    export function saveDna(req: unknown, res: unknown): Promise<void>;
    export function getDnaHistory(req: unknown, res: unknown): Promise<void>;
    export function rollbackDna(req: unknown, res: unknown): Promise<void>;
}

declare module '#server/api/controllers/tasks' {
    export function getTasks(req: unknown, res: unknown): Promise<void>;
    export function getTask(req: unknown, res: unknown): Promise<void>;
    export function createTask(req: unknown, res: unknown): Promise<void>;
    export function deleteTask(req: unknown, res: unknown): Promise<void>;
}

// ============================================================
// Watchers
// ============================================================

declare module '#server/watchers/fs_watcher' {
    export interface WatcherOptions {
        path: string;
        filter?: (filename: string) => boolean;
        debounce?: number;
        [key: string]: unknown;
    }

    export function startWatcher(options: WatcherOptions): void;
    export function stopWatcher(): void;
}
