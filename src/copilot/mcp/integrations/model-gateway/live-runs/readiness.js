// @ts-check
/** Cached readiness execution for governed Model Gateway / LLM-B live operations. */

import { readByokProviderHealthPersistenceFingerprint } from '#copilot/model-gateway';
import { buildModelGatewayLiveReadiness } from '#copilot/model-gateway/readiness';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
export const MODEL_GATEWAY_LIVE_READINESS_CACHE_TTL_MS = 30_000;
const LIVE_READINESS_CACHE_MAX_ENTRIES = 8;

/** @typedef {{
 *     success: boolean;
 *     parsed: Record<string, any> | null;
 *     stderr: string;
 *     stdout: string;
 *     error: string | null;
 *     execution: string;
 *     cacheAgeMs: number;
 *     durationMs: number;
 * }} ModelGatewayLiveReadinessExecution
 */

/** @type {Map<string, { parsed: Record<string, unknown>; completedAtMs: number; durationMs: number }>} */
const liveReadinessCache = new Map();
/** @type {Map<string, Promise<ModelGatewayLiveReadinessExecution>>} */
const liveReadinessInFlight = new Map();

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
    const [catalogFile, byokHealthFile] = await Promise.all([
        readinessFileFingerprint(
            workspace,
            join(workspace.workspaceRoot, 'data', 'copilot', 'model-gateway', 'catalog.json'),
        ),
        readByokProviderHealthPersistenceFingerprint(),
    ]);
    const sqliteLogical = sqliteFingerprintCapability?.read() ?? 'unavailable:no-sqlite-fingerprint-capability';
    return `${workspace.workspaceRoot}:${includeSqliteRuntimeHealth ? 'sqlite-health' : 'file-health'}:${catalogFile}:${sqliteLogical}:${byokHealthFile}`;
}

function pruneLiveReadinessCache() {
    const now = Date.now();
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
 * @param {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} workspace
 * @param {boolean} includeSqliteRuntimeHealth
 * @param {{
 *     signal?: AbortSignal;
 *     sqliteFingerprint?: Readonly<{ read: () => string }>;
 *     environmentAuthority: import('./environment.js').ModelGatewayLiveRunEnvironmentAuthority;
 * }} options
 * @returns {Promise<ModelGatewayLiveReadinessExecution>}
 */
export async function executeModelGatewayLiveReadiness(workspace, includeSqliteRuntimeHealth, options) {
    if (!options?.environmentAuthority) {
        throw new TypeError('Model Gateway readiness requires an explicit live-run environment authority.');
    }
    const fingerprint = await buildLiveReadinessFingerprint(
        workspace,
        includeSqliteRuntimeHealth,
        options.sqliteFingerprint,
    );
    const key = fingerprint;
    const now = Date.now();
    pruneLiveReadinessCache();
    const cached = liveReadinessCache.get(key);
    if (cached && now - cached.completedAtMs <= MODEL_GATEWAY_LIVE_READINESS_CACHE_TTL_MS) {
        return {
            success: true,
            parsed: cached.parsed,
            stderr: '',
            stdout: '',
            execution: 'memory-cache',
            cacheAgeMs: now - cached.completedAtMs,
            durationMs: cached.durationMs,
            error: null,
        };
    }
    const existing = liveReadinessInFlight.get(key);
    if (existing) {
        const result = await existing;
        return { ...result, execution: 'single-flight', cacheAgeMs: 0 };
    }

    const promise = (async () => {
        const startedAt = performance.now();
        let parsed = null;
        const stderr = '';
        const stdout = '';
        let error = null;
        const execution = 'fresh-domain-service';
        if (options.signal?.aborted) throw options.signal.reason ?? new Error('Model Gateway readiness aborted.');
        try {
            parsed = await buildModelGatewayLiveReadiness({
                workspaceRoot: workspace.workspaceRoot,
                liveRunnerPath: join(
                    workspace.workspaceRoot,
                    'scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs',
                ),
                redactionWorkerPath: join(
                    workspace.workspaceRoot,
                    'scripts/model-gateway/commands/model-gateway-live-redaction-worker.mjs',
                ),
                includeSqliteRuntimeHealth,
                reuseRedactionWorkers: true,
                env: options.environmentAuthority.liveRunEnvironment({
                    invokesModel: false,
                    invokesRealProvider: true,
                }),
            });
        } catch (builderError) {
            error = builderError instanceof Error ? builderError.message : String(builderError);
        }
        const durationMs = Number((performance.now() - startedAt).toFixed(3));
        const completedAtMs = Date.now();
        const success = parsed !== null && error === null;
        if (success && parsed) {
            const completedFingerprint = await buildLiveReadinessFingerprint(
                workspace,
                includeSqliteRuntimeHealth,
                options.sqliteFingerprint,
            );
            liveReadinessCache.set(completedFingerprint, { parsed, completedAtMs, durationMs });
            pruneLiveReadinessCache();
        }
        return { success, parsed, stderr, stdout, error, execution, cacheAgeMs: 0, durationMs };
    })();

    liveReadinessInFlight.set(key, promise);
    try {
        return await promise;
    } finally {
        if (liveReadinessInFlight.get(key) === promise) liveReadinessInFlight.delete(key);
    }
}

export function resetModelGatewayLiveReadinessCacheForTests() {
    liveReadinessCache.clear();
    liveReadinessInFlight.clear();
}
