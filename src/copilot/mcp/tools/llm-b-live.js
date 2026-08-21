// @ts-check
/**
 * Allowlisted MCP adapters for the canonical terminal LLM-B live harness.
 *
 * These tools never accept arbitrary commands or script paths. Readiness/runs are read-only. The live runner defaults
 * to a control-only terminal boot; any mode capable of opening a real model/provider turn requires explicit
 * confirmation.
 *
 * @module copilot/mcp/tools/llm-b-live
 */

import { getCopilotDb } from '#copilot/db';
import {
    openDetachedAppendSinkTrusted,
    readTextFreshTrusted,
    statPathTrusted,
} from '#copilot/infra/public/filesystem/trusted';
import { createWorkspaceIo } from '#copilot/infra/public/filesystem/workspace';
import {
    appendMcpAuditEvent,
    boundedWriteAnnotations,
    destructiveAnnotations,
    errorResult,
    getMcpWorkspaceRoot,
    okResult,
    readOnlyAnnotations,
} from '#copilot/mcp/control-plane';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { isAbsolute, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';
import { z } from 'zod';

const execFileAsync = promisify(execFile);
const LIVE_RUNNER = 'scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs';
const LIVE_READINESS = 'scripts/model-gateway/commands/model-gateway-live-readiness.mjs';
const LIVE_READINESS_MODULE_URL = new URL(
    '../../../../scripts/model-gateway/commands/model-gateway-live-readiness.mjs',
    import.meta.url,
).href;
const LIVE_RUNS = 'scripts/model-gateway/commands/model-gateway-live-runs.mjs';
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const DETACHED_LIVE_RUNS_DIR = 'src/copilot/.ai/mcp/llmb-live-runs';
const DETACHED_LIVE_RUN_ID_RE = /^mcp-[0-9a-f-]{36}$/u;
const DETACHED_LIVE_RUN_MANIFEST_MAX_BYTES = 128 * 1024;
const PROFILE_RE = /^[A-Za-z0-9_.:-]{1,120}$/u;
const LIVE_READINESS_CACHE_TTL_MS = 30_000;
const LIVE_READINESS_CACHE_MAX_ENTRIES = 8;
const MODEL_GATEWAY_FINGERPRINT_TABLES = Object.freeze([
    'copilot_model_gateway_catalog_sources',
    'copilot_model_gateway_model_evidence',
    'copilot_model_gateway_provider_evidence',
    'copilot_model_gateway_model_projections',
    'copilot_model_gateway_provider_projections',
    'copilot_model_gateway_route_options',
    'copilot_model_gateway_account_overlays',
    'copilot_model_gateway_import_runs',
    'copilot_model_gateway_raw_payload_refs',
    'copilot_model_gateway_conflicts',
    'copilot_model_gateway_eligibility_runs',
    'copilot_model_gateway_eligibility_decisions',
]);
/** @typedef {{
    success: boolean;
    parsed: Record<string, any> | null;
    stderr: string;
    stdout: string;
    error: string | null;
    execution: string;
    cacheAgeMs: number;
    durationMs: number;
}} LiveReadinessExecution */
/** @type {Map<string, { parsed: Record<string, unknown>; completedAtMs: number; durationMs: number }>} */
const liveReadinessCache = new Map();
/** @type {Map<string, Promise<LiveReadinessExecution>>} */
const liveReadinessInFlight = new Map();

const liveScenarioSchema = z.enum([
    'canonical',
    'freeform',
    'invalid-choice',
    'long-tool-heartbeat',
    'recoverable-tool-error',
    'file-write-roundtrip',
    'file-patch-roundtrip',
    'model-gateway-tools-readonly',
    'model-gateway-adaptive-probe',
    'model-gateway-tools-all-plan',
    'model-gateway-tools-apply-safe',
    'model-gateway-route-apply-minimal',
    'model-gateway-admin-apply',
]);
const liveModeSchema = z.enum([
    'control-only',
    'dry-run',
    'canonical-turn',
    'byok-fixture-control',
    'byok-real-control',
    'byok-real-turn',
]);
const transportSchema = z.enum(['pty', 'stdio']);
const selectionPolicySchema = z.enum(['metadata_first', 'prefer_runtime_proved', 'require_runtime_proof']);

/**
 * @param {string} script
 * @param {string[]} args
 * @param {number} timeoutMs
 */
async function execFixedNodeScript(script, args, timeoutMs) {
    try {
        const { stdout, stderr } = await execFileAsync(process.execPath, [script, ...args], {
            cwd: getMcpWorkspaceRoot(),
            env: process.env,
            encoding: 'utf8',
            timeout: timeoutMs,
            maxBuffer: MAX_OUTPUT_BYTES,
        });
        return { success: true, stdout, stderr, exitCode: 0 };
    } catch (error) {
        const err = /** @type {NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number }} */ (error);
        return {
            success: false,
            stdout: typeof err.stdout === 'string' ? err.stdout : '',
            stderr: typeof err.stderr === 'string' ? err.stderr : '',
            exitCode: typeof err.code === 'number' ? err.code : null,
            error: err.stderr || err.message,
        };
    }
}

/**
 * @typedef {object} DetachedLiveRunManifest
 * @property {'llmb-live-detached-run'} schema
 * @property {string} runId
 * @property {number} pid
 * @property {number} startedAtMs
 * @property {string} outDir
 * @property {string | undefined} [logPath]
 * @property {Record<string, unknown>} plan
 */

function detachedLiveRunsDirectory() {
    return join(getMcpWorkspaceRoot(), DETACHED_LIVE_RUNS_DIR);
}

function llmbLiveWorkspaceIo() {
    return createWorkspaceIo({ workspaceRoot: getMcpWorkspaceRoot() });
}

/** @param {string} runId */
function detachedLiveRunManifestPath(runId) {
    if (!DETACHED_LIVE_RUN_ID_RE.test(runId)) throw new Error('Invalid detached LLM-B live run id.');
    return join(detachedLiveRunsDirectory(), `${runId}.json`);
}

/** @param {number} pid */
function isProcessAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        const code = /** @type {NodeJS.ErrnoException} */ (error)?.code;
        return code === 'EPERM';
    }
}

/**
 * Verify that a manifest pid still belongs to the exact allowlisted live harness before any signal is sent. This closes
 * the PID-reuse gap inherent in `kill(pid, 0)`: a recycled pid must never make an old manifest capable of terminating
 * an unrelated process.
 *
 * @param {DetachedLiveRunManifest} manifest
 */
async function inspectDetachedLiveRunProcessIdentity(manifest) {
    if (!isProcessAlive(manifest.pid)) {
        return { alive: false, verified: false, reason: 'process-not-alive', argv: [] };
    }
    if (process.platform === 'win32') {
        return { alive: true, verified: false, reason: 'process-identity-unavailable-on-win32', argv: [] };
    }
    try {
        const cmdline = (
            await readTextFreshTrusted(`/proc/${manifest.pid}/cmdline`, { caller: 'mcp.tools.llm-b-live.proc' })
        ).content;
        const argv = cmdline.split('\0').filter(Boolean);
        const expectedOutDirArg = `--out-dir=${manifest.outDir}`;
        const runnerMatch = argv.some((arg) => arg === LIVE_RUNNER || arg.endsWith(`/${LIVE_RUNNER}`));
        const outDirMatch = argv.includes(expectedOutDirArg);
        return {
            alive: true,
            verified: runnerMatch && outDirMatch,
            reason: runnerMatch && outDirMatch ? 'verified' : 'command-line-mismatch',
            argv,
        };
    } catch (error) {
        return {
            alive: true,
            verified: false,
            reason: `process-identity-read-failed:${/** @type {NodeJS.ErrnoException} */ (error)?.code ?? 'unknown'}`,
            argv: [],
        };
    }
}

/** @param {DetachedLiveRunManifest} manifest */
async function cancelDetachedLiveRun(manifest) {
    const identity = await inspectDetachedLiveRunProcessIdentity(manifest);
    if (!identity.alive) return { cancelled: false, alreadyStopped: true, identity };
    if (!identity.verified) {
        throw Object.assign(
            new Error(`Detached LLM-B live run process identity could not be verified (${identity.reason}).`),
            {
                code: 'ERR_LLMB_LIVE_CANCEL_IDENTITY_MISMATCH',
            },
        );
    }
    try {
        // The detached runner is its own process-group leader on POSIX. Terminating the group also contains any PTY/
        // terminal descendants started by the harness instead of leaving provider work orphaned.
        process.kill(-manifest.pid, 'SIGTERM');
    } catch (error) {
        const code = /** @type {NodeJS.ErrnoException} */ (error)?.code;
        if (code !== 'ESRCH') throw error;
        process.kill(manifest.pid, 'SIGTERM');
    }
    return { cancelled: true, alreadyStopped: false, identity };
}

/**
 * Launch the fixed canonical harness independently of the initiating MCP request. The harness writes its own artifacts
 * and SQLite ledger; this manifest only makes the in-flight state observable and survives MCP reloads.
 *
 * @param {{ args: string[]; plan: Record<string, unknown>; timeoutMs: number }} input
 */
async function spawnDetachedLiveRun(input) {
    const runId = `mcp-${randomUUID()}`;
    const outDir = `artifacts/terminal-live/${runId}`;
    const absoluteOutDir = join(getMcpWorkspaceRoot(), outDir);
    const logPath = `${outDir}/detached.runner.log`;
    const absoluteLogPath = join(getMcpWorkspaceRoot(), logPath);
    const args = [...input.args, `--out-dir=${outDir}`];
    const stateDir = detachedLiveRunsDirectory();
    const workspaceIo = llmbLiveWorkspaceIo();
    await workspaceIo.mkdirPathLocked(stateDir, { recursive: true });
    await workspaceIo.mkdirPathLocked(absoluteOutDir, { recursive: true });
    const logSink = await openDetachedAppendSinkTrusted(absoluteLogPath, {
        caller: 'mcp.tools.llm-b-live',
        mode: 0o600,
    });
    /** @type {import('node:child_process').ChildProcess | undefined} */
    let child;
    try {
        child = spawn(process.execPath, [LIVE_RUNNER, ...args], {
            cwd: getMcpWorkspaceRoot(),
            env: process.env,
            detached: true,
            stdio: ['ignore', logSink.handle.fd, logSink.handle.fd],
        });
    } finally {
        await logSink.handle.close();
    }
    if (!child?.pid) throw new Error('Detached LLM-B live harness did not expose a child pid.');
    child.unref();
    /** @type {DetachedLiveRunManifest} */
    const manifest = {
        schema: 'llmb-live-detached-run',
        runId,
        pid: child.pid,
        startedAtMs: Date.now(),
        outDir,
        logPath,
        plan: input.plan,
    };
    await llmbLiveWorkspaceIo().writeFileAtomic(
        detachedLiveRunManifestPath(runId),
        `${JSON.stringify(manifest, null, 2)}\n`,
        {
            encoding: 'utf8',
            mode: 0o600,
            riskClass: 'medium',
            failIfExists: true,
            advisoryLimits: { domain: 'llmb-live-detached-manifest' },
        },
    );
    return manifest;
}

/**
 * @param {string} manifestPath
 * @param {string | null} [expectedRunId]
 */
async function readDetachedLiveRunManifest(manifestPath, expectedRunId = null) {
    try {
        const workspaceIo = llmbLiveWorkspaceIo();
        const stats = (await workspaceIo.statPath(manifestPath)).stats;
        if (!stats.isFile() || stats.size > DETACHED_LIVE_RUN_MANIFEST_MAX_BYTES) return null;
        const parsed = JSON.parse((await workspaceIo.readTextFresh(manifestPath, { includeHash: false })).content);
        if (
            parsed?.schema !== 'llmb-live-detached-run' ||
            typeof parsed.runId !== 'string' ||
            !DETACHED_LIVE_RUN_ID_RE.test(parsed.runId) ||
            (expectedRunId !== null && parsed.runId !== expectedRunId) ||
            !Number.isInteger(parsed.pid) ||
            parsed.pid <= 0 ||
            typeof parsed.startedAtMs !== 'number' ||
            !Number.isFinite(parsed.startedAtMs)
        ) {
            return null;
        }
        const expectedOutDir = `artifacts/terminal-live/${parsed.runId}`;
        const expectedLogPath = `${expectedOutDir}/detached.runner.log`;
        if (parsed.outDir !== expectedOutDir || parsed.logPath !== expectedLogPath) return null;
        return /** @type {DetachedLiveRunManifest} */ (parsed);
    } catch {
        return null;
    }
}

/**
 * @param {{ limit?: number; nowMs?: number }} [options]
 */
async function listDetachedLiveRuns(options = {}) {
    const directory = detachedLiveRunsDirectory();
    const limit = Math.max(1, Math.min(500, Math.trunc(options.limit ?? 20)));
    const nowMs = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
    await llmbLiveWorkspaceIo().mkdirPathLocked(directory, { recursive: true });
    const workspaceIo = llmbLiveWorkspaceIo();
    const entries = await workspaceIo
        .listDirectoryNamesFresh(directory)
        .then((result) => result.entries)
        .catch(() => []);
    const rows = [];
    for (const entry of entries) {
        if (!entry.endsWith('.json')) continue;
        const expectedRunId = entry.slice(0, -'.json'.length);
        if (!DETACHED_LIVE_RUN_ID_RE.test(expectedRunId)) continue;
        const manifest = await readDetachedLiveRunManifest(join(directory, entry), expectedRunId);
        if (!manifest) continue;
        const summaryPath = join(getMcpWorkspaceRoot(), manifest.outDir, 'summary.md');
        const summaryStats = await workspaceIo
            .statPath(summaryPath)
            .then((result) => result.stats)
            .catch(() => null);
        const summaryReady = summaryStats?.isFile() === true;
        const processIdentity = await inspectDetachedLiveRunProcessIdentity(manifest);
        // `kill(pid, 0)` also reports zombies/recycled PIDs as present. On POSIX, only an exact harness command-line
        // match is allowed to count as an actually running detached run. Keep the raw PID-presence bit separately for
        // diagnostics; on Windows retain the legacy liveness fallback because `/proc` identity is unavailable.
        const pidPresent = processIdentity.alive;
        const pidAlive = process.platform === 'win32' ? pidPresent : processIdentity.verified;
        rows.push({
            ...manifest,
            status: summaryReady
                ? pidAlive
                    ? 'artifacts_ready_process_alive'
                    : 'artifacts_ready'
                : pidAlive
                  ? 'running'
                  : pidPresent
                    ? 'stopped_or_unverified_pid'
                    : 'stopped_without_summary',
            pidAlive,
            pidPresent,
            processIdentity: processIdentity.reason,
            summaryReady,
            ageMs: Math.max(0, nowMs - manifest.startedAtMs),
            summaryAgeMs: summaryReady ? Math.max(0, nowMs - Number(summaryStats?.mtimeMs ?? nowMs)) : null,
            summaryPath: summaryReady ? `${manifest.outDir}/summary.md` : null,
        });
    }
    return rows.sort((left, right) => right.startedAtMs - left.startedAtMs).slice(0, limit);
}

const DEFAULT_COMPLETED_LIVE_RUN_REAP_GRACE_MS = 30_000;

/**
 * Reap only harness processes that have already produced their authoritative summary, have remained alive beyond a
 * small cleanup grace period, and still pass the exact process-identity check. The default cancel path re-reads the
 * manifest and re-verifies identity immediately before signaling, so a PID recycled between scan and reap is harmless.
 *
 * @param {{
 *     nowMs?: number;
 *     graceMs?: number;
 *     deps?: {
 *         listRuns?: () => Promise<Record<string, any>[]>;
 *         cancelRun?: (runId: string) => Promise<{ cancelled: boolean; alreadyStopped?: boolean }>;
 *     };
 * }} [options]
 */
export async function reapCompletedDetachedLiveRuns(options = {}) {
    const nowMs = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
    const graceMs = Math.max(
        5_000,
        Math.min(10 * 60_000, Math.trunc(options.graceMs ?? DEFAULT_COMPLETED_LIVE_RUN_REAP_GRACE_MS)),
    );
    const listRuns = options.deps?.listRuns ?? (() => listDetachedLiveRuns({ limit: 500, nowMs }));
    const cancelRun =
        options.deps?.cancelRun ??
        (async (runId) => {
            const manifest = await readDetachedLiveRunManifest(detachedLiveRunManifestPath(runId), runId);
            if (!manifest) return { cancelled: false, alreadyStopped: true };
            const result = await cancelDetachedLiveRun(manifest);
            if (result.cancelled) {
                await appendMcpAuditEvent({
                    event: 'llmb_live_test_completed_process_reaped',
                    tool: 'mcp_startup_maintenance',
                    runId,
                    pid: manifest.pid,
                    outDir: manifest.outDir,
                });
            }
            return result;
        });
    const rows = await listRuns();
    const candidates = rows.filter(
        (row) =>
            row?.['status'] === 'artifacts_ready_process_alive' &&
            row?.['processIdentity'] === 'verified' &&
            typeof row?.['summaryAgeMs'] === 'number' &&
            row['summaryAgeMs'] >= graceMs,
    );
    const reapedRunIds = [];
    const failures = [];
    for (const row of candidates) {
        const runId = typeof row?.runId === 'string' ? row.runId : '';
        if (!DETACHED_LIVE_RUN_ID_RE.test(runId)) continue;
        try {
            const result = await cancelRun(runId);
            if (result.cancelled) reapedRunIds.push(runId);
        } catch (error) {
            failures.push({ runId, error: error instanceof Error ? error.message : String(error) });
        }
    }
    return {
        scannedCount: rows.length,
        candidateCount: candidates.length,
        reapedCount: reapedRunIds.length,
        reapedRunIds,
        failureCount: failures.length,
        failures,
        graceMs,
    };
}

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

/** @param {string} filePath */
async function readinessFileFingerprint(filePath) {
    try {
        const info = (await statPathTrusted(filePath, { caller: 'mcp.tools.llm-b-live' })).stats;
        return `${info.size}:${Math.trunc(info.mtimeMs)}`;
    } catch (error) {
        const code = /** @type {NodeJS.ErrnoException} */ (error)?.code;
        return code === 'ENOENT' ? 'missing' : `error:${code ?? 'unknown'}`;
    }
}

/** @param {string} root */
function readinessHealthPath(root) {
    const configured = process.env['TERMINAL_BYOK_PROVIDER_HEALTH_PATH'];
    if (typeof configured !== 'string' || !configured.trim()) {
        return join(root, 'data', 'copilot-terminal', 'byok-provider-health.json');
    }
    return isAbsolute(configured) ? configured : resolve(root, configured);
}

function modelGatewaySqliteFingerprint() {
    try {
        const db = getCopilotDb();
        const active = /** @type {{ generated_at_ms?: number | null; payload_bytes?: number | null } | undefined} */ (
            db
                .prepare(
                    `SELECT generated_at_ms, length(payload_json) AS payload_bytes
                     FROM copilot_model_gateway_snapshots
                     WHERE snapshot_id = 'active'
                     LIMIT 1`,
                )
                .get()
        );
        const runtime = /** @type {{
          probe_runs?: number | null;
          probe_run_max?: number | null;
          probe_results?: number | null;
          probe_result_max?: number | null;
          health_rows?: number | null;
          health_max?: number | null;
      }
    | undefined} */ (
            db
                .prepare(
                    `SELECT
                        (SELECT COUNT(*) FROM copilot_model_gateway_runtime_probe_runs) AS probe_runs,
                        (SELECT MAX(completed_at_ms) FROM copilot_model_gateway_runtime_probe_runs) AS probe_run_max,
                        (SELECT COUNT(*) FROM copilot_model_gateway_runtime_probe_results) AS probe_results,
                        (SELECT MAX(observed_at_ms) FROM copilot_model_gateway_runtime_probe_results) AS probe_result_max,
                        (SELECT COUNT(*) FROM copilot_model_gateway_health_observations) AS health_rows,
                        (SELECT MAX(observed_at_ms) FROM copilot_model_gateway_health_observations) AS health_max`,
                )
                .get()
        );
        const catalogCounts = MODEL_GATEWAY_FINGERPRINT_TABLES.map((table) => {
            const row = /** @type {{ count?: number | null } | undefined} */ (
                db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()
            );
            return Number(row?.count ?? -1);
        });
        return JSON.stringify({
            activeGeneratedAtMs: Number(active?.generated_at_ms ?? 0),
            activePayloadBytes: Number(active?.payload_bytes ?? 0),
            catalogCounts,
            runtime: {
                probeRuns: Number(runtime?.probe_runs ?? 0),
                probeRunMax: Number(runtime?.probe_run_max ?? 0),
                probeResults: Number(runtime?.probe_results ?? 0),
                probeResultMax: Number(runtime?.probe_result_max ?? 0),
                healthRows: Number(runtime?.health_rows ?? 0),
                healthMax: Number(runtime?.health_max ?? 0),
            },
        });
    } catch {
        // Disable reuse rather than risk a stale readiness result when the logical fingerprint cannot be observed.
        return `unavailable:${Date.now()}`;
    }
}

/** @param {boolean} includeSqliteRuntimeHealth */
async function buildLiveReadinessFingerprint(includeSqliteRuntimeHealth) {
    const root = getMcpWorkspaceRoot();
    const [catalogFile, byokHealthFile] = await Promise.all([
        readinessFileFingerprint(join(root, 'data', 'copilot', 'model-gateway', 'catalog.json')),
        readinessFileFingerprint(readinessHealthPath(root)),
    ]);
    const sqliteLogical = modelGatewaySqliteFingerprint();
    return `${includeSqliteRuntimeHealth ? 'sqlite-health' : 'file-health'}:${catalogFile}:${sqliteLogical}:${byokHealthFile}`;
}

/** @type {Promise<
    | ((options?: {
          includeSqliteRuntimeHealth?: boolean;
          reuseRedactionWorkers?: boolean;
      }) => Promise<Record<string, any>>)
    | null
> | null} */
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
        if (now - entry.completedAtMs > LIVE_READINESS_CACHE_TTL_MS) liveReadinessCache.delete(key);
    }
    while (liveReadinessCache.size > LIVE_READINESS_CACHE_MAX_ENTRIES) {
        const oldestKey = liveReadinessCache.keys().next().value;
        if (typeof oldestKey !== 'string') break;
        liveReadinessCache.delete(oldestKey);
    }
}

/** @param {boolean} includeSqliteRuntimeHealth @returns {Promise<LiveReadinessExecution>} */
async function executeLiveReadiness(includeSqliteRuntimeHealth) {
    const fingerprint = await buildLiveReadinessFingerprint(includeSqliteRuntimeHealth);
    const key = fingerprint;
    const now = Date.now();
    pruneLiveReadinessCache();
    const cached = liveReadinessCache.get(key);
    if (cached && now - cached.completedAtMs <= LIVE_READINESS_CACHE_TTL_MS) {
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
            try {
                parsed = await builder({ includeSqliteRuntimeHealth, reuseRedactionWorkers: true });
            } catch (builderError) {
                error = builderError instanceof Error ? builderError.message : String(builderError);
            }
        } else {
            execution = 'fallback-subprocess';
            const args = ['--json'];
            if (includeSqliteRuntimeHealth) args.push('--sqlite-runtime-health');
            const result = await execFixedNodeScript(LIVE_READINESS, args, 120_000);
            const parsedValue = parseJsonOutput(result.stdout);
            parsed =
                parsedValue && typeof parsedValue === 'object' && !Array.isArray(parsedValue)
                    ? /** @type {Record<string, any>} */ (parsedValue)
                    : null;
            stderr = result.stderr;
            stdout = result.stdout;
            error = result.error ?? null;
        }
        const durationMs = Number((performance.now() - startedAt).toFixed(3));
        const completedAtMs = Date.now();
        const success = parsed !== null && error === null;
        if (success && parsed) {
            const completedFingerprint = await buildLiveReadinessFingerprint(includeSqliteRuntimeHealth);
            liveReadinessCache.set(completedFingerprint, { parsed, completedAtMs, durationMs });
            pruneLiveReadinessCache();
        }
        return {
            success,
            parsed,
            stderr,
            stdout,
            error,
            execution,
            cacheAgeMs: 0,
            durationMs,
        };
    })();
    liveReadinessInFlight.set(key, promise);
    try {
        return await promise;
    } finally {
        if (liveReadinessInFlight.get(key) === promise) liveReadinessInFlight.delete(key);
    }
}

/** @param {string} value @param {string} field */
function validateProfile(value, field) {
    if (!PROFILE_RE.test(value)) throw new Error(`${field} contains unsupported characters.`);
    return value;
}

/**
 * @param {{
 *     mode:
 *         | 'control-only'
 *         | 'dry-run'
 *         | 'canonical-turn'
 *         | 'byok-fixture-control'
 *         | 'byok-real-control'
 *         | 'byok-real-turn';
 *     scenario: string;
 *     transport: 'pty' | 'stdio';
 *     timeoutMs: number;
 *     byokProfile?: string;
 *     routeProfile?: string;
 *     selectionPolicy?: 'metadata_first' | 'prefer_runtime_proved' | 'require_runtime_proof';
 * }} input
 */
function buildLiveRunPlan(input) {
    const requestedScenario = input.scenario;
    const adaptiveModelGatewayTurn =
        (input.mode === 'byok-real-turn' || input.mode === 'canonical-turn') &&
        requestedScenario === 'model-gateway-tools-apply-safe';
    const resolvedScenario = adaptiveModelGatewayTurn ? 'model-gateway-adaptive-probe' : requestedScenario;
    const args = [
        `--live-scenario=${resolvedScenario}`,
        `--transport=${input.transport}`,
        `--timeout-ms=${input.timeoutMs}`,
    ];
    let invokesModel = false;
    let invokesRealProvider = false;
    let executesRuntimeProbes = false;

    if (input.mode === 'dry-run') {
        args.push('--dry-run', '--control-only');
    } else if (input.mode === 'control-only') {
        args.push('--control-only');
    } else if (input.mode === 'canonical-turn') {
        invokesModel = true;
        if (resolvedScenario === 'model-gateway-adaptive-probe') {
            args.push('--model-gateway-control-plane-probes');
            invokesRealProvider = true;
            executesRuntimeProbes = true;
        }
    } else if (input.mode === 'byok-fixture-control') {
        args.push('--byok-probe', '--byok-fixture', '--control-only');
        executesRuntimeProbes = true;
    } else {
        args.push('--byok-real');
        invokesRealProvider = true;
        if (input.byokProfile) args.push(`--byok-real-profile=${validateProfile(input.byokProfile, 'byokProfile')}`);
        if (input.routeProfile) {
            args.push(`--byok-real-route-profile=${validateProfile(input.routeProfile, 'routeProfile')}`);
        }
        if (input.selectionPolicy) args.push(`--byok-real-route-selection-policy=${input.selectionPolicy}`);
        if (input.mode === 'byok-real-control') {
            args.push('--control-only');
            executesRuntimeProbes = true;
        } else {
            invokesModel = true;
            // The live runner automatically performs runtime-selector admission probing before a real LLM-B turn when
            // a route profile is supplied. Keep the MCP plan truthful about provider calls even though no extra flag is needed.
            executesRuntimeProbes = Boolean(input.routeProfile);
        }
    }

    const requiresUsageConfirmation = invokesModel || invokesRealProvider;
    const executionMode =
        resolvedScenario === 'model-gateway-adaptive-probe' &&
        (input.mode === 'byok-real-turn' || input.mode === 'canonical-turn')
            ? 'detached'
            : 'synchronous';
    return {
        script: LIVE_RUNNER,
        args,
        mode: input.mode,
        scenario: resolvedScenario,
        requestedScenario,
        resolvedScenario,
        executionMode,
        invokesModel,
        invokesRealProvider,
        executesRuntimeProbes,
        requiresUsageConfirmation,
        billingNote:
            invokesModel && invokesRealProvider
                ? 'GitHub Copilot AI Credits/token usage and BYOK/provider quota or billing may be consumed.'
                : invokesRealProvider
                  ? 'BYOK/provider quota or billing may be consumed.'
                  : invokesModel
                    ? 'GitHub Copilot AI Credits/token usage may be consumed.'
                    : 'No explicit model turn is requested by this plan.',
    };
}

const commonPlanInput = {
    mode: liveModeSchema.optional()['describe']('Default control-only.'),
    scenario: liveScenarioSchema.optional()['describe']('Default canonical.'),
    transport: transportSchema.optional()['describe']('Default pty for the canonical interactive LLM-B harness.'),
    timeoutMs: z.number().int().min(30_000).max(900_000).optional(),
    byokProfile: z.string().max(120).optional(),
    routeProfile: z.string().max(120).optional(),
    selectionPolicy: selectionPolicySchema.optional(),
};

/** @type {import('../registry.js').McpToolDefinition[]} */
export const llmBLiveTools = [
    {
        name: 'llmb_live_readiness',
        title: 'LLM-B live readiness',
        description:
            'Run the canonical read-only Model Gateway/terminal LLM-B readiness audit. Does not start the terminal or call providers.',
        inputSchema: {
            includeSqliteRuntimeHealth: z.boolean().optional(),
        },
        annotations: readOnlyAnnotations(),
        handler: async ({ includeSqliteRuntimeHealth }) => {
            const execution = await executeLiveReadiness(includeSqliteRuntimeHealth === true);
            if (!execution.success || !execution.parsed) {
                return errorResult(execution.error ?? 'LLM-B live readiness did not return valid JSON.', {
                    code: 'ERR_LLMB_LIVE_READINESS',
                    stderr: execution.stderr,
                    stdoutTail: String(execution.stdout ?? '').slice(-8000),
                });
            }
            const parsed = {
                ...execution.parsed,
                mcpAdapter: {
                    execution: execution.execution,
                    cacheAgeMs: execution.cacheAgeMs,
                    cacheTtlMs: LIVE_READINESS_CACHE_TTL_MS,
                    durationMs: execution.durationMs,
                    subprocessDurationMs: execution.execution === 'fallback-subprocess' ? execution.durationMs : null,
                    invalidation: 'catalog-file+model-gateway-sqlite-logical+byok-health-fingerprint',
                },
            };
            return okResult(parsed, JSON.stringify(parsed, null, 2));
        },
    },
    {
        name: 'llmb_live_runs',
        title: 'LLM-B persisted live runs',
        description:
            'Read persisted Model Gateway terminal live scenario summaries from SQLite. This never calls a provider.',
        inputSchema: {
            limit: z.number().int().min(1).max(100).optional(),
        },
        annotations: readOnlyAnnotations(),
        handler: async ({ limit }) => {
            const result = await execFixedNodeScript(LIVE_RUNS, ['--json', '--limit', String(limit ?? 20)], 60_000);
            const parsed = parseJsonOutput(result.stdout);
            if (!result.success || !parsed) {
                return errorResult(result.error ?? 'LLM-B live runs did not return valid JSON.', {
                    code: 'ERR_LLMB_LIVE_RUNS',
                    stderr: result.stderr,
                    stdoutTail: result.stdout.slice(-8000),
                });
            }
            parsed.detachedRuns = await listDetachedLiveRuns();
            return okResult(parsed, JSON.stringify(parsed, null, 2));
        },
    },
    {
        name: 'llmb_live_test_cancel',
        title: 'Cancel detached LLM-B live test',
        description:
            'Cancel one allowlisted detached LLM-B live harness by its strict run id after verifying the manifest pid still belongs to that exact harness.',
        inputSchema: {
            runId: z.string()['regex'](DETACHED_LIVE_RUN_ID_RE),
        },
        annotations: destructiveAnnotations(),
        handler: async ({ runId }) => {
            try {
                const manifest = await readDetachedLiveRunManifest(detachedLiveRunManifestPath(runId), runId);
                if (!manifest) {
                    return errorResult('Detached LLM-B live run manifest was not found or is invalid.', {
                        code: 'ERR_LLMB_LIVE_CANCEL_NOT_FOUND',
                        runId,
                    });
                }
                const summaryPath = join(getMcpWorkspaceRoot(), manifest.outDir, 'summary.md');
                const summaryReady = await llmbLiveWorkspaceIo()
                    .statPath(summaryPath)
                    .then((result) => result.stats.isFile())
                    .catch(() => false);
                if (summaryReady) {
                    const processIdentity = await inspectDetachedLiveRunProcessIdentity(manifest);
                    if (!processIdentity.verified) {
                        const structured = {
                            success: true,
                            runId,
                            cancelled: false,
                            alreadyCompleted: true,
                            pid: manifest.pid,
                            outDir: manifest.outDir,
                            processIdentity: processIdentity.reason,
                            summaryPath: `${manifest.outDir}/summary.md`,
                        };
                        return okResult(structured, JSON.stringify(structured, null, 2));
                    }
                    // A summary is authoritative for result persistence, but a verified harness process can still be
                    // stranded afterward (for example while a PTY descendant refuses to close). Explicit cancellation
                    // should be able to reap that verified leftover instead of returning a misleading no-op.
                    const cancellation = await cancelDetachedLiveRun(manifest);
                    await appendMcpAuditEvent({
                        event: 'llmb_live_test_completed_process_cancelled',
                        tool: 'llmb_live_test_cancel',
                        runId,
                        pid: manifest.pid,
                        outDir: manifest.outDir,
                    });
                    const structured = {
                        success: true,
                        runId,
                        cancelled: cancellation.cancelled,
                        alreadyCompleted: true,
                        lingeringCompletedProcess: true,
                        pid: manifest.pid,
                        outDir: manifest.outDir,
                        processIdentity: cancellation.identity.reason,
                        summaryPath: `${manifest.outDir}/summary.md`,
                    };
                    return okResult(structured, JSON.stringify(structured, null, 2));
                }
                const cancellation = await cancelDetachedLiveRun(manifest);
                await appendMcpAuditEvent({
                    event: cancellation.cancelled
                        ? 'llmb_live_test_detached_cancelled'
                        : 'llmb_live_test_detached_already_stopped',
                    tool: 'llmb_live_test_cancel',
                    runId,
                    pid: manifest.pid,
                    outDir: manifest.outDir,
                });
                const structured = {
                    success: true,
                    runId,
                    cancelled: cancellation.cancelled,
                    alreadyStopped: cancellation.alreadyStopped,
                    pid: manifest.pid,
                    outDir: manifest.outDir,
                    processIdentity: cancellation.identity.reason,
                };
                return okResult(structured, JSON.stringify(structured, null, 2));
            } catch (error) {
                const code =
                    typeof error === 'object' && error !== null && typeof (/** @type {any} */ (error).code) === 'string'
                        ? /** @type {any} */ (error).code
                        : 'ERR_LLMB_LIVE_CANCEL';
                return errorResult(error instanceof Error ? error.message : String(error), { code, runId });
            }
        },
    },
    {
        name: 'llmb_live_test_plan',
        title: 'Plan canonical LLM-B live test',
        description:
            'Build an allowlisted live harness invocation and state whether it can consume GitHub Copilot AI Credits or BYOK/provider quota.',
        inputSchema: commonPlanInput,
        annotations: readOnlyAnnotations(),
        handler: async ({ mode, scenario, transport, timeoutMs, byokProfile, routeProfile, selectionPolicy }) => {
            try {
                const plan = buildLiveRunPlan({
                    mode: mode ?? 'control-only',
                    scenario: scenario ?? 'canonical',
                    transport: transport ?? 'pty',
                    timeoutMs: timeoutMs ?? 180_000,
                    ...(byokProfile ? { byokProfile } : {}),
                    ...(routeProfile ? { routeProfile } : {}),
                    ...(selectionPolicy ? { selectionPolicy } : {}),
                });
                return okResult({ success: true, ...plan }, JSON.stringify(plan, null, 2));
            } catch (error) {
                return errorResult(error instanceof Error ? error.message : String(error), {
                    code: 'ERR_LLMB_LIVE_PLAN',
                });
            }
        },
    },
    {
        name: 'llmb_live_test_run',
        title: 'Run canonical LLM-B live test',
        description:
            'Run the fixed canonical LLM-B live harness. Defaults to control-only; real model/provider usage requires confirmModelUsage=true.',
        inputSchema: {
            ...commonPlanInput,
            confirmModelUsage: z
                .boolean()
                .optional()
                ['describe']('Required when the plan can invoke a model or real BYOK/provider.'),
        },
        annotations: { ...boundedWriteAnnotations(), openWorldHint: true },
        handler: async ({
            mode,
            scenario,
            transport,
            timeoutMs,
            byokProfile,
            routeProfile,
            selectionPolicy,
            confirmModelUsage,
        }) => {
            try {
                const effectiveMode = mode ?? 'control-only';
                const effectiveTimeoutMs = timeoutMs ?? (effectiveMode.includes('turn') ? 600_000 : 180_000);
                const plan = buildLiveRunPlan({
                    mode: effectiveMode,
                    scenario: scenario ?? 'canonical',
                    transport: transport ?? 'pty',
                    timeoutMs: effectiveTimeoutMs,
                    ...(byokProfile ? { byokProfile } : {}),
                    ...(routeProfile ? { routeProfile } : {}),
                    ...(selectionPolicy ? { selectionPolicy } : {}),
                });
                if (plan.requiresUsageConfirmation && confirmModelUsage !== true) {
                    return errorResult(
                        'This LLM-B live plan may consume AI Credits/provider quota; rerun with confirmModelUsage=true after reviewing llmb_live_test_plan.',
                        {
                            code: 'ERR_LLMB_MODEL_USAGE_CONFIRMATION_REQUIRED',
                            plan,
                        },
                    );
                }
                if (plan.executionMode === 'detached') {
                    const manifest = await spawnDetachedLiveRun({
                        args: plan.args,
                        plan,
                        timeoutMs: effectiveTimeoutMs,
                    });
                    await appendMcpAuditEvent({
                        event: 'llmb_live_test_detached_started',
                        tool: 'llmb_live_test_run',
                        runId: manifest.runId,
                        mode: plan.mode,
                        scenario: plan.scenario,
                        invokesModel: plan.invokesModel,
                        invokesRealProvider: plan.invokesRealProvider,
                    });
                    const structured = {
                        success: true,
                        accepted: true,
                        detached: true,
                        runId: manifest.runId,
                        pid: manifest.pid,
                        outDir: manifest.outDir,
                        logPath: manifest.logPath,
                        plan,
                        next: 'Use llmb_live_runs to inspect detachedRuns and the persisted SQLite result; do not start a duplicate provider run while status=running.',
                    };
                    return okResult(structured, JSON.stringify(structured, null, 2));
                }
                const runId = `mcp-${Date.now().toString(36)}`;
                const outDir = `artifacts/terminal-live/${runId}`;
                const args = [...plan.args, `--out-dir=${outDir}`];
                await appendMcpAuditEvent({
                    event: 'llmb_live_test_started',
                    tool: 'llmb_live_test_run',
                    runId,
                    mode: plan.mode,
                    scenario: plan.scenario,
                    invokesModel: plan.invokesModel,
                    invokesRealProvider: plan.invokesRealProvider,
                });
                const result = await execFixedNodeScript(LIVE_RUNNER, args, effectiveTimeoutMs + 30_000);
                await appendMcpAuditEvent({
                    event: result.success ? 'llmb_live_test_completed' : 'llmb_live_test_failed',
                    tool: 'llmb_live_test_run',
                    runId,
                    mode: plan.mode,
                    scenario: plan.scenario,
                    exitCode: result.exitCode,
                });
                const structured = {
                    success: result.success,
                    runId,
                    outDir,
                    plan,
                    exitCode: result.exitCode,
                    stdout: result.stdout,
                    stderr: result.stderr,
                    error: result.error ?? null,
                };
                if (!result.success)
                    return errorResult(result.error ?? 'LLM-B live harness failed.', {
                        code: 'ERR_LLMB_LIVE_RUN_FAILED',
                        ...structured,
                    });
                return okResult(structured, result.stdout.slice(-16000) || `LLM-B live run ${runId} completed.`);
            } catch (error) {
                return errorResult(error instanceof Error ? error.message : String(error), {
                    code: 'ERR_LLMB_LIVE_RUN',
                });
            }
        },
    },
];
