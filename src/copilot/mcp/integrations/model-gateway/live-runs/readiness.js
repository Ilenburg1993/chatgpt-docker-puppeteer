// @ts-check
/** Cached, call-scoped readiness execution for governed Model Gateway / LLM-B live operations. */

import { readByokProviderHealthPersistenceFingerprint } from '#copilot/model-gateway';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { runModelGatewayLiveReadinessProcess } from './runtime.js';

export const MODEL_GATEWAY_LIVE_READINESS_CACHE_TTL_MS = 30_000;
const LIVE_READINESS_CACHE_MAX_ENTRIES = 8;

/** @typedef {{
 *     success: boolean;
 *     parsed: Record<string, any> | null;
 *     stderr: string;
 *     stdout: string;
 *     error: string | null;
 *     unstableSnapshot: boolean;
 *     execution: string;
 *     cacheAgeMs: number;
 *     durationMs: number;
 *     processDurationMs: number;
 *     timing: {
 *         totalMs: number;
 *         initialFingerprintMs: number;
 *         initialSqliteFingerprintMs: number;
 *         processMs: number;
 *         completedFingerprintMs: number;
 *         completedSqliteFingerprintMs: number;
 *     };
 *     diagnosticTiming?: Record<string, unknown>;
 * }} ModelGatewayLiveReadinessExecution
 */

/** @type {Map<string, { parsed: Record<string, unknown>; completedAtMs: number; processDurationMs: number }>} */
const liveReadinessCache = new Map();
/** @type {WeakMap<object, { contextId: string; proof: Record<string, unknown> | null }>} */
let redactionProofStateByAuthority = new WeakMap();

/** @param {object} authority */
function redactionProofStateForAuthority(authority) {
    let state = redactionProofStateByAuthority.get(authority);
    if (state) return state;
    state = { contextId: randomUUID(), proof: null };
    redactionProofStateByAuthority.set(authority, state);
    return state;
}

/** @param {Record<string, any>} parsed @param {string} expectedContextId */
function readReturnedRedactionProof(parsed, expectedContextId) {
    const redaction = parsed['redaction'];
    if (!redaction || typeof redaction !== 'object' || Array.isArray(redaction)) return null;
    const proof = /** @type {Record<string, unknown> | undefined} */ (redaction['proof']);
    if (!proof || typeof proof !== 'object' || Array.isArray(proof)) return null;
    if (proof['schema'] !== 'model-gateway-readiness-redaction-proof' || proof['version'] !== 1) return null;
    if (proof['contextId'] !== expectedContextId) return null;
    const catalog = proof['catalog'];
    const sqlite = proof['sqlite'];
    if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) return null;
    if (!sqlite || typeof sqlite !== 'object' || Array.isArray(sqlite)) return null;
    return proof;
}

/** @param {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} workspace @param {string} filePath */
async function readinessFileFingerprint(workspace, filePath) {
    try {
        const info = (await workspace.io.statPath(filePath)).stats;
        return `${info.size}:${Math.trunc(info.mtimeMs)}`;
    } catch (error) {
        const code = /** @type {NodeJS.ErrnoException} */ (error)?.code;
        return code === 'ENOENT' ? 'missing' : `error:${code ?? 'unknown'}`;
    }
}

/**
 * @param {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} workspace
 * @param {boolean} includeSqliteRuntimeHealth
 * @param {Readonly<{ read: () => string }> | undefined} sqliteFingerprintCapability
 */
async function buildLiveReadinessFingerprint(workspace, includeSqliteRuntimeHealth, sqliteFingerprintCapability) {
    const startedAt = performance.now();
    let catalogFileMs = 0;
    let byokHealthMs = 0;
    const [catalogFile, byokHealthFile] = await Promise.all([
        (async () => {
            const phaseStartedAt = performance.now();
            try {
                return await readinessFileFingerprint(
                    workspace,
                    join(workspace.workspaceRoot, 'data', 'copilot', 'model-gateway', 'catalog.json'),
                );
            } finally {
                catalogFileMs = Number((performance.now() - phaseStartedAt).toFixed(3));
            }
        })(),
        (async () => {
            const phaseStartedAt = performance.now();
            try {
                return await readByokProviderHealthPersistenceFingerprint();
            } finally {
                byokHealthMs = Number((performance.now() - phaseStartedAt).toFixed(3));
            }
        })(),
    ]);
    const sqliteStartedAt = performance.now();
    const sqliteLogical = sqliteFingerprintCapability?.read() ?? 'unavailable:no-sqlite-fingerprint-capability';
    const sqliteMs = Number((performance.now() - sqliteStartedAt).toFixed(3));
    return {
        value: `${workspace.workspaceRoot}:${includeSqliteRuntimeHealth ? 'sqlite-health' : 'file-health'}:${catalogFile}:${sqliteLogical}:${byokHealthFile}`,
        durationMs: Number((performance.now() - startedAt).toFixed(3)),
        catalogFileMs,
        byokHealthMs,
        sqliteMs,
    };
}

/** @param {number} now */
function pruneLiveReadinessCache(now) {
    for (const [key, entry] of liveReadinessCache.entries()) {
        if (now - entry.completedAtMs > MODEL_GATEWAY_LIVE_READINESS_CACHE_TTL_MS) liveReadinessCache.delete(key);
    }
    while (liveReadinessCache.size > LIVE_READINESS_CACHE_MAX_ENTRIES) {
        const oldestKey = liveReadinessCache.keys().next().value;
        if (typeof oldestKey !== 'string') break;
        liveReadinessCache.delete(oldestKey);
    }
}

/**
 * @param {AbortSignal | undefined} signal
 */
function throwIfAborted(signal) {
    if (!signal?.aborted) return;
    const reason = signal.reason;
    throw reason instanceof Error
        ? reason
        : new Error(reason === undefined ? 'Model Gateway readiness aborted.' : String(reason));
}

/**
 * @param {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} workspace
 * @param {boolean} includeSqliteRuntimeHealth
 * @param {{
 *     signal?: AbortSignal;
 *     sqliteFingerprint?: Readonly<{ read: () => string }>;
 *     diagnostics?: boolean;
 *     now?: () => number;
 *     environmentAuthority: import('./environment.js').ModelGatewayLiveRunEnvironmentAuthority;
 * }} options
 * @returns {Promise<ModelGatewayLiveReadinessExecution>}
 */
export async function executeModelGatewayLiveReadiness(workspace, includeSqliteRuntimeHealth, options) {
    if (!options?.environmentAuthority) {
        throw new TypeError('Model Gateway readiness requires an explicit live-run environment authority.');
    }
    const requestStartedAt = performance.now();
    const proofState = redactionProofStateForAuthority(options.environmentAuthority);
    throwIfAborted(options.signal);
    const initialFingerprint = await buildLiveReadinessFingerprint(
        workspace,
        includeSqliteRuntimeHealth,
        options.sqliteFingerprint,
    );
    throwIfAborted(options.signal);
    const key = initialFingerprint.value;
    const now = options.now?.() ?? Date.now();
    pruneLiveReadinessCache(now);
    const cached = liveReadinessCache.get(key);
    if (cached && now - cached.completedAtMs <= MODEL_GATEWAY_LIVE_READINESS_CACHE_TTL_MS) {
        const totalMs = Number((performance.now() - requestStartedAt).toFixed(3));
        return {
            success: true,
            parsed: cached.parsed,
            stderr: '',
            stdout: '',
            unstableSnapshot: false,
            execution: 'memory-cache',
            cacheAgeMs: now - cached.completedAtMs,
            durationMs: totalMs,
            processDurationMs: cached.processDurationMs,
            timing: {
                totalMs,
                initialFingerprintMs: initialFingerprint.durationMs,
                initialSqliteFingerprintMs: initialFingerprint.sqliteMs,
                processMs: 0,
                completedFingerprintMs: 0,
                completedSqliteFingerprintMs: 0,
            },
            diagnosticTiming: {
                initialFingerprint: {
                    totalMs: initialFingerprint.durationMs,
                    catalogFileMs: initialFingerprint.catalogFileMs,
                    byokHealthMs: initialFingerprint.byokHealthMs,
                    sqliteMs: initialFingerprint.sqliteMs,
                },
                process: null,
                readiness: null,
                completedFingerprint: null,
            },
            error: null,
        };
    }

    let parsed = null;
    let error = null;
    let unstableSnapshot = false;
    let processMs = 0;
    let completedFingerprintMs = 0;
    let completedSqliteFingerprintMs = 0;
    /** @type {{ processTiming: Record<string, unknown> | null; readinessTiming: Record<string, unknown> | null; completedFingerprint: Record<string, number> | null }} */
    const processExecutionDiagnostics = {
        processTiming: null,
        readinessTiming: null,
        completedFingerprint: null,
    };
    try {
        const processExecution = await runModelGatewayLiveReadinessProcess(workspace, includeSqliteRuntimeHealth, {
            environmentAuthority: options.environmentAuthority,
            redactionProofContextId: proofState.contextId,
            ...(proofState.proof ? { redactionProof: proofState.proof } : {}),
            ...(options.diagnostics === true ? { diagnostics: true } : {}),
            ...(options.signal ? { signal: options.signal } : {}),
        });
        processMs = processExecution.durationMs;
        processExecutionDiagnostics.processTiming = processExecution.processTiming ?? null;
        processExecutionDiagnostics.readinessTiming =
            'readinessTiming' in processExecution ? processExecution.readinessTiming : null;
        parsed = processExecution.parsed;
        if (!processExecution.success || !parsed) {
            throw new Error(processExecution.error ?? 'LLM-B live readiness process returned no readiness payload.');
        }
        const returnedProof = readReturnedRedactionProof(parsed, proofState.contextId);
        if (!returnedProof) {
            parsed = null;
            throw new Error('LLM-B live readiness returned no valid context-bound redaction proof.');
        }
        proofState.proof = returnedProof;
        throwIfAborted(options.signal);
        const completionFingerprintStartedAt = performance.now();
        const completedFingerprint = await buildLiveReadinessFingerprint(
            workspace,
            includeSqliteRuntimeHealth,
            options.sqliteFingerprint,
        );
        completedFingerprintMs = Number((performance.now() - completionFingerprintStartedAt).toFixed(3));
        completedSqliteFingerprintMs = completedFingerprint.sqliteMs;
        processExecutionDiagnostics.completedFingerprint = {
            totalMs: completedFingerprint.durationMs,
            catalogFileMs: completedFingerprint.catalogFileMs,
            byokHealthMs: completedFingerprint.byokHealthMs,
            sqliteMs: completedFingerprint.sqliteMs,
        };
        throwIfAborted(options.signal);
        if (completedFingerprint.value !== initialFingerprint.value) {
            unstableSnapshot = true;
            parsed = null;
            error = 'Model Gateway readiness state changed during build; retry required.';
        } else {
            const completedAtMs = options.now?.() ?? Date.now();
            liveReadinessCache.set(initialFingerprint.value, {
                parsed,
                completedAtMs,
                processDurationMs: processMs,
            });
            pruneLiveReadinessCache(completedAtMs);
        }
    } catch (executionError) {
        if (options.signal?.aborted) throwIfAborted(options.signal);
        error = executionError instanceof Error ? executionError.message : String(executionError);
    }

    const totalMs = Number((performance.now() - requestStartedAt).toFixed(3));
    const success = parsed !== null && error === null;
    return {
        success,
        parsed,
        stderr: '',
        stdout: '',
        error,
        unstableSnapshot,
        execution: 'fresh-process',
        cacheAgeMs: 0,
        durationMs: totalMs,
        processDurationMs: processMs,
        timing: {
            totalMs,
            initialFingerprintMs: initialFingerprint.durationMs,
            initialSqliteFingerprintMs: initialFingerprint.sqliteMs,
            processMs,
            completedFingerprintMs,
            completedSqliteFingerprintMs,
        },
        diagnosticTiming: {
            initialFingerprint: {
                totalMs: initialFingerprint.durationMs,
                catalogFileMs: initialFingerprint.catalogFileMs,
                byokHealthMs: initialFingerprint.byokHealthMs,
                sqliteMs: initialFingerprint.sqliteMs,
            },
            process: processExecutionDiagnostics.processTiming,
            readiness: processExecutionDiagnostics.readinessTiming,
            completedFingerprint: processExecutionDiagnostics.completedFingerprint,
        },
    };
}

export function resetModelGatewayLiveReadinessCacheForTests() {
    liveReadinessCache.clear();
    redactionProofStateByAuthority = new WeakMap();
}
