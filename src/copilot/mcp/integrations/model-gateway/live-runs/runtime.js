// @ts-check
/**
 * Governed Model Gateway / LLM-B live-run process and manifest lifecycle.
 *
 * This owner is the only MCP boundary allowed to spawn the fixed live/readiness/runs scripts. It applies explicit
 * environment authority, observes attached children through physical `close`, owns detached manifests and verifies
 * process identity before cancellation/reaping.
 *
 * @module copilot/mcp/integrations/model-gateway/live-runs/runtime
 */

import { readLinuxProcessArgv } from '#copilot/infra/public/platform/process/introspection';
import { createAttachedChildProcessSupervisor, signalProcessTree } from '#copilot/mcp/public/process/supervision';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { MODEL_GATEWAY_LIVE_COMMANDS, MODEL_GATEWAY_LIVE_RUNNER_SCRIPT } from './contracts.js';

const DETACHED_LIVE_RUNS_DIR = 'src/copilot/.ai/mcp/llmb-live-runs';
export const DETACHED_LIVE_RUN_ID_RE = /^mcp-[0-9a-f-]{36}$/u;
const DETACHED_LIVE_RUN_MANIFEST_MAX_BYTES = 128 * 1024;
const DEFAULT_COMPLETED_LIVE_RUN_REAP_GRACE_MS = 30_000;
const DEFAULT_LIVE_COMMAND_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

/** @type {Map<string, { created:number; terminated:number; current:number; cancelled:number; timedOut:number; outputLimited:number; abnormalExit:number }>} */
const liveCommandLifecycleByCommand = new Map();

/** @param {string} command */
function liveCommandLifecycleState(command) {
    let state = liveCommandLifecycleByCommand.get(command);
    if (state) return state;
    state = { created: 0, terminated: 0, current: 0, cancelled: 0, timedOut: 0, outputLimited: 0, abnormalExit: 0 };
    liveCommandLifecycleByCommand.set(command, state);
    return state;
}

export function readModelGatewayLiveCommandLifecycleForTests() {
    return Object.freeze(
        Object.fromEntries(
            [...liveCommandLifecycleByCommand.entries()].map(([command, state]) => [
                command,
                Object.freeze({ ...state }),
            ]),
        ),
    );
}

export function resetModelGatewayLiveCommandLifecycleForTests() {
    liveCommandLifecycleByCommand.clear();
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

/** @param {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} workspace */
function detachedLiveRunsDirectory(workspace) {
    return join(workspace.workspaceRoot, DETACHED_LIVE_RUNS_DIR);
}

/** @param {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} workspace @param {string} runId */
export function detachedLiveRunManifestPath(workspace, runId) {
    if (!DETACHED_LIVE_RUN_ID_RE.test(runId)) throw new Error('Invalid detached LLM-B live run id.');
    return join(detachedLiveRunsDirectory(workspace), `${runId}.json`);
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

/** @param {DetachedLiveRunManifest} manifest */
export async function inspectDetachedLiveRunProcessIdentity(manifest) {
    if (!isProcessAlive(manifest.pid)) {
        return { alive: false, verified: false, reason: 'process-not-alive', argv: [] };
    }
    if (process.platform !== 'linux') {
        return {
            alive: true,
            verified: false,
            reason: `process-identity-unavailable-on-${process.platform}`,
            argv: [],
        };
    }
    try {
        const processIdentity = await readLinuxProcessArgv(manifest.pid);
        if (processIdentity.truncated) {
            return { alive: true, verified: false, reason: 'process-command-line-truncated', argv: [] };
        }
        const argv = [...processIdentity.argv];
        const expectedOutDirArg = `--out-dir=${manifest.outDir}`;
        const runnerMatch = argv.some(
            (arg) => arg === MODEL_GATEWAY_LIVE_RUNNER_SCRIPT || arg.endsWith(`/${MODEL_GATEWAY_LIVE_RUNNER_SCRIPT}`),
        );
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
export async function cancelDetachedLiveRun(manifest) {
    const identity = await inspectDetachedLiveRunProcessIdentity(manifest);
    if (!identity.alive) return { cancelled: false, alreadyStopped: true, identity };
    if (!identity.verified) {
        throw Object.assign(
            new Error(`Detached LLM-B live run process identity could not be verified (${identity.reason}).`),
            { code: 'ERR_LLMB_LIVE_CANCEL_IDENTITY_MISMATCH' },
        );
    }
    const delivered = signalProcessTree(manifest.pid, 'SIGTERM', { processGroup: true });
    if (!delivered) {
        const stillAlive = isProcessAlive(manifest.pid);
        if (stillAlive) throw new Error('Failed to signal verified detached LLM-B live run process tree.');
        return { cancelled: false, alreadyStopped: true, identity };
    }
    return { cancelled: true, alreadyStopped: false, identity };
}

/** @param {string} current @param {unknown} chunk @param {number} maxBytes */
function appendBoundedOutput(current, chunk, maxBytes) {
    const previous = Buffer.from(current, 'utf8');
    const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk ?? ''), 'utf8');
    if (previous.length + incoming.length <= maxBytes) return Buffer.concat([previous, incoming]).toString('utf8');
    const combined = Buffer.concat([previous, incoming]);
    return combined.subarray(Math.max(0, combined.length - maxBytes)).toString('utf8');
}

/**
 * Execute one fixed Model Gateway live command under explicit environment authority and truthful child supervision.
 * The promise resolves only after Node observes the child `close` event. Caller abort, timeout and output pressure request
 * termination of the whole POSIX process group and are reflected in the returned result.
 *
 * @param {{
 *     workspace: import('#copilot/mcp/public/workspace').McpWorkspaceCapability;
 *     command: import('./contracts.js').ModelGatewayLiveCommand;
 *     args: string[];
 *     timeoutMs: number;
 *     plan?: { invokesModel?: boolean; invokesRealProvider?: boolean };
 *     signal?: AbortSignal;
 *     environmentAuthority: import('./environment.js').ModelGatewayLiveRunEnvironmentAuthority;
 *     maxOutputBytes?: number;
 * }} input
 */
export async function runModelGatewayLiveCommand(input) {
    const script = MODEL_GATEWAY_LIVE_COMMANDS[input.command];
    if (!script) throw new Error(`Unsupported Model Gateway live command: ${String(input.command)}`);
    if (input.command === 'live-runner' && !input.plan) {
        throw new TypeError('Model Gateway live runner execution requires an explicit plan.');
    }
    const maxOutputBytes = Math.max(
        64 * 1024,
        Math.min(16 * 1024 * 1024, Math.trunc(input.maxOutputBytes ?? DEFAULT_LIVE_COMMAND_MAX_OUTPUT_BYTES)),
    );
    const timeoutMs = Math.max(1_000, Math.min(30 * 60_000, Math.trunc(input.timeoutMs)));
    if (!input.environmentAuthority) {
        throw new TypeError('Model Gateway live command requires an explicit environment authority.');
    }
    const env =
        input.command === 'live-runner'
            ? input.environmentAuthority.liveRunEnvironment(input.plan ?? {})
            : input.command === 'readiness'
              ? input.environmentAuthority.readinessEnvironment()
              : input.environmentAuthority.readOnlyEnvironment();
    const lifecycle = liveCommandLifecycleState(input.command);
    lifecycle.created += 1;
    lifecycle.current += 1;
    const startedAt = performance.now();
    const child = spawn(process.execPath, [script, ...input.args], {
        cwd: input.workspace.workspaceRoot,
        env,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const spawnReturnMs = Number((performance.now() - startedAt).toFixed(3));
    const supervisor = createAttachedChildProcessSupervisor(child, { processGroup: process.platform !== 'win32' });
    let stdout = '';
    let stderr = '';
    let stdoutBytesObserved = 0;
    let stderrBytesObserved = 0;
    let outputLimitExceeded = false;
    let timedOut = false;
    let aborted = false;
    /** @type {number | null} */
    let firstStdoutMs = null;
    /** @type {number | null} */
    let lastStdoutMs = null;
    /** @type {number | null} */
    let firstStderrMs = null;
    /** @type {number | null} */
    let lastStderrMs = null;
    /** @type {string | null} */
    let spawnErrorMessage = null;

    const requestPressureTermination = () => {
        if (outputLimitExceeded) return;
        outputLimitExceeded = true;
        supervisor.requestTermination({ graceMs: 500 });
    };
    child.stdout?.on('data', (chunk) => {
        const observedAtMs = Number((performance.now() - startedAt).toFixed(3));
        if (firstStdoutMs === null) firstStdoutMs = observedAtMs;
        lastStdoutMs = observedAtMs;
        const bytes = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk ?? ''), 'utf8');
        stdoutBytesObserved += bytes;
        stdout = appendBoundedOutput(stdout, chunk, maxOutputBytes);
        if (stdoutBytesObserved + stderrBytesObserved > maxOutputBytes) requestPressureTermination();
    });
    child.stderr?.on('data', (chunk) => {
        const observedAtMs = Number((performance.now() - startedAt).toFixed(3));
        if (firstStderrMs === null) firstStderrMs = observedAtMs;
        lastStderrMs = observedAtMs;
        const bytes = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk ?? ''), 'utf8');
        stderrBytesObserved += bytes;
        stderr = appendBoundedOutput(stderr, chunk, maxOutputBytes);
        if (stdoutBytesObserved + stderrBytesObserved > maxOutputBytes) requestPressureTermination();
    });
    child.once('error', (error) => {
        spawnErrorMessage = error.message;
    });

    // Readiness owns synchronous better-sqlite3 work. Worker-thread termination cannot preempt a native SQLite call, so
    // its process boundary escalates immediately to SIGKILL after SIGTERM. Other live commands retain a graceful drain.
    const terminationGraceMs = input.command === 'readiness' ? 0 : 1_000;
    const timeoutTimer = setTimeout(() => {
        timedOut = true;
        supervisor.requestTermination({ graceMs: terminationGraceMs });
    }, timeoutMs);
    timeoutTimer.unref();

    const abortSignal = input.signal;
    const onAbort = () => {
        aborted = true;
        supervisor.requestTermination({ graceMs: terminationGraceMs });
    };
    if (abortSignal?.aborted) onAbort();
    else abortSignal?.addEventListener('abort', onAbort, { once: true });

    const observation = await supervisor.closed;
    const closeMs = Number((performance.now() - startedAt).toFixed(3));
    clearTimeout(timeoutTimer);
    abortSignal?.removeEventListener('abort', onAbort);
    lifecycle.current = Math.max(0, lifecycle.current - 1);
    lifecycle.terminated += 1;
    if (aborted) lifecycle.cancelled += 1;
    if (timedOut) lifecycle.timedOut += 1;
    if (outputLimitExceeded) lifecycle.outputLimited += 1;
    if (
        !aborted &&
        !timedOut &&
        !outputLimitExceeded &&
        (spawnErrorMessage !== null || observation.signal !== null || observation.exitCode !== 0)
    ) {
        lifecycle.abnormalExit += 1;
    }
    const error = spawnErrorMessage
        ? spawnErrorMessage
        : aborted
          ? 'Model Gateway live command aborted.'
          : timedOut
            ? `Model Gateway live command timed out after ${timeoutMs}ms.`
            : outputLimitExceeded
              ? `Model Gateway live command exceeded ${maxOutputBytes} output bytes.`
              : observation.exitCode === 0
                ? null
                : observation.signal
                  ? `Model Gateway live command terminated by ${observation.signal}.`
                  : `Model Gateway live command exited with code ${String(observation.exitCode)}.`;

    return {
        success: error === null,
        stdout,
        stderr,
        exitCode: observation.exitCode,
        signal: observation.signal,
        timedOut,
        aborted,
        outputLimitExceeded,
        stdoutBytesObserved,
        stderrBytesObserved,
        durationMs: closeMs,
        processTiming: {
            spawnReturnMs,
            firstStdoutMs,
            lastStdoutMs,
            firstStderrMs,
            lastStderrMs,
            closeMs,
            closeTailMs: Number((closeMs - (lastStdoutMs ?? lastStderrMs ?? closeMs)).toFixed(3)),
        },
        error,
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
        if (start < 0 || end <= start) return null;
        try {
            return JSON.parse(trimmed.slice(start, end + 1));
        } catch {
            return null;
        }
    }
}

/**
 * Execute canonical readiness in a call-scoped subprocess. This boundary is intentionally a process rather than a
 * Worker thread because synchronous better-sqlite3 native calls are not reliably preempted by Worker.terminate().
 *
 * @param {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} workspace
 * @param {boolean} includeSqliteRuntimeHealth
 * @param {{
 *     signal?: AbortSignal;
 *     environmentAuthority: import('./environment.js').ModelGatewayLiveRunEnvironmentAuthority;
 *     redactionProof?: Record<string, unknown> | null;
 *     redactionProofContextId?: string | null;
 *     diagnostics?: boolean;
 * }} options
 */
export async function runModelGatewayLiveReadinessProcess(workspace, includeSqliteRuntimeHealth, options) {
    if (!options?.environmentAuthority) {
        throw new TypeError('Model Gateway readiness process requires an explicit environment authority.');
    }
    const args = ['--json'];
    if (includeSqliteRuntimeHealth) args.push('--sqlite-runtime-health');
    if (options.diagnostics === true) args.push('--diagnostics');
    const redactionProofContextId = String(options.redactionProofContextId ?? '').trim();
    if (redactionProofContextId) args.push(`--redaction-proof-context-id=${redactionProofContextId}`);
    if (options.redactionProof) {
        if (!redactionProofContextId) {
            throw new TypeError('Model Gateway redaction proof transport requires a proof context id.');
        }
        const serializedProof = JSON.stringify(options.redactionProof);
        const proofBytes = Buffer.byteLength(serializedProof, 'utf8');
        if (proofBytes > 64 * 1024) {
            throw new RangeError(
                `Model Gateway redaction proof exceeds 64 KiB transport budget (${proofBytes} bytes).`,
            );
        }
        args.push(`--redaction-proof-base64=${Buffer.from(serializedProof, 'utf8').toString('base64url')}`);
    }
    const result = await runModelGatewayLiveCommand({
        workspace,
        command: 'readiness',
        args,
        timeoutMs: 60_000,
        maxOutputBytes: 1024 * 1024,
        environmentAuthority: options.environmentAuthority,
        ...(options.signal ? { signal: options.signal } : {}),
    });
    const parseStartedAt = performance.now();
    const parsedValue = parseJsonOutput(result.stdout);
    const parseJsonMs = Number((performance.now() - parseStartedAt).toFixed(3));
    const parsed =
        parsedValue && typeof parsedValue === 'object' && !Array.isArray(parsedValue)
            ? /** @type {Record<string, any>} */ (parsedValue)
            : null;
    if (!result.success || !parsed) {
        return {
            ...result,
            success: false,
            parsed: null,
            error: result.error ?? 'LLM-B live readiness did not return valid JSON.',
        };
    }
    const domainDurationMs = Number(parsed?.['timing']?.['totalMs'] ?? 0);
    return {
        ...result,
        success: true,
        parsed,
        readinessTiming: {
            parseJsonMs,
            domainDurationMs,
            processMinusDomainMs: Number(Math.max(0, result.durationMs - domainDurationMs).toFixed(3)),
            processDiagnostics:
                parsed?.['processDiagnostics'] && typeof parsed['processDiagnostics'] === 'object'
                    ? parsed['processDiagnostics']
                    : null,
        },
        error: null,
    };
}

/**
 * Read persisted live-run summaries through the fixed read-only command and merge detached manifest state.
 *
 * @param {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} workspace
 * @param {number} limit
 * @param {{ signal?: AbortSignal; environmentAuthority: import('./environment.js').ModelGatewayLiveRunEnvironmentAuthority }} options
 */
export async function readModelGatewayPersistedLiveRuns(workspace, limit, options) {
    if (!options?.environmentAuthority) {
        throw new TypeError('Reading Model Gateway live runs requires an explicit environment authority.');
    }
    const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    const result = await runModelGatewayLiveCommand({
        workspace,
        command: 'runs',
        args: ['--json', '--limit', String(boundedLimit)],
        timeoutMs: 60_000,
        environmentAuthority: options.environmentAuthority,
        ...(options.signal ? { signal: options.signal } : {}),
    });
    const parsedValue = parseJsonOutput(result.stdout);
    const parsed =
        parsedValue && typeof parsedValue === 'object' && !Array.isArray(parsedValue)
            ? /** @type {Record<string, any>} */ (parsedValue)
            : null;
    if (!result.success || !parsed) {
        return {
            ...result,
            success: false,
            parsed: null,
            error: result.error ?? 'LLM-B live runs did not return valid JSON.',
        };
    }
    parsed['detachedRuns'] = await listDetachedLiveRuns(workspace);
    return { ...result, success: true, parsed, error: null };
}

/**
 * @param {{ workspace: import('#copilot/mcp/public/workspace').McpWorkspaceCapability; args: string[]; plan: Record<string, unknown>; timeoutMs: number; signal?: AbortSignal; environmentAuthority: import('./environment.js').ModelGatewayLiveRunEnvironmentAuthority }} input
 * @returns {Promise<DetachedLiveRunManifest>}
 */
export async function spawnDetachedLiveRun(input) {
    return await spawnDetachedLiveRunWithDependencies(input, {});
}

/**
 * White-box dependency seam for detached acceptance/cancellation lifecycle tests.
 *
 * Acceptance is deliberately later than `spawn`: the manifest must be durable and the caller still active. Before
 * that point any abort or persistence failure terminates and drains the child tree and removes a partial manifest.
 *
 * @param {{ workspace: import('#copilot/mcp/public/workspace').McpWorkspaceCapability; args: string[]; plan: Record<string, unknown>; timeoutMs: number; signal?: AbortSignal; environmentAuthority: import('./environment.js').ModelGatewayLiveRunEnvironmentAuthority }} input
 * @param {{ spawnChild?: typeof spawn; createRunUuid?: () => string }} dependencies
 * @returns {Promise<DetachedLiveRunManifest>}
 */
export async function spawnDetachedLiveRunWithDependencies(input, dependencies) {
    const { workspace } = input;
    const runId = `mcp-${dependencies.createRunUuid?.() ?? randomUUID()}`;
    if (!DETACHED_LIVE_RUN_ID_RE.test(runId)) throw new Error('Generated detached LLM-B live run id is invalid.');
    const outDir = `artifacts/terminal-live/${runId}`;
    const absoluteOutDir = join(workspace.workspaceRoot, outDir);
    const logPath = `${outDir}/detached.runner.log`;
    const absoluteLogPath = join(workspace.workspaceRoot, logPath);
    const args = [...input.args, `--out-dir=${outDir}`];
    const stateDir = detachedLiveRunsDirectory(workspace);
    const manifestPath = detachedLiveRunManifestPath(workspace, runId);
    const workspaceIo = workspace.io;
    if (input.signal?.aborted) throw input.signal.reason ?? new Error('Detached LLM-B live run aborted before spawn.');
    await workspaceIo.mkdirPathLocked(stateDir, { recursive: true });
    await workspaceIo.mkdirPathLocked(absoluteOutDir, { recursive: true });
    const logSink = await workspaceIo.openDetachedAppendSink(absoluteLogPath, { mode: 0o600 });
    if (!input.environmentAuthority) {
        await logSink.handle.close();
        throw new TypeError('Detached Model Gateway live run requires an explicit environment authority.');
    }
    if (input.signal?.aborted) {
        await logSink.handle.close();
        throw input.signal.reason ?? new Error('Detached LLM-B live run aborted before spawn.');
    }
    const env = input.environmentAuthority.liveRunEnvironment(input.plan);
    const spawnChild = dependencies.spawnChild ?? spawn;
    /** @type {import('node:child_process').ChildProcess | undefined} */
    let child;
    /** @type {ReturnType<typeof createAttachedChildProcessSupervisor> | null} */
    let supervisor = null;
    let accepted = false;
    let manifestPublished = false;
    /** @type {(() => void) | null} */
    let terminateBeforeAcceptance = null;
    try {
        child = spawnChild(process.execPath, [MODEL_GATEWAY_LIVE_RUNNER_SCRIPT, ...args], {
            cwd: workspace.workspaceRoot,
            env,
            detached: true,
            stdio: ['ignore', logSink.handle.fd, logSink.handle.fd],
        });
        supervisor = createAttachedChildProcessSupervisor(child, { processGroup: true });
        terminateBeforeAcceptance = () => {
            if (accepted || !supervisor || supervisor.snapshot().state === 'closed') return;
            supervisor.requestTermination({ graceMs: 1_000, initialSignal: 'SIGTERM', forceSignal: 'SIGKILL' });
        };
        input.signal?.addEventListener('abort', terminateBeforeAcceptance, { once: true });
        await new Promise((resolvePromise, rejectPromise) => {
            /** @param {Error} error */
            const onError = (error) => rejectPromise(error);
            child?.once('error', onError);
            child?.once('spawn', () => {
                child?.off('error', onError);
                child?.on('error', () => {});
                resolvePromise(undefined);
            });
        });
        if (!child.pid) throw new Error('Detached LLM-B live harness did not expose a child pid.');
        if (input.signal?.aborted) {
            terminateBeforeAcceptance();
            await supervisor.closed;
            throw input.signal.reason ?? new Error('Detached LLM-B live run aborted during spawn.');
        }
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
        await workspaceIo.writeFileAtomic(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
            encoding: 'utf8',
            mode: 0o600,
            riskClass: 'medium',
            failIfExists: true,
            advisoryLimits: { domain: 'llmb-live-detached-manifest' },
        });
        manifestPublished = true;
        if (input.signal?.aborted) {
            await workspaceIo.deleteFileLocked(manifestPath, { captureRollback: false });
            manifestPublished = false;
            terminateBeforeAcceptance();
            await supervisor.closed;
            throw input.signal.reason ?? new Error('Detached LLM-B live run aborted before manifest acceptance.');
        }
        accepted = true;
        child.unref();
        return manifest;
    } catch (error) {
        if (manifestPublished) {
            await workspaceIo.deleteFileLocked(manifestPath, { captureRollback: false }).catch(() => undefined);
        }
        if (supervisor && supervisor.snapshot().state !== 'closed') {
            terminateBeforeAcceptance?.();
            if (child?.pid) await supervisor.closed;
        }
        throw error;
    } finally {
        if (terminateBeforeAcceptance) input.signal?.removeEventListener('abort', terminateBeforeAcceptance);
        await logSink.handle.close();
    }
}

/**
 * @param {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} workspace
 * @param {string} manifestPath
 * @param {string | null} [expectedRunId]
 * @returns {Promise<DetachedLiveRunManifest | null>}
 */
export async function readDetachedLiveRunManifest(workspace, manifestPath, expectedRunId = null) {
    try {
        const workspaceIo = workspace.io;
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

/** @param {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} workspace @param {string} runId */
export async function readDetachedLiveRunManifestById(workspace, runId) {
    return await readDetachedLiveRunManifest(workspace, detachedLiveRunManifestPath(workspace, runId), runId);
}

/**
 * @param {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} workspace
 * @param {{ limit?: number; nowMs?: number }} [options]
 */
export async function listDetachedLiveRuns(workspace, options = {}) {
    const directory = detachedLiveRunsDirectory(workspace);
    const limit = Math.max(1, Math.min(500, Math.trunc(options.limit ?? 20)));
    const nowMs = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
    const workspaceIo = workspace.io;
    await workspaceIo.mkdirPathLocked(directory, { recursive: true });
    const entries = await workspaceIo
        .listDirectoryNamesFresh(directory)
        .then((result) => result.entries)
        .catch(() => []);
    const rows = [];
    for (const entry of entries) {
        if (!entry.endsWith('.json')) continue;
        const expectedRunId = entry.slice(0, -'.json'.length);
        if (!DETACHED_LIVE_RUN_ID_RE.test(expectedRunId)) continue;
        const manifest = await readDetachedLiveRunManifest(workspace, join(directory, entry), expectedRunId);
        if (!manifest) continue;
        const summaryPath = join(workspace.workspaceRoot, manifest.outDir, 'summary.md');
        const summaryStats = await workspaceIo
            .statPath(summaryPath)
            .then((result) => result.stats)
            .catch(() => null);
        const summaryReady = summaryStats?.isFile() === true;
        const processIdentity = await inspectDetachedLiveRunProcessIdentity(manifest);
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

/** @param {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} workspace @param {DetachedLiveRunManifest} manifest */
export async function inspectDetachedLiveRunCompletion(workspace, manifest) {
    const summaryPath = join(workspace.workspaceRoot, manifest.outDir, 'summary.md');
    const summaryReady = await workspace.io
        .statPath(summaryPath)
        .then((result) => result.stats.isFile())
        .catch(() => false);
    return {
        summaryReady,
        summaryPath: `${manifest.outDir}/summary.md`,
        processIdentity: await inspectDetachedLiveRunProcessIdentity(manifest),
    };
}

/**
 * @param {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} workspace
 * @param {{
 *     nowMs?: number;
 *     graceMs?: number;
 *     audit?: Pick<ReturnType<typeof import('#copilot/mcp/public/observability').createMcpAuditCapability>, 'append'>;
 *     deps?: {
 *         listRuns?: () => Promise<Record<string, any>[]>;
 *         cancelRun?: (runId: string) => Promise<{ cancelled: boolean; alreadyStopped?: boolean }>;
 *     };
 * }} [options]
 */
export async function reapCompletedDetachedLiveRuns(workspace, options = {}) {
    const nowMs = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
    const graceMs = Math.max(
        5_000,
        Math.min(10 * 60_000, Math.trunc(options.graceMs ?? DEFAULT_COMPLETED_LIVE_RUN_REAP_GRACE_MS)),
    );
    const listRuns = options.deps?.listRuns ?? (() => listDetachedLiveRuns(workspace, { limit: 500, nowMs }));
    const cancelRun =
        options.deps?.cancelRun ??
        (async (runId) => {
            const manifest = await readDetachedLiveRunManifestById(workspace, runId);
            if (!manifest) return { cancelled: false, alreadyStopped: true };
            const result = await cancelDetachedLiveRun(manifest);
            if (result.cancelled) {
                await options.audit?.append({
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
    /** @type {string[]} */
    const reapedRunIds = [];
    /** @type {{ runId: string; error: string }[]} */
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
