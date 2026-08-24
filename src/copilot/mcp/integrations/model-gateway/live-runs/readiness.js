// @ts-check
/** Cached readiness execution for governed Model Gateway / LLM-B live operations. */

import { readModelGatewaySqliteFingerprint } from '#copilot/mcp/public/integrations/model-gateway/sqlite-fingerprint';
import { readByokProviderHealthPersistenceFingerprint } from '#copilot/model-gateway';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { runModelGatewayLiveCommand } from './runtime.js';

const LIVE_READINESS_MODULE_URL = new URL(
    '../../../../../../scripts/model-gateway/commands/model-gateway-live-readiness.mjs',
    import.meta.url,
).href;
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

/** @param {string} text */
function parseJsonOutput(text) {
    const trimmed = text.trim();
    if (!trimmed) return null;
    try {
        return JSON.parse(trimmed);
    } catch {
        const start = trimmed.indexOf('{');
        const end = trimmed.lastIndexOf('}');
        if (start >= 0 && end > start) {
            try {
                return JSON.parse(trimmed.slice(start, end + 1));
            } catch {
                return null;
            }
        }
        return null;
    }
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

/** @param {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} workspace @param {boolean} includeSqliteRuntimeHealth */
async function buildLiveReadinessFingerprint(workspace, includeSqliteRuntimeHealth) {
    const [catalogFile, byokHealthFile] = await Promise.all([
        readinessFileFingerprint(
            workspace,
            join(workspace.workspaceRoot, 'data', 'copilot', 'model-gateway', 'catalog.json'),
        ),
        readByokProviderHealthPersistenceFingerprint(),
    ]);
    const sqliteLogical = readModelGatewaySqliteFingerprint();
    return `${workspace.workspaceRoot}:${includeSqliteRuntimeHealth ? 'sqlite-health' : 'file-health'}:${catalogFile}:${sqliteLogical}:${byokHealthFile}`;
}

/** @type {Promise<
 * | ((options?: { includeSqliteRuntimeHealth?: boolean; reuseRedactionWorkers?: boolean }) => Promise<Record<string, any>>)
 * | null
 * > | null} */
let liveReadinessBuilderPromise = null;

async function loadLiveReadinessBuilder() {
    if (!liveReadinessBuilderPromise) {
        liveReadinessBuilderPromise = import(LIVE_READINESS_MODULE_URL)
            .then((module) =>
                typeof module.buildModelGatewayLiveReadiness === 'function'
                    ? module.buildModelGatewayLiveReadiness
                    : null,
            )
            .catch(() => null);
    }
    return liveReadinessBuilderPromise;
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
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<ModelGatewayLiveReadinessExecution>}
 */
export async function executeModelGatewayLiveReadiness(workspace, includeSqliteRuntimeHealth, options = {}) {
    const fingerprint = await buildLiveReadinessFingerprint(workspace, includeSqliteRuntimeHealth);
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
        const builder = await loadLiveReadinessBuilder();
        let parsed = null;
        let stderr = '';
        let stdout = '';
        let error = null;
        let execution = 'fresh-in-process';
        if (builder) {
            if (options.signal?.aborted) throw options.signal.reason ?? new Error('Model Gateway readiness aborted.');
            try {
                parsed = await builder({ includeSqliteRuntimeHealth, reuseRedactionWorkers: true });
            } catch (builderError) {
                error = builderError instanceof Error ? builderError.message : String(builderError);
            }
        } else {
            execution = 'fallback-subprocess';
            const args = ['--json'];
            if (includeSqliteRuntimeHealth) args.push('--sqlite-runtime-health');
            const result = await runModelGatewayLiveCommand({
                workspace,
                command: 'readiness',
                args,
                timeoutMs: 120_000,
                ...(options.signal ? { signal: options.signal } : {}),
            });
            const parsedValue = parseJsonOutput(result.stdout);
            parsed =
                parsedValue && typeof parsedValue === 'object' && !Array.isArray(parsedValue)
                    ? /** @type {Record<string, any>} */ (parsedValue)
                    : null;
            stderr = result.stderr;
            stdout = result.stdout;
            error = result.error;
        }
        const durationMs = Number((performance.now() - startedAt).toFixed(3));
        const completedAtMs = Date.now();
        const success = parsed !== null && error === null;
        if (success && parsed) {
            const completedFingerprint = await buildLiveReadinessFingerprint(workspace, includeSqliteRuntimeHealth);
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
    liveReadinessBuilderPromise = null;
}
