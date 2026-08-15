// @ts-check
/**
 * Disposable, idempotent probe execution shared by terminal and LLM-B adapters.
 *
 * @module copilot/model-gateway/control-plane/probe-execution
 */

import { createHash } from 'node:crypto';
import { SqliteModelGatewayCatalogStore } from '../catalog/sqlite-catalog-store.js';
import {
    classifyByokProviderFailure,
    flushByokProviderHealth,
    recordByokProviderModelAgentProbeFailure,
    recordByokProviderModelAgentProbeSuccess,
    recordByokProviderModelCallFailure,
    recordByokProviderModelCallSuccess,
    recordByokProviderModelProbeResult,
} from '../health/index.js';
import { buildProbeCompletedEvent } from '../observability/events.js';
import {
    runConfiguredByokAgentProbe,
    runConfiguredByokChatProbe,
    runConfiguredByokJsonProbe,
    runConfiguredByokStreamingProbe,
    runConfiguredByokVisionProbe,
} from '../probes/index.js';
import { redactModelGatewayAuditedValue } from '../secrets/index.js';

export const MODEL_GATEWAY_EXECUTABLE_PROBE_KINDS = Object.freeze(['chat', 'streaming', 'json', 'agent', 'vision']);

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {string} idempotencyKey
 * @returns {string}
 */
export function createModelGatewayProbeOperationId(idempotencyKey) {
    const digest = createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 24);
    return `model-gateway:probe:${digest}`;
}

/**
 * @param {string} kind
 */
function resolveProbeRunner(kind) {
    if (kind === 'agent') return runConfiguredByokAgentProbe;
    if (kind === 'streaming') return runConfiguredByokStreamingProbe;
    if (kind === 'json') return runConfiguredByokJsonProbe;
    if (kind === 'vision') return runConfiguredByokVisionProbe;
    return runConfiguredByokChatProbe;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function optionalIdentityString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * @param {Record<string, any>} probe
 * @param {Record<string, unknown> | null} [identityOverride]
 * @returns {{ routeProfile: string | null; providerId: string | null; providerModel: string | null }}
 */
function probeExecutionIdentity(probe, identityOverride = null) {
    const identity = isRecord(identityOverride) ? identityOverride : {};
    return {
        routeProfile: optionalIdentityString(identity['routeProfile']) ?? optionalIdentityString(probe['profile']),
        providerId:
            optionalIdentityString(identity['providerId']) ??
            optionalIdentityString(probe['preset']) ??
            optionalIdentityString(probe['providerType']),
        providerModel: optionalIdentityString(identity['providerModel']) ?? optionalIdentityString(probe['model']),
    };
}

/**
 * @param {string} kind
 * @param {Record<string, any>} probe
 * @param {Record<string, unknown> | null} [identityOverride]
 * @returns {Promise<boolean>}
 */
async function recordProbeHealth(kind, probe, identityOverride = null) {
    const identity = probeExecutionIdentity(probe, identityOverride);
    const providerAttempted = probe['status'] !== 'admission-blocked';
    recordByokProviderModelProbeResult({
        ...identity,
        probeKind: kind,
        status: String(probe['status'] ?? 'unknown'),
        ok: probe['ok'] === true,
        providerAttempted,
        message: probe['errors']?.[0] ?? null,
        errorContext: probe['providerFailure']?.['errorContext'] ?? `model_gateway_${kind}_probe`,
        failureKind: probe['providerFailure']?.['kind'] ?? null,
        failureStatusCode: probe['providerFailure']?.['statusCode'] ?? null,
        retryAfterSeconds: probe['providerFailure']?.['retryAfterSeconds'] ?? null,
        resetAt: probe['providerFailure']?.['resetAt'] ?? null,
    });
    if (kind === 'agent' && probe['ok'] === true) {
        recordByokProviderModelAgentProbeSuccess(identity);
    } else if (kind === 'agent' && providerAttempted) {
        recordByokProviderModelAgentProbeFailure({
            ...identity,
            message: probe['errors']?.[0] ?? `agent probe ${probe['status'] ?? 'unknown'}`,
            errorContext: probe['providerFailure']?.['errorContext'] ?? 'model_gateway_agent_probe',
        });
    } else if (kind === 'chat' && probe['ok'] === true) {
        recordByokProviderModelCallSuccess({ ...identity, successContext: 'model_gateway_probe' });
    } else if (kind === 'chat' && providerAttempted) {
        recordByokProviderModelCallFailure({
            ...identity,
            message: probe['errors']?.[0] ?? `probe ${probe['status'] ?? 'unknown'}`,
            errorContext: probe['providerFailure']?.['errorContext'] ?? 'model_gateway_probe',
            failureKind: probe['providerFailure']?.['kind'] ?? null,
            failureStatusCode: probe['providerFailure']?.['statusCode'] ?? null,
            retryAfterSeconds: probe['providerFailure']?.['retryAfterSeconds'] ?? null,
            resetAt: probe['providerFailure']?.['resetAt'] ?? null,
        });
    }
    await flushByokProviderHealth();
    return providerAttempted;
}

/**
 * @param {Record<string, any>} probe
 * @param {string} kind
 * @param {boolean} providerAttempted
 * @param {string} observedAt
 * @param {Record<string, unknown> | null} [identityOverride]
 */
function persistedProbeResult(probe, kind, providerAttempted, observedAt, identityOverride = null) {
    const identity = probeExecutionIdentity(probe, identityOverride);
    return /** @type {Record<string, unknown>} */ (
        redactModelGatewayAuditedValue({
            providerId: identity.providerId ?? 'unknown-provider',
            providerModel: identity.providerModel ?? 'unknown-model',
            routeProfile: identity.routeProfile ?? 'default',
            kind,
            ok: probe['ok'] === true,
            status: String(probe['status'] ?? 'unknown'),
            observedAt,
            elapsedMs: probe['elapsedMs'] ?? null,
            providerAttempted,
            errorCount: Array.isArray(probe['errors']) ? probe['errors'].length : 0,
            warningCount: Array.isArray(probe['warnings']) ? probe['warnings'].length : 0,
        })
    );
}

/**
 * @param {Record<string, unknown>} replay
 * @param {string} operationId
 * @param {string} idempotencyKey
 */
function projectProbeReplay(replay, operationId, idempotencyKey) {
    const payload = isRecord(replay['payload']) ? replay['payload'] : {};
    return {
        operationId,
        idempotencyKey,
        replayed: true,
        status: replay['status'],
        ok: Number(replay['successCount'] ?? 0) > 0 && Number(replay['failureCount'] ?? 0) === 0,
        providerAttempted: payload['providerAttempted'] !== false,
        result: isRecord(payload['result']) ? payload['result'] : null,
        persistence: {
            runId: operationId,
            probeResults: Array.isArray(replay['results']) ? replay['results'].length : 0,
            skippedResults: Number(replay['skippedCount'] ?? 0),
            successCount: Number(replay['successCount'] ?? 0),
            failureCount: Number(replay['failureCount'] ?? 0),
        },
        event: null,
        probe: null,
    };
}

/**
 * @param {string} idempotencyKey
 * @param {{ sqliteStore?: SqliteModelGatewayCatalogStore }} [options]
 */
export async function readModelGatewayProbeOperation(idempotencyKey, options = {}) {
    const operationId = createModelGatewayProbeOperationId(idempotencyKey);
    const replay = await (options.sqliteStore ?? new SqliteModelGatewayCatalogStore()).readRuntimeProbeRunRecord(
        operationId,
    );
    return replay ? projectProbeReplay(replay, operationId, idempotencyKey) : null;
}

/**
 * @param {{
 *   kind: string;
 *   env?: Record<string, string | undefined>;
 *   model?: string | null;
 *   timeoutMs?: number;
 *   idempotencyKey: string;
 *   source?: string;
 *   identity?: { routeProfile?: string | null; providerId?: string | null; providerModel?: string | null };
 *   deps?: {
 *     sqliteStore?: SqliteModelGatewayCatalogStore;
 *     evaluateAdmission?: (summary: any, mode: 'chat' | 'agent', prompt: string) => any;
 *     classifyProviderFailure?: typeof classifyByokProviderFailure;
 *     emit?: (event: Record<string, unknown>) => void;
 *     now?: () => number;
 *     runProbe?: (options: Record<string, unknown>) => Promise<Record<string, any>>;
 *     recordHealth?: (kind: string, probe: Record<string, any>, identity?: Record<string, unknown> | null) => Promise<boolean>;
 *     buildEvent?: (input: { probeKind: string; result: Record<string, any>; providerAttempted: boolean }) => Record<string, unknown>;
 *   };
 * }} input
 */
export async function executeModelGatewayProbe(input) {
    if (!MODEL_GATEWAY_EXECUTABLE_PROBE_KINDS.includes(input.kind)) {
        throw new Error(`MODEL_GATEWAY_PROBE_KIND_UNSUPPORTED: ${input.kind}`);
    }
    const sqliteStore = input.deps?.sqliteStore ?? new SqliteModelGatewayCatalogStore();
    const operationId = createModelGatewayProbeOperationId(input.idempotencyKey);
    const replay = await sqliteStore.readRuntimeProbeRunRecord(operationId);
    if (replay) return projectProbeReplay(replay, operationId, input.idempotencyKey);
    const startedAtMs = input.deps?.now?.() ?? Date.now();
    const runner = input.deps?.runProbe ?? resolveProbeRunner(input.kind);
    const probe = await runner({
        env: input.env ?? process.env,
        ...(input.model ? { model: input.model } : {}),
        ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
        deps: {
            ...(input.deps?.evaluateAdmission ? { evaluateAdmission: input.deps.evaluateAdmission } : {}),
            classifyProviderFailure: input.deps?.classifyProviderFailure ?? classifyByokProviderFailure,
        },
    });
    const canonicalIdentity = probeExecutionIdentity(probe, input.identity ?? null);
    const providerAttempted = await (input.deps?.recordHealth ?? recordProbeHealth)(
        input.kind,
        probe,
        canonicalIdentity,
    );
    const observedAt = new Date(input.deps?.now?.() ?? Date.now()).toISOString();
    const result = persistedProbeResult(probe, input.kind, providerAttempted, observedAt, canonicalIdentity);
    const status = probe['ok'] === true ? 'completed' : 'failed';
    const persistence = await sqliteStore.writeRuntimeProbeRun({
        runId: operationId,
        probeProfile: canonicalIdentity.routeProfile ?? probe['profile'] ?? 'default',
        status,
        startedAt: startedAtMs,
        completedAt: observedAt,
        payload: {
            source: input.source ?? 'model-gateway.control-plane',
            operationId,
            idempotencyKey: input.idempotencyKey,
            providerAttempted,
            result,
        },
        results: [result],
    });
    const eventProbe = {
        ...probe,
        profile: canonicalIdentity.routeProfile ?? probe['profile'] ?? null,
        preset: canonicalIdentity.providerId ?? probe['preset'] ?? null,
        model: canonicalIdentity.providerModel ?? probe['model'] ?? null,
    };
    const event = (input.deps?.buildEvent ?? buildProbeCompletedEvent)({
        probeKind: input.kind,
        result: eventProbe,
        providerAttempted,
    });
    try {
        input.deps?.emit?.(event);
    } catch {
        // Observability must not invalidate a completed disposable probe.
    }
    return {
        operationId,
        idempotencyKey: input.idempotencyKey,
        replayed: false,
        status,
        ok: probe['ok'] === true,
        providerAttempted,
        result,
        persistence,
        event,
        probe,
    };
}
