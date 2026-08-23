// @ts-check
/**
 * Envelope de operação agentic para ações rastreáveis.
 *
 * @module copilot/infra/operations/operation
 */

import { toError } from '#copilot/infra/internal/platform/error';
import { randomUUID } from 'node:crypto';

/** @typedef {import('./contracts/index.js').IoOperationStatus} IoOperationStatus */
/** @typedef {import('./contracts/index.js').IoOperationEnvelope} IoOperationEnvelope */

/**
 * @param {{
 *     capability: string;
 *     riskClass?: import('#copilot/infra/internal/operations/contracts').IoRiskClass;
 *     targets?: readonly string[];
 *     traceId?: string | null;
 *     evidence?: Record<string, unknown>;
 * }} input
 * @returns {IoOperationEnvelope}
 */
export function createIoOperationEnvelope(input) {
    return {
        operationId: randomUUID(),
        capability: input.capability,
        riskClass: input.riskClass ?? 'medium',
        targets: [...(input.targets ?? [])],
        status: 'planned',
        startedAtMs: Date.now(),
        completedAtMs: null,
        durationMs: null,
        traceId: input.traceId ?? null,
        evidence: { ...(input.evidence ?? {}) },
        error: null,
    };
}

/**
 * @param {IoOperationEnvelope} envelope
 * @param {{ status?: IoOperationStatus; traceId?: string | null; evidence?: Record<string, unknown> }} [result]
 * @returns {IoOperationEnvelope}
 */
export function completeIoOperationEnvelope(envelope, result = {}) {
    const completedAtMs = Date.now();
    return {
        ...envelope,
        status: result.status ?? 'applied',
        completedAtMs,
        durationMs: Math.max(0, completedAtMs - envelope.startedAtMs),
        traceId: result.traceId ?? envelope.traceId,
        evidence: { ...envelope.evidence, ...(result.evidence ?? {}) },
        error: null,
    };
}

/**
 * @param {IoOperationEnvelope} envelope
 * @param {unknown} error
 * @param {{ traceId?: string | null; evidence?: Record<string, unknown> }} [result]
 * @returns {IoOperationEnvelope}
 */
export function failIoOperationEnvelope(envelope, error, result = {}) {
    const completedAtMs = Date.now();
    return {
        ...envelope,
        status: 'failed',
        completedAtMs,
        durationMs: Math.max(0, completedAtMs - envelope.startedAtMs),
        traceId: result.traceId ?? envelope.traceId,
        evidence: { ...envelope.evidence, ...(result.evidence ?? {}) },
        error: toError(error ?? 'unknown-error').message,
    };
}
