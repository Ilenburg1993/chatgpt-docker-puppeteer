// @ts-check
/**
 * Disposable, idempotent probe execution shared by terminal and LLM-B adapters.
 *
 * @module copilot/model-gateway/control-plane/probe-execution
 */

import { createHash } from 'node:crypto';
import { SqliteModelGatewayCatalogStore } from '../catalog/sqlite-catalog-store.js';

/**
 * Persistência mínima exigida pelo executor de probes. O executor não depende das demais responsabilidades do catálogo
 * SQLite; manter esta porta estrutural permite stores alternativos e harnesses determinísticos sem herdar a classe inteira.
 *
 * @typedef {Pick<SqliteModelGatewayCatalogStore, 'readRuntimeProbeRunRecord' | 'writeRuntimeProbeRun'>} ModelGatewayProbeStore
 */
import {
    classifyByokProviderFailure,
    flushByokProviderHealth,
    recordByokProviderModelAgentProbeFailure,
    recordByokProviderModelAgentProbeSuccess,
    recordByokProviderModelCallFailure,
    recordByokProviderModelCallSuccess,
    recordByokProviderModelProbeResult,
} from '../health/index.js';
import { isByokProviderFailure } from '../health/provider-failure.js';
import { buildProbeCompletedEvent } from '../observability/events.js';
import {
    classifyConfiguredByokProbeFailureScope,
    didConfiguredByokProbeAttemptProvider,
    runConfiguredByokAgentProbe,
    runConfiguredByokChatProbe,
    runConfiguredByokJsonProbe,
    runConfiguredByokStreamingProbe,
    runConfiguredByokVisionProbe,
} from '../probes/index.js';
import { redactModelGatewayAuditedValue } from '../secrets/index.js';

/** @typedef {import('../health/provider-failure.js').ByokProviderFailure} ByokProviderFailure */

/**
 * Common result surface guaranteed by every executable Model Gateway BYOK probe. Capability-specific fields remain
 * extensible through the Record intersection and are intentionally consumed via Reflect by specialized renderers.
 *
 * @typedef {Record<string, unknown> & {
 *   ok: boolean;
 *   status: string;
 *   providerAttempted: boolean;
 *   elapsedMs: number;
 *   model: string | null;
 *   profile: string | null;
 *   preset: string | null;
 *   providerType: string | null;
 *   deltaCount: number;
 *   deltaChars: number;
 *   finalChars: number;
 *   observedFinalEvent: boolean;
 *   sessionId: string | null;
 *   errors: string[];
 *   warnings: string[];
 *   providerFailure?: ByokProviderFailure | null;
 * }} ModelGatewayExecutableProbeResult
 */

/**
 * @callback ModelGatewayProbeAdmissionEvaluator
 * @param {ReturnType<typeof import('#copilot/sdk/session/provider').readConfiguredByokState>['summary']} summary
 * @param {'chat' | 'agent'} mode
 * @param {string} prompt
 * @returns {ReturnType<typeof import('../probes/admission.js').evaluateModelGatewayProbeAdmission>}
 */

/**
 * @typedef {object} ModelGatewayExecutableProbeOptions
 * @property {Record<string, string | undefined>} [env]
 * @property {string} [model]
 * @property {number} [timeoutMs]
 * @property {{
 *   evaluateAdmission?: ModelGatewayProbeAdmissionEvaluator;
 *   classifyProviderFailure?: typeof classifyByokProviderFailure;
 * }} [deps]
 */

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
 * @param {unknown} value
 * @returns {number | null}
 */
function optionalFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}


/**
 * @param {ModelGatewayExecutableProbeResult} probe
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
 * @param {ModelGatewayExecutableProbeResult} probe
 * @param {Record<string, unknown> | null} [identityOverride]
 * @returns {Promise<boolean>}
 */
async function recordProbeHealth(kind, probe, identityOverride = null) {
    const identity = probeExecutionIdentity(probe, identityOverride);
    const providerAttempted = didConfiguredByokProbeAttemptProvider(probe);
    const message = probe.errors[0] ?? null;
    const providerFailure = probe.providerFailure ?? null;
    const errorContext = providerFailure?.errorContext ?? null;
    const failureKind = providerFailure?.kind ?? null;
    const failureStatusCode = providerFailure?.statusCode ?? null;
    const retryAfterSeconds = providerFailure?.retryAfterSeconds ?? null;
    const resetAt = providerFailure?.resetAt ?? null;
    recordByokProviderModelProbeResult({
        ...identity,
        probeKind: kind,
        status: String(probe['status'] ?? 'unknown'),
        ok: probe.ok,
        providerAttempted,
        message,
        errorContext: errorContext ?? `model_gateway_${kind}_probe`,
        failureKind,
        failureStatusCode,
        retryAfterSeconds,
        resetAt,
    });
    if (kind === 'agent' && probe['ok'] === true) {
        recordByokProviderModelAgentProbeSuccess(identity);
    } else if (kind === 'agent' && providerAttempted) {
        recordByokProviderModelAgentProbeFailure({
            ...identity,
            message: message ?? `agent probe ${probe['status'] ?? 'unknown'}`,
            errorContext: errorContext ?? 'model_gateway_agent_probe',
        });
    } else if (kind === 'chat' && probe['ok'] === true) {
        recordByokProviderModelCallSuccess({ ...identity, successContext: 'model_gateway_probe' });
    } else if (kind === 'chat' && providerAttempted) {
        recordByokProviderModelCallFailure({
            ...identity,
            message: message ?? `probe ${probe['status'] ?? 'unknown'}`,
            errorContext: errorContext ?? 'model_gateway_probe',
            failureKind,
            failureStatusCode,
            retryAfterSeconds,
            resetAt,
        });
    }
    await flushByokProviderHealth();
    return providerAttempted;
}

/**
 * @param {ModelGatewayExecutableProbeResult} probe
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
            elapsedMs: probe.elapsedMs,
            providerAttempted,
            failureScope: classifyConfiguredByokProbeFailureScope(probe),
            profile: probe.profile,
            preset: probe.preset,
            model: probe.model,
            providerType: probe.providerType,
            deltaCount: probe.deltaCount,
            deltaChars: probe.deltaChars,
            finalChars: probe.finalChars,
            observedFinalEvent: probe.observedFinalEvent,
            sessionId: probe.sessionId,
            errors: probe.errors,
            warnings: probe.warnings,
            providerFailure: probe.providerFailure ?? null,
            errorCount: probe.errors.length,
            warningCount: probe.warnings.length,
        })
    );
}

/**
 * @param {unknown} value
 * @returns {string[] | null}
 */
function persistedStringArray(value) {
    return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : null;
}

/**
 * @param {Record<string, unknown> | null} result
 * @returns {ModelGatewayExecutableProbeResult | null}
 */
function projectPersistedProbeResult(result) {
    if (!result) return null;
    const requiredKeys = [
        'ok', 'status', 'providerAttempted', 'elapsedMs', 'model', 'profile', 'preset', 'providerType',
        'deltaCount', 'deltaChars', 'finalChars', 'observedFinalEvent', 'sessionId', 'errors', 'warnings', 'providerFailure',
    ];
    if (!requiredKeys.every((key) => Object.hasOwn(result, key))) return null;
    const status = optionalIdentityString(result['status']);
    const elapsedMs = optionalFiniteNumber(result['elapsedMs']);
    const deltaCount = optionalFiniteNumber(result['deltaCount']);
    const deltaChars = optionalFiniteNumber(result['deltaChars']);
    const finalChars = optionalFiniteNumber(result['finalChars']);
    const errors = persistedStringArray(result['errors']);
    const warnings = persistedStringArray(result['warnings']);
    const providerFailure = result['providerFailure'];
    if (typeof result['ok'] !== 'boolean' || !status || typeof result['providerAttempted'] !== 'boolean') return null;
    if (elapsedMs === null || deltaCount === null || deltaChars === null || finalChars === null) return null;
    if (typeof result['observedFinalEvent'] !== 'boolean' || errors === null || warnings === null) return null;
    if (providerFailure !== null && !isByokProviderFailure(providerFailure)) return null;
    for (const key of ['model', 'profile', 'preset', 'providerType', 'sessionId']) {
        const value = result[key];
        if (value !== null && typeof value !== 'string') return null;
    }
    return /** @type {ModelGatewayExecutableProbeResult} */ ({
        ...result,
        ok: result['ok'],
        status,
        providerAttempted: result['providerAttempted'],
        elapsedMs,
        model: result['model'],
        profile: result['profile'],
        preset: result['preset'],
        providerType: result['providerType'],
        deltaCount,
        deltaChars,
        finalChars,
        observedFinalEvent: result['observedFinalEvent'],
        sessionId: result['sessionId'],
        errors,
        warnings,
        providerFailure,
    });
}

/**
 * @param {Record<string, unknown>} replay
 * @param {string} operationId
 * @param {string} idempotencyKey
 */
function projectProbeReplay(replay, operationId, idempotencyKey) {
    const payload = isRecord(replay['payload']) ? replay['payload'] : {};
    const result = isRecord(payload['result']) ? payload['result'] : null;
    const failureScope = typeof result?.['failureScope'] === 'string' ? result['failureScope'] : null;
    return {
        operationId,
        idempotencyKey,
        replayed: true,
        status: replay['status'],
        ok: Number(replay['successCount'] ?? 0) > 0 && Number(replay['failureCount'] ?? 0) === 0,
        providerAttempted: payload['providerAttempted'] !== false,
        failureScope,
        result,
        persistence: {
            runId: operationId,
            probeResults: Array.isArray(replay['results']) ? replay['results'].length : 0,
            skippedResults: Number(replay['skippedCount'] ?? 0),
            successCount: Number(replay['successCount'] ?? 0),
            failureCount: Number(replay['failureCount'] ?? 0),
        },
        event: null,
        probe: projectPersistedProbeResult(result),
    };
}

/**
 * @param {string} idempotencyKey
 * @param {{ sqliteStore?: ModelGatewayProbeStore }} [options]
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
 *     sqliteStore?: ModelGatewayProbeStore;
 *     evaluateAdmission?: ModelGatewayProbeAdmissionEvaluator;
 *     classifyProviderFailure?: typeof classifyByokProviderFailure;
 *     emit?: (event: Record<string, unknown>) => void;
 *     now?: () => number;
 *     runProbe?: (options: ModelGatewayExecutableProbeOptions) => Promise<ModelGatewayExecutableProbeResult>;
 *     recordHealth?: (kind: string, probe: ModelGatewayExecutableProbeResult, identity?: Record<string, unknown> | null) => Promise<boolean>;
 *     buildEvent?: (input: { probeKind: string; result: ModelGatewayExecutableProbeResult; providerAttempted: boolean }) => Record<string, unknown>;
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
    const failureScope = classifyConfiguredByokProbeFailureScope(probe);
    const result = persistedProbeResult(probe, input.kind, providerAttempted, observedAt, canonicalIdentity);
    const status = probe.ok ? 'completed' : 'failed';
    const persistence = await sqliteStore.writeRuntimeProbeRun({
        runId: operationId,
        probeProfile: canonicalIdentity.routeProfile ?? probe.profile ?? 'default',
        status,
        startedAt: startedAtMs,
        completedAt: observedAt,
        payload: {
            source: input.source ?? 'model-gateway.control-plane',
            operationId,
            idempotencyKey: input.idempotencyKey,
            providerAttempted,
            failureScope,
            result,
        },
        results: [result],
    });
    const eventProbe = {
        ...probe,
        profile: canonicalIdentity.routeProfile ?? probe.profile,
        preset: canonicalIdentity.providerId ?? probe.preset,
        model: canonicalIdentity.providerModel ?? probe.model,
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
        failureScope,
        result,
        persistence,
        event,
        probe,
    };
}
