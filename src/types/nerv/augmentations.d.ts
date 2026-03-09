/**
 * Nerv System - Module Augmentations
 *
 * Declara tipos para o sistema nervoso (comunicação IPC).
 */

// ============================================================
// Nerv Core
// ============================================================

declare module '#nerv/nerv' {
    export interface NervConfig {
        mode?: string;
        socketUrl?: string;
        socketOptions?: Record<string, unknown>;
        buffers?: Record<string, unknown>;
        health?: { thresholds?: Record<string, unknown> };
        transport?: { adapter?: unknown; reconnect?: boolean };
        [key: string]: unknown;
    }

    export interface NervAPI {
        emit(envelope: unknown): unknown;
        send(envelope: unknown): unknown;
        emitCommand(envelope: unknown): unknown;
        emitEvent(envelope: unknown): unknown;
        emitAck(envelope: unknown): unknown;

        receive(): Promise<unknown>;
        onReceive(handler: (...args: unknown[]) => void): void;
        onEvent(handler: (...args: unknown[]) => void): void;
        onCommand(handler: (...args: unknown[]) => void): void;
        onActor(handler: (...args: unknown[]) => void): void;

        buffers: unknown;
        transport: unknown;
        health: unknown;
        telemetry: unknown;

        getStatus(): unknown;
        shutdown(): Promise<void>;
        [key: string]: unknown;
    }

    export function createNERV(config?: NervConfig): Promise<NervAPI>;
}

// ============================================================
// Adapters
// ============================================================

declare module '#nerv/adapters/high_level_adapter' {
    export type IPCEnvelope = {
        protocol: { version: string; timestamp: number };
        identity: { actor: string; target: string | null };
        causality: { msg_id: string; correlation_id: string };
        type: { message_type: string; action_code: string };
        payload: Record<string, unknown>;
        [key: string]: unknown;
    };

    export function makeEnvelope(input: {
        actor: string;
        target?: string | null;
        messageType: string;
        actionCode: string;
        payload?: Record<string, unknown>;
        correlationId?: string | null;
    }): IPCEnvelope;

    export function sendEvent(
        nerv: { emitEvent?: (envelope: unknown) => void },
        actor: string,
        actionCode: string,
        payload?: Record<string, unknown>,
        correlationId?: string | null,
        target?: string | null,
    ): IPCEnvelope;

    export function sendCommand(
        nerv: { emitCommand?: (envelope: unknown) => void },
        actor: string,
        actionCode: string,
        payload?: Record<string, unknown>,
        correlationId?: string | null,
        target?: string | null,
    ): IPCEnvelope;

    export function sendAck(
        nerv: { emitAck?: (envelope: unknown) => void },
        actor: string,
        actionCode: string,
        correlationId?: string | null,
        target?: string | null,
    ): IPCEnvelope;
}

declare module '#nerv/adapters/low_level_adapter' {
    export class LowLevelAdapter {
        constructor(config?: unknown);
        connect(): Promise<void>;
        disconnect(): Promise<void>;
        [key: string]: unknown;
    }
}

// ============================================================
// Transport
// ============================================================

declare module '#nerv/transport/transport' {
    export interface TransportConfig {
        type?: 'ipc' | 'tcp' | 'websocket';
        timeout?: number;
        [key: string]: unknown;
    }

    export class Transport {
        constructor(config?: TransportConfig);
        send(data: unknown): Promise<void>;
        [key: string]: unknown;
    }
}
