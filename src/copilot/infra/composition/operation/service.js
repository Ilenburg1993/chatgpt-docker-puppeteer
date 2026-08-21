// @ts-check
/** @module copilot/infra/composition/operation/service */

import { randomUUID } from 'node:crypto';

/** @param {{ traceId?:string; runtimeId?:string|null; workspaceId?:string|null; signal?:AbortSignal; deadlineAt?:number|null; caller?:string|null }} [options] */
export function createInfraOperationContext(options = {}) {
    const deadlineAt = Number.isFinite(options.deadlineAt) ? Number(options.deadlineAt) : null;
    return Object.freeze({
        traceId: options.traceId?.trim() || randomUUID(),
        runtimeId: options.runtimeId ?? null,
        workspaceId: options.workspaceId ?? null,
        signal: options.signal ?? null,
        deadlineAt,
        caller: options.caller ?? null,
        createdAt: Date.now(),
    });
}
