// @ts-check
/**
 * Envelope de operação agentic para ações rastreáveis.
 *
 * @module copilot/infra/runtime/operation
 */

import { randomUUID } from 'node:crypto';

/**
 * @typedef {'planned' | 'applied' | 'failed' | 'dry-run'} IoOperationStatus
 *
 * @typedef {object} IoOperationEnvelope
 * @property {string} operationId
 * @property {string} capability
 * @property {import('#copilot/core/io-contracts').IoRiskClass} riskClass
 * @property {string[]} targets
 * @property {IoOperationStatus} status
 * @property {number} startedAtMs
 * @property {number | null} completedAtMs
 * @property {number | null} durationMs
 * @property {string | null} traceId
 * @property {Record<string, unknown>} evidence
 * @property {string | null} error
 */

/**
 * @param {{
 *     capability: string;
 *     riskClass?: import('#copilot/core/io-contracts').IoRiskClass;
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
        error: error instanceof Error ? error.message : String(error ?? 'unknown-error'),
    };
}
