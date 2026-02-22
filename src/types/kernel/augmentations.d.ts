/**
 * Kernel System - Module Augmentations
 *
 * Declara tipos para o sistema de kernel e observation.
 */

// ============================================================
// Kernel Loop
// ============================================================

declare module '#kernel/kernel_loop/kernel_loop' {
    export interface KernelConfig {
        interval?: number;
        timeout?: number;
        maxIterations?: number;
        [key: string]: unknown;
    }

    export interface KernelState {
        running: boolean;
        iteration: number;
        lastRun?: number;
        [key: string]: unknown;
    }

    export class KernelLoop {
        constructor(config?: KernelConfig);
        start(): Promise<void>;
        stop(): Promise<void>;
        getState(): KernelState;
        [key: string]: unknown;
    }

    const kernelLoop: KernelLoop;
    export default kernelLoop;
}

// ============================================================
// Observation Store
// ============================================================

declare module '#kernel/observation_store/observation_store' {
    export interface Observation {
        id: string;
        timestamp: number;
        type: string;
        data: unknown;
        metadata?: Record<string, unknown>;
        [key: string]: unknown;
    }

    export interface ObservationQuery {
        type?: string;
        startTime?: number;
        endTime?: number;
        limit?: number;
        [key: string]: unknown;
    }

    export class ObservationStore {
        constructor();
        add(observation: Observation): Promise<void>;
        query(query: ObservationQuery): Promise<Observation[]>;
        getById(id: string): Promise<Observation | null>;
        clear(): Promise<void>;
        [key: string]: unknown;
    }

    const observationStore: ObservationStore;
    export default observationStore;
}

// ============================================================
// Task Sync Bridge
// ============================================================

declare module '#kernel/task_sync_bridge' {
    export interface SyncConfig {
        interval?: number;
        batchSize?: number;
        [key: string]: unknown;
    }

    export function startSync(config?: SyncConfig): Promise<void>;
    export function stopSync(): Promise<void>;
    export function syncNow(): Promise<void>;
    export function getSyncStatus(): unknown;
}
