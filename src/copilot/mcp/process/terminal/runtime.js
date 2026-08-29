// @ts-check
/**
 * Arbitrary terminal/process control plane for the MCP runtime.
 *
 * Capability boundary: commands run with the same operating-system identity, namespace, mounts and privileges as the
 * MCP process. The caller may choose any executable, shell command, cwd and explicit environment override that this OS
 * identity can use. Ambient parent credentials are not part of generic execution authority: default inheritance is an
 * operational projection rather than process.env. The control plane itself does not maintain a command allowlist.
 *
 * Persistent sessions use a real PTY when `node-pty` is installed and requested/auto-selected; otherwise they use
 * regular child-process pipes. PTY support is loaded dynamically so a missing or broken native binding cannot prevent
 * the MCP server from starting.
 *
 * @module copilot/mcp/process/terminal/runtime
 */

import { buildMcpChildEnvironment } from '#copilot/mcp/public/process/environment';
import { createAttachedChildProcessSupervisor, signalProcessTree } from '#copilot/infra/public/process/supervision';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

export const MCP_TERMINAL_CONTROL_VERSION = 6;

const require = createRequire(import.meta.url);
const DEFAULT_EXEC_TIMEOUT_MS = 120_000;
const MAX_EXEC_TIMEOUT_MS = 60 * 60 * 1000;
const DEFAULT_EXEC_OUTPUT_BYTES = 1024 * 1024;
const MAX_EXEC_OUTPUT_BYTES = 16 * 1024 * 1024;
const DEFAULT_BATCH_RESULT_BUDGET_BYTES = 8 * 1024 * 1024;
const MAX_BATCH_RESULT_BUDGET_BYTES = 32 * 1024 * 1024;
const DEFAULT_SESSION_BUFFER_BYTES = 4 * 1024 * 1024;
const MAX_SESSION_BUFFER_BYTES = 64 * 1024 * 1024;
const DEFAULT_SESSION_READ_BYTES = 512 * 1024;
const MAX_SESSION_READ_BYTES = 8 * 1024 * 1024;
const DEFAULT_SESSION_WAIT_MS = 30_000;
const MAX_SESSION_WAIT_MS = 120_000;
const MAX_SESSION_WAITERS_PER_SESSION = 64;
const CLOSED_SESSION_RETENTION_MS = 30 * 60 * 1000;
const MAX_TERMINAL_SESSIONS = 128;
const MAX_TERMINAL_BATCH = 32;
const MAX_TERMINAL_BATCH_CONCURRENCY = 16;

/** @type {Map<string, TerminalSessionRecord>} */
const sessions = new Map();
/** @type {typeof import('node-pty') | null | undefined} */
let nodePtyModule;
let terminalProcessExitCleanupInstalled = false;

/**
 * @typedef {{
 *     command: string;
 *     args?: string[] | undefined;
 *     shell?: boolean | undefined;
 *     shellPath?: string | undefined;
 *     cwd?: string | undefined;
 *     env?: Record<string, string | null> | undefined;
 *     inheritEnv?: boolean | undefined;
 *     stdin?: string | undefined;
 *     timeoutMs?: number | undefined;
 *     maxOutputBytes?: number | undefined;
 * }} TerminalCommandSpec
 *
 * @typedef {Readonly<{
 *     workspaceRoot: string;
 *     config: import('./config.js').McpTerminalProcessConfig;
 *     signal?: AbortSignal;
 *     cancellationSource?: () => 'caller' | 'deadline' | 'unknown' | null;
 *     principalKey?: string;
 * }>} TerminalExecutionRuntime
 *
 * @typedef {{ seq: number; stream: 'stdout' | 'stderr' | 'pty' | 'system'; data: string; bytes: number; at: string }} TerminalEvent
 *
 *
 * @typedef {{
 *     id: string;
 *     ownerPrincipalKey: string;
 *     backend: 'pipe' | 'pty';
 *     command: string;
 *     args: string[];
 *     cwd: string;
 *     pid: number | null;
 *     startedAt: string;
 *     endedAt: string | null;
 *     status: 'running' | 'exited' | 'failed';
 *     exitCode: number | null;
 *     signal: string | number | null;
 *     environmentProjection: import('#copilot/mcp/public/process/environment').McpChildEnvironmentProjection;
 *     bufferLimitBytes: number;
 *     bufferedBytes: number;
 *     droppedBytes: number;
 *     nextSeq: number;
 *     events: TerminalEvent[];
 *     waiters: Set<() => void>;
 *     child: import('node:child_process').ChildProcessWithoutNullStreams | null;
 *     pty: import('node-pty').IPty | null;
 * }} TerminalSessionRecord
 */

/**
 * Execute one arbitrary command and capture bounded stdout/stderr tails.
 *
 * @param {TerminalCommandSpec} input
 * @param {TerminalExecutionRuntime} runtime
 */
export async function executeTerminalCommand(input, runtime) {
    const executionRuntime = requireTerminalExecutionRuntime(runtime);
    throwIfTerminalRuntimeAborted(executionRuntime);
    const spec = normalizeTerminalCommandSpec(input, executionRuntime.workspaceRoot, executionRuntime.config);
    const startedAt = performance.now();
    return await new Promise((resolve) => {
        const invocation = resolveCommandInvocation(spec, false);
        const child = spawn(invocation.executable, invocation.args, {
            cwd: spec.cwd,
            env: spec.env,
            detached: process.platform !== 'win32',
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        const supervisor = createAttachedChildProcessSupervisor(child);
        let stdout = createTailBuffer(spec.maxOutputBytes);
        let stderr = createTailBuffer(spec.maxOutputBytes);
        let timedOut = false;
        let cancelled = false;
        /** @type {'caller' | 'deadline' | 'unknown' | null} */
        let cancellationSource = null;
        let settled = false;
        /** @type {NodeJS.Timeout | null} */
        let timeout = null;
        /** @type {Error | null} */
        let childError = null;

        child.stdout.on('data', (chunk) => {
            stdout = appendTailBuffer(stdout, chunk);
        });
        child.stderr.on('data', (chunk) => {
            stderr = appendTailBuffer(stderr, chunk);
        });
        if (spec.stdin !== undefined) child.stdin.end(spec.stdin);
        else child.stdin.end();

        /** @param {'timeout' | 'abort'} reason */
        const terminateProcess = (reason) => {
            if (settled) return;
            if (reason === 'timeout') timedOut = true;
            else {
                cancelled = true;
                cancellationSource = executionRuntime.cancellationSource?.() ?? 'caller';
            }
            supervisor.requestTermination();
        };
        if (spec.timeoutMs > 0) {
            timeout = setTimeout(() => terminateProcess('timeout'), spec.timeoutMs);
            timeout.unref();
        }
        const onAbort = () => terminateProcess('abort');
        executionRuntime.signal?.addEventListener('abort', onAbort, { once: true });

        /** @param {number | null} exitCode @param {NodeJS.Signals | null} signal @param {Error | null} [error] */
        const finish = (exitCode, signal, error = null) => {
            if (settled) return;
            settled = true;
            if (timeout) clearTimeout(timeout);
            executionRuntime.signal?.removeEventListener('abort', onAbort);
            const durationMs = Math.round(performance.now() - startedAt);
            resolve({
                success: error === null && exitCode === 0 && !timedOut && !cancelled,
                terminalControlVersion: MCP_TERMINAL_CONTROL_VERSION,
                mode: 'one-shot',
                shell: spec.shell,
                executable: invocation.executable,
                args: invocation.args,
                cwd: spec.cwd,
                pid: child.pid ?? null,
                exitCode,
                signal,
                timedOut,
                cancelled,
                cancellationSource,
                durationMs,
                environmentProjection: spec.environmentProjection,
                stdout: stdout.text,
                stderr: stderr.text,
                stdoutBytesObserved: stdout.observedBytes,
                stderrBytesObserved: stderr.observedBytes,
                stdoutTruncated: stdout.truncated,
                stderrTruncated: stderr.truncated,
                ...(error ? { error: error.message } : {}),
            });
        };
        child.once('error', (error) => {
            childError = error;
        });
        void supervisor.closed.then((observation) => finish(observation.exitCode, observation.signal, childError));
    });
}

/**
 * Execute up to 32 arbitrary commands in one MCP call.
 *
 * @param {TerminalCommandSpec[]} commands
 * @param {TerminalExecutionRuntime} runtime
 * @param {{ concurrency?: number; failureMode?: 'best-effort' | 'fail-fast'; resultBudgetBytes?: number }} [options]
 */
export async function executeTerminalCommandBatch(commands, runtime, options = {}) {
    const executionRuntime = requireTerminalExecutionRuntime(runtime);
    throwIfTerminalRuntimeAborted(executionRuntime);
    if (!Array.isArray(commands) || commands.length < 1 || commands.length > MAX_TERMINAL_BATCH) {
        throw new Error(`terminal batch requires 1-${MAX_TERMINAL_BATCH} commands.`);
    }
    const concurrency = clampInteger(options.concurrency, 1, MAX_TERMINAL_BATCH_CONCURRENCY, 4);
    const failureMode = options.failureMode === 'fail-fast' ? 'fail-fast' : 'best-effort';
    const resultBudgetBytes = clampInteger(
        options.resultBudgetBytes,
        1024 * 1024,
        MAX_BATCH_RESULT_BUDGET_BYTES,
        DEFAULT_BATCH_RESULT_BUDGET_BYTES,
    );
    const perStreamOutputBudgetBytes = Math.max(16 * 1024, Math.floor(resultBudgetBytes / (commands.length * 2)));
    /** @type {(Record<string, unknown> | undefined)[]} */
    const results = new Array(commands.length);
    let nextIndex = 0;
    let aborted = false;
    const worker = async () => {
        while (!aborted && executionRuntime.signal?.aborted !== true) {
            const index = nextIndex++;
            if (index >= commands.length) return;
            try {
                const command = commands[index];
                if (!command) return;
                const requestedOutputBytes = clampInteger(
                    command.maxOutputBytes,
                    16 * 1024,
                    MAX_EXEC_OUTPUT_BYTES,
                    DEFAULT_EXEC_OUTPUT_BYTES,
                );
                const result = /** @type {Record<string, unknown>} */ (
                    await executeTerminalCommand(
                        {
                            ...command,
                            maxOutputBytes: Math.min(requestedOutputBytes, perStreamOutputBudgetBytes),
                        },
                        executionRuntime,
                    )
                );
                results[index] = { index, ...result };
                if (failureMode === 'fail-fast' && result['success'] !== true) aborted = true;
            } catch (error) {
                results[index] = {
                    index,
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                };
                if (failureMode === 'fail-fast') aborted = true;
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, commands.length) }, () => worker()));
    const skippedReason = executionRuntime.signal?.aborted === true ? 'request-cancelled' : 'fail-fast-aborted';
    const finalized = Array.from(
        { length: commands.length },
        (_, index) => results[index] ?? { index, success: false, skipped: true, reason: skippedReason },
    );
    const succeededCount = finalized.filter((result) => result['success'] === true).length;
    const skippedCount = finalized.filter((result) => result['skipped'] === true).length;
    const failedCount = finalized.filter((result) => result['success'] !== true && result['skipped'] !== true).length;
    return {
        success: succeededCount === commands.length,
        batch: true,
        requestCount: commands.length,
        attemptedCount: commands.length - skippedCount,
        succeededCount,
        failedCount,
        skippedCount,
        concurrency,
        failureMode,
        resultBudgetBytes,
        perStreamOutputBudgetBytes,
        results: finalized,
    };
}

/**
 * Observe physical pipe-child acceptance. Caller cancellation owns the child only until the `spawn` event; if abort
 * wins that race we terminate and drain the process group before rejecting. After `spawn`, persistent-session
 * lifecycle is transferred to the explicit terminal session control API.
 *
 * @param {import('node:child_process').ChildProcessWithoutNullStreams} child
 * @param {ReturnType<typeof createAttachedChildProcessSupervisor>} supervisor
 * @param {TerminalExecutionRuntime} runtime
 */
async function awaitPersistentPipeSessionAcceptance(child, supervisor, runtime) {
    await new Promise((resolvePromise, rejectPromise) => {
        let settled = false;
        const cleanup = () => {
            child.off('spawn', onSpawn);
            child.off('error', onError);
            runtime.signal?.removeEventListener('abort', onAbort);
        };
        /** @param {unknown} error */
        const settleReject = (error) => {
            if (settled) return;
            settled = true;
            cleanup();
            rejectPromise(error instanceof Error ? error : new Error(String(error)));
        };
        const onSpawn = () => {
            if (settled) return;
            settled = true;
            cleanup();
            resolvePromise(undefined);
        };
        /** @param {Error} error */
        const onError = (error) => settleReject(error);
        const onAbort = () => {
            if (settled) return;
            settled = true;
            cleanup();
            const source = runtime.cancellationSource?.() ?? 'caller';
            const reason = runtime.signal?.reason;
            const error = Object.assign(
                new Error(
                    reason instanceof Error
                        ? reason.message
                        : `Terminal persistent session open cancelled before spawn acceptance (${source}).`,
                    reason instanceof Error ? { cause: reason } : undefined,
                ),
                {
                    code: source === 'deadline' ? 'MCP_TOOL_TIMEOUT' : 'MCP_TOOL_CANCELLED',
                    cancellationSource: source,
                },
            );
            supervisor.requestTermination({ graceMs: 1_000, initialSignal: 'SIGTERM', forceSignal: 'SIGKILL' });
            void supervisor.closed.then(() => rejectPromise(error));
        };
        child.once('spawn', onSpawn);
        child.once('error', onError);
        runtime.signal?.addEventListener('abort', onAbort, { once: true });
        if (runtime.signal?.aborted) onAbort();
    });
}

/**
 * Open an arbitrary persistent terminal/process session.
 *
 * @param {{
 *     command?: string;
 *     args?: string[];
 *     shell?: boolean;
 *     shellPath?: string;
 *     cwd?: string;
 *     env?: Record<string, string | null>;
 *     inheritEnv?: boolean;
 *     backend?: 'auto' | 'pipe' | 'pty';
 *     cols?: number;
 *     rows?: number;
 *     bufferBytes?: number;
 *     initialInput?: string;
 * }} input
 * @param {TerminalExecutionRuntime} runtime
 */
export async function openTerminalSession(input, runtime) {
    const executionRuntime = requireTerminalExecutionRuntime(runtime);
    throwIfTerminalRuntimeAborted(executionRuntime);
    const ownerPrincipalKey = requireTerminalSessionPrincipalKey(executionRuntime);
    ensureTerminalProcessExitCleanup();
    pruneTerminalSessions(ownerPrincipalKey);
    if (runningSessionCount(undefined) >= MAX_TERMINAL_SESSIONS) {
        return {
            success: false,
            code: 'ERR_TERMINAL_SESSION_LIMIT',
            maxSessions: MAX_TERMINAL_SESSIONS,
            runningSessions: runningSessionCount(undefined),
        };
    }
    const requestedBackend = input.backend ?? 'auto';
    const ptyModule = requestedBackend === 'pipe' ? null : getNodePtyModule();
    if (requestedBackend === 'pty' && !ptyModule) {
        return {
            success: false,
            code: 'ERR_TERMINAL_PTY_UNAVAILABLE',
            hint: 'Install node-pty in the workspace, then retry backend=pty; backend=auto falls back to pipes.',
            capabilities: getTerminalCapabilities(executionRuntime.config),
        };
    }
    const backend = ptyModule ? 'pty' : 'pipe';
    const spec = normalizeTerminalSessionSpec(input, executionRuntime.workspaceRoot, executionRuntime.config);
    const invocation = resolveCommandInvocation(spec, true);
    const id = randomUUID();
    /** @type {TerminalSessionRecord} */
    const record = {
        id,
        ownerPrincipalKey,
        backend,
        command: invocation.executable,
        args: [...invocation.args],
        cwd: spec.cwd,
        pid: null,
        startedAt: new Date().toISOString(),
        endedAt: null,
        status: 'running',
        exitCode: null,
        signal: null,
        environmentProjection: spec.environmentProjection,
        bufferLimitBytes: spec.bufferBytes,
        bufferedBytes: 0,
        droppedBytes: 0,
        nextSeq: 1,
        events: [],
        waiters: new Set(),
        child: null,
        pty: null,
    };
    sessions.set(id, record);

    try {
        if (backend === 'pty' && ptyModule) {
            const env = stringEnvironment(spec.env);
            const terminal = ptyModule.spawn(invocation.executable, invocation.args, {
                cwd: spec.cwd,
                env,
                cols: spec.cols,
                rows: spec.rows,
                name: env['TERM'] || 'xterm-256color',
            });
            record.pty = terminal;
            record.pid = Number(terminal.pid ?? 0) || null;
            terminal.onData((/** @type {string} */ data) => appendSessionEvent(record, 'pty', String(data)));
            terminal.onExit((/** @type {{ exitCode?: number; signal?: number }} */ event) => {
                markSessionExited(record, Number(event?.exitCode ?? 0), Number(event?.signal ?? 0) || null);
            });
            if (spec.initialInput) terminal.write(spec.initialInput);
        } else {
            const child = spawn(invocation.executable, invocation.args, {
                cwd: spec.cwd,
                env: spec.env,
                detached: process.platform !== 'win32',
                windowsHide: true,
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            record.child = child;
            record.pid = child.pid ?? null;
            const supervisor = createAttachedChildProcessSupervisor(child, {
                processGroup: process.platform !== 'win32',
            });
            child.stdout.on('data', (chunk) => appendSessionEvent(record, 'stdout', String(chunk)));
            child.stderr.on('data', (chunk) => appendSessionEvent(record, 'stderr', String(chunk)));
            child.on('error', (error) => {
                appendSessionEvent(record, 'system', `spawn error: ${error.message}\n`);
                markSessionFailed(record);
            });
            child.once('close', (code, signal) => markSessionExited(record, code, signal));
            await awaitPersistentPipeSessionAcceptance(child, supervisor, executionRuntime);
            if (spec.initialInput) child.stdin.write(spec.initialInput);
        }
        return {
            success: true,
            session: summarizeTerminalSession(record),
            capabilities: getTerminalCapabilities(executionRuntime.config),
        };
    } catch (error) {
        sessions.delete(id);
        const errorCode =
            error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
                ? error.code
                : 'ERR_TERMINAL_SESSION_OPEN';
        return {
            success: false,
            code: errorCode,
            error: error instanceof Error ? error.message : String(error),
            backend,
            command: invocation.executable,
            cwd: spec.cwd,
        };
    }
}

/**
 * Mutate/control one persistent terminal session.
 *
 * @param {{
 *     action: 'write' | 'eof' | 'resize' | 'signal' | 'close' | 'forget';
 *     sessionId: string;
 *     data?: string;
 *     appendNewline?: boolean;
 *     cols?: number;
 *     rows?: number;
 *     signal?: string;
 *     processGroup?: boolean;
 *     graceMs?: number;
 * }} input
 * @param {TerminalExecutionRuntime} runtime
 */
export async function controlTerminalSession(input, runtime) {
    const executionRuntime = requireTerminalExecutionRuntime(runtime);
    const ownerPrincipalKey = requireTerminalSessionPrincipalKey(executionRuntime);
    pruneTerminalSessions(ownerPrincipalKey);
    const record = getOwnedTerminalSession(input.sessionId, ownerPrincipalKey);
    if (!record) return { success: false, code: 'ERR_TERMINAL_SESSION_NOT_FOUND', sessionId: input.sessionId };
    const action = input.action;
    if (action === 'forget') {
        if (record.status === 'running') {
            return {
                success: false,
                code: 'ERR_TERMINAL_SESSION_RUNNING',
                hint: 'Close or signal the session before forgetting it.',
            };
        }
        sessions.delete(record.id);
        return { success: true, action, sessionId: record.id, forgotten: true };
    }
    if (action === 'write') {
        if (record.status !== 'running') return terminalNotRunning(record);
        const data = String(input.data ?? '') + (input.appendNewline === true ? '\n' : '');
        if (record.backend === 'pty') record.pty?.write(data);
        else record.child?.stdin.write(data);
        return {
            success: true,
            action,
            session: summarizeTerminalSession(record),
            bytesWritten: Buffer.byteLength(data),
        };
    }
    if (action === 'eof') {
        if (record.status !== 'running') return terminalNotRunning(record);
        if (record.backend === 'pty') record.pty?.write('\x04');
        else record.child?.stdin.end();
        return { success: true, action, session: summarizeTerminalSession(record) };
    }
    if (action === 'resize') {
        if (record.status !== 'running') return terminalNotRunning(record);
        if (record.backend !== 'pty' || !record.pty) {
            return {
                success: false,
                code: 'ERR_TERMINAL_RESIZE_REQUIRES_PTY',
                session: summarizeTerminalSession(record),
            };
        }
        const cols = clampInteger(input.cols, 1, 1000, 120);
        const rows = clampInteger(input.rows, 1, 1000, 40);
        record.pty.resize(cols, rows);
        return { success: true, action, cols, rows, session: summarizeTerminalSession(record) };
    }
    if (action === 'signal') {
        if (record.status !== 'running') return terminalNotRunning(record);
        const signal = normalizeSignal(input.signal ?? 'SIGTERM');
        if (record.backend === 'pty' && record.pty) record.pty.kill(signal);
        else if (record.pid) signalProcessTree(record.pid, signal, { processGroup: input.processGroup !== false });
        return { success: true, action, signal, session: summarizeTerminalSession(record) };
    }
    if (action === 'close') {
        if (record.status !== 'running')
            return { success: true, action, session: summarizeTerminalSession(record), alreadyClosed: true };
        const graceMs = clampInteger(input.graceMs, 0, 30_000, 1_500);
        if (record.backend === 'pty' && record.pty) record.pty.kill('SIGTERM');
        else if (record.pid) signalProcessTree(record.pid, 'SIGTERM', { processGroup: input.processGroup !== false });
        if (graceMs > 0) await waitForSessionExit(record, graceMs);
        if (record.status === 'running') {
            if (record.backend === 'pty' && record.pty) record.pty.kill('SIGKILL');
            else if (record.pid)
                signalProcessTree(record.pid, 'SIGKILL', { processGroup: input.processGroup !== false });
            await waitForSessionExit(record, Math.min(1_000, Math.max(100, graceMs)));
        }
        return { success: record.status !== 'running', action, session: summarizeTerminalSession(record) };
    }
    return { success: false, code: 'ERR_TERMINAL_SESSION_ACTION', action };
}

/**
 * Read session output/status without mutating the target process.
 *
 * @param {{
 *     action?: 'read' | 'status' | 'list' | 'capabilities';
 *     sessionId?: string;
 *     afterSeq?: number;
 *     maxBytes?: number;
 *     limit?: number;
 * }} input
 * @param {TerminalExecutionRuntime} runtime
 */
export function readTerminalSession(input, runtime) {
    const executionRuntime = requireTerminalExecutionRuntime(runtime);
    const ownerPrincipalKey = requireTerminalSessionPrincipalKey(executionRuntime);
    pruneTerminalSessions(ownerPrincipalKey);
    const action = input.action ?? 'read';
    if (action === 'capabilities') {
        return { success: true, capabilities: getTerminalCapabilities(executionRuntime.config) };
    }
    if (action === 'list') {
        const limit = clampInteger(input.limit, 1, MAX_TERMINAL_SESSIONS, 50);
        const ownedSessions = [...sessions.values()].filter((record) => record.ownerPrincipalKey === ownerPrincipalKey);
        return {
            success: true,
            total: ownedSessions.length,
            running: runningSessionCount(ownerPrincipalKey),
            sessions: ownedSessions
                .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
                .slice(0, limit)
                .map(summarizeTerminalSession),
        };
    }
    const record = getOwnedTerminalSession(input.sessionId, ownerPrincipalKey);
    if (!record) return { success: false, code: 'ERR_TERMINAL_SESSION_NOT_FOUND', sessionId: input.sessionId ?? null };
    if (action === 'status') return { success: true, session: summarizeTerminalSession(record) };
    const afterSeq = Math.max(0, Math.trunc(Number(input.afterSeq ?? 0)));
    const maxBytes = clampInteger(input.maxBytes, 1024, MAX_SESSION_READ_BYTES, DEFAULT_SESSION_READ_BYTES);
    let returnedBytes = 0;
    /** @type {TerminalEvent[]} */
    const events = [];
    for (const event of record.events) {
        if (event.seq <= afterSeq) continue;
        if (events.length > 0 && returnedBytes + event.bytes > maxBytes) break;
        events.push(event);
        returnedBytes += event.bytes;
        if (returnedBytes >= maxBytes) break;
    }
    const earliestSeq = record.events[0]?.seq ?? record.nextSeq;
    const latestSeq = events.at(-1)?.seq ?? afterSeq;
    return {
        success: true,
        session: summarizeTerminalSession(record),
        afterSeq,
        nextSeq: latestSeq,
        earliestAvailableSeq: earliestSeq,
        cursorBehindRetention: afterSeq > 0 && afterSeq < earliestSeq - 1,
        returnedBytes,
        hasMore: record.events.some((event) => event.seq > latestSeq),
        events,
    };
}

/**
 * Optionally wait for new output or process termination, then project the same cursor-bounded read result. Immediate
 * read semantics remain the default; a wait never owns or terminates the persistent process.
 *
 * @param {{
 *     action?: 'read' | 'status' | 'list' | 'capabilities';
 *     sessionId?: string;
 *     afterSeq?: number;
 *     maxBytes?: number;
 *     limit?: number;
 *     waitFor?: 'output-or-exit';
 *     waitMs?: number;
 * }} input
 * @param {TerminalExecutionRuntime} runtime
 */
export async function readTerminalSessionWithWait(input, runtime) {
    const executionRuntime = requireTerminalExecutionRuntime(runtime);
    const immediate = readTerminalSession(input, executionRuntime);
    if ((input.action ?? 'read') !== 'read' || input.waitFor !== 'output-or-exit') return immediate;
    if (immediate['success'] !== true) return immediate;

    const ownerPrincipalKey = requireTerminalSessionPrincipalKey(executionRuntime);
    const record = getOwnedTerminalSession(input.sessionId, ownerPrincipalKey);
    if (!record) return immediate;
    const waitMs = clampInteger(input.waitMs, 1, MAX_SESSION_WAIT_MS, DEFAULT_SESSION_WAIT_MS);
    const afterSeq = Math.max(0, Math.trunc(Number(input.afterSeq ?? 0)));
    const immediateEvents = Array.isArray(immediate['events']) ? immediate['events'] : [];
    if (immediate['cursorBehindRetention'] === true) {
        return { ...immediate, waitFor: input.waitFor, waitMs, waitedMs: 0, waitOutcome: 'cursor-behind-retention' };
    }
    if (record.status !== 'running') {
        return { ...immediate, waitFor: input.waitFor, waitMs, waitedMs: 0, waitOutcome: 'immediate-exit' };
    }
    if (immediateEvents.length > 0) {
        return { ...immediate, waitFor: input.waitFor, waitMs, waitedMs: 0, waitOutcome: 'immediate-output' };
    }

    const startedAt = performance.now();
    const signalOutcome = await waitForTerminalSessionReadChange(record, afterSeq, waitMs, executionRuntime);
    const refreshed = readTerminalSession(input, executionRuntime);
    const waitedMs = Math.max(0, Math.round(performance.now() - startedAt));
    const refreshedRecord = getOwnedTerminalSession(input.sessionId, ownerPrincipalKey);
    const refreshedEvents = Array.isArray(refreshed['events']) ? refreshed['events'] : [];
    const waitOutcome =
        refreshedRecord?.status !== 'running'
            ? 'exit'
            : refreshedEvents.length > 0
              ? 'output'
              : signalOutcome === 'timeout'
                ? 'timeout'
                : 'output';
    return { ...refreshed, waitFor: input.waitFor, waitMs, waitedMs, waitOutcome };
}

/** Return terminal backend/process capabilities. @param {import('./config.js').McpTerminalProcessConfig} config */
export function getTerminalCapabilities(config) {
    if (!config) throw new TypeError('Terminal capabilities require a terminal process config generation.');
    const pty = getNodePtyModule();
    return {
        terminalControlVersion: MCP_TERMINAL_CONTROL_VERSION,
        arbitraryCommands: true,
        arbitraryShell: true,
        arbitraryExecutable: true,
        arbitraryCwd: true,
        arbitraryEnvironment: true,
        ambientCredentialInheritance: false,
        defaultEnvironmentInheritance: 'operational-projection',
        explicitEnvironmentOverrides: true,
        stdin: true,
        persistentSessions: true,
        multipleSessions: true,
        signals: true,
        processGroups: process.platform !== 'win32',
        pty: Boolean(pty),
        ptyModule: pty ? 'node-pty' : null,
        defaultShell: config.defaultShell,
        maxSessions: MAX_TERMINAL_SESSIONS,
        maxBatchCommands: MAX_TERMINAL_BATCH,
        maxBatchConcurrency: MAX_TERMINAL_BATCH_CONCURRENCY,
        defaultBatchResultBudgetBytes: DEFAULT_BATCH_RESULT_BUDGET_BYTES,
        maxBatchResultBudgetBytes: MAX_BATCH_RESULT_BUDGET_BYTES,
        maxExecOutputBytes: MAX_EXEC_OUTPUT_BYTES,
        maxSessionBufferBytes: MAX_SESSION_BUFFER_BYTES,
        maxSessionWaitMs: MAX_SESSION_WAIT_MS,
        maxSessionWaitersPerSession: MAX_SESSION_WAITERS_PER_SESSION,
        sessionLifecycle: {
            runningLifetime: 'until-process-exit-or-explicit-close',
            closedRetentionMs: CLOSED_SESSION_RETENTION_MS,
            processExitCleanup: 'force-kill-running-session-process-trees',
            retentionCleanup: 'opportunistic-on-session-operations',
        },
        osBoundary: 'same-identity-namespace-mounts-and-privileges-as-mcp-process',
    };
}

/** @param {TerminalCommandSpec} input @param {string} workspaceRoot @param {import('./config.js').McpTerminalProcessConfig} config */
function normalizeTerminalCommandSpec(input, workspaceRoot, config) {
    if (!input || typeof input !== 'object') throw new Error('Terminal command input is required.');
    const command = String(input.command ?? '');
    if (!command) throw new Error('command is required.');
    const shell = input.shell !== false;
    return {
        command,
        args: normalizeStringArray(input.args),
        shell,
        shellPath: normalizeShellPath(input.shellPath, config.defaultShell),
        cwd: resolveTerminalCwd(input.cwd, workspaceRoot),
        ...buildTerminalEnvironmentSpec(input.env, input.inheritEnv !== false, config),
        stdin: input.stdin === undefined ? undefined : String(input.stdin),
        timeoutMs: normalizeTimeout(input.timeoutMs),
        maxOutputBytes: clampInteger(input.maxOutputBytes, 16 * 1024, MAX_EXEC_OUTPUT_BYTES, DEFAULT_EXEC_OUTPUT_BYTES),
    };
}

/** @param {Parameters<typeof openTerminalSession>[0]} input @param {string} workspaceRoot @param {import('./config.js').McpTerminalProcessConfig} config */
function normalizeTerminalSessionSpec(input, workspaceRoot, config) {
    const shell = input?.shell !== false;
    const command = input?.command === undefined ? '' : String(input.command);
    if (!shell && !command) throw new Error('command is required when shell=false.');
    return {
        command,
        args: normalizeStringArray(input?.args),
        shell,
        shellPath: normalizeShellPath(input?.shellPath, config.defaultShell),
        cwd: resolveTerminalCwd(input?.cwd, workspaceRoot),
        ...buildTerminalEnvironmentSpec(input?.env, input?.inheritEnv !== false, config),
        timeoutMs: 0,
        maxOutputBytes: DEFAULT_EXEC_OUTPUT_BYTES,
        stdin: undefined,
        cols: clampInteger(input?.cols, 1, 1000, 120),
        rows: clampInteger(input?.rows, 1, 1000, 40),
        bufferBytes: clampInteger(
            input?.bufferBytes,
            64 * 1024,
            MAX_SESSION_BUFFER_BYTES,
            DEFAULT_SESSION_BUFFER_BYTES,
        ),
        initialInput: input?.initialInput === undefined ? '' : String(input.initialInput),
    };
}

/**
 * @param {{ command: string; args: string[]; shell: boolean; shellPath: string }} spec
 * @param {boolean} interactive
 */
function resolveCommandInvocation(spec, interactive) {
    if (!spec.shell) return { executable: spec.command, args: [...spec.args] };
    if (interactive && !spec.command) return { executable: spec.shellPath, args: ['-i'] };
    return { executable: spec.shellPath, args: ['-lc', spec.command] };
}

/** @param {string | undefined} cwd @param {string} workspaceRoot */
function resolveTerminalCwd(cwd, workspaceRoot) {
    if (cwd === undefined || cwd === '') return workspaceRoot;
    return path.isAbsolute(cwd) ? path.normalize(cwd) : path.resolve(workspaceRoot, cwd);
}

/** @param {TerminalExecutionRuntime} runtime @returns {TerminalExecutionRuntime} */
function requireTerminalExecutionRuntime(runtime) {
    if (!runtime || typeof runtime.workspaceRoot !== 'string' || !path.isAbsolute(runtime.workspaceRoot)) {
        throw new TypeError('Terminal execution requires an absolute composition-owned workspaceRoot.');
    }
    if (!runtime.config) throw new TypeError('Terminal execution requires a process config generation.');
    return runtime;
}

/** @param {TerminalExecutionRuntime} runtime */
function throwIfTerminalRuntimeAborted(runtime) {
    if (!runtime.signal?.aborted) return;
    const source = runtime.cancellationSource?.() ?? 'caller';
    throw Object.assign(new Error(`Terminal execution cancelled before spawn (${source}).`), {
        code: source === 'deadline' ? 'MCP_TOOL_TIMEOUT' : 'MCP_TOOL_CANCELLED',
        cancellationSource: source,
    });
}

/**
 * @param {Record<string, string | null> | undefined} override
 * @param {boolean} inheritOperationalEnv
 * @param {import('./config.js').McpTerminalProcessConfig} config
 * @returns {{ env: NodeJS.ProcessEnv; environmentProjection: import('#copilot/mcp/public/process/environment').McpChildEnvironmentProjection }}
 */
function buildTerminalEnvironmentSpec(override, inheritOperationalEnv, config) {
    const { env, projection } = buildMcpChildEnvironment({
        parentEnv: /** @type {NodeJS.ProcessEnv} */ ({ ...config.operationalEnvironment }),
        ...(override ? { overrides: override } : {}),
        inheritOperationalEnv,
    });
    return { env, environmentProjection: projection };
}

/** @param {NodeJS.ProcessEnv} env */
function stringEnvironment(env) {
    /** @type {Record<string, string>} */
    const result = {};
    for (const [key, value] of Object.entries(env)) if (value !== undefined) result[key] = value;
    return result;
}

/** @param {unknown} value */
function normalizeStringArray(value) {
    return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

/** @param {unknown} value @param {string} defaultShell */
function normalizeShellPath(value, defaultShell) {
    const shell = String(value ?? defaultShell).trim();
    return shell || defaultShell;
}

/** @param {unknown} value */
function normalizeTimeout(value) {
    if (value === 0) return 0;
    return clampInteger(value, 100, MAX_EXEC_TIMEOUT_MS, DEFAULT_EXEC_TIMEOUT_MS);
}

/** @param {number} maxBytes */
function createTailBuffer(maxBytes) {
    return { text: '', observedBytes: 0, truncated: false, maxBytes };
}

/** @param {ReturnType<typeof createTailBuffer>} state @param {string | Buffer} chunk */
function appendTailBuffer(state, chunk) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    const observedBytes = state.observedBytes + data.length;
    const existing = Buffer.from(state.text);
    const combined = Buffer.concat([existing, data]);
    const kept = combined.length > state.maxBytes ? combined.subarray(combined.length - state.maxBytes) : combined;
    return {
        ...state,
        text: kept.toString('utf8'),
        observedBytes,
        truncated: state.truncated || combined.length > state.maxBytes,
    };
}

/** @param {TerminalSessionRecord} record @param {TerminalEvent['stream']} stream @param {string} data */
function appendSessionEvent(record, stream, data) {
    if (!data) return;
    const event = {
        seq: record.nextSeq++,
        stream,
        data,
        bytes: Buffer.byteLength(data),
        at: new Date().toISOString(),
    };
    record.events.push(event);
    record.bufferedBytes += event.bytes;
    while (record.bufferedBytes > record.bufferLimitBytes && record.events.length > 1) {
        const removed = record.events.shift();
        if (!removed) break;
        record.bufferedBytes -= removed.bytes;
        record.droppedBytes += removed.bytes;
    }
    notifyTerminalSessionWaiters(record);
}

/** @param {TerminalSessionRecord} record @param {number | null} exitCode @param {string | number | null} signal */
function markSessionExited(record, exitCode, signal) {
    if (record.status !== 'running') return;
    record.status = 'exited';
    record.exitCode = exitCode;
    record.signal = signal;
    record.endedAt = new Date().toISOString();
    record.child = null;
    record.pty = null;
    appendSessionEvent(record, 'system', `\n[terminal:exit] code=${String(exitCode)} signal=${String(signal ?? '')}\n`);
}

/** @param {TerminalSessionRecord} record */
function markSessionFailed(record) {
    record.status = 'failed';
    record.endedAt = new Date().toISOString();
    record.child = null;
    record.pty = null;
    notifyTerminalSessionWaiters(record);
}

/** @param {TerminalSessionRecord} record */
function summarizeTerminalSession(record) {
    return {
        id: record.id,
        backend: record.backend,
        command: record.command,
        args: record.args,
        cwd: record.cwd,
        pid: record.pid,
        startedAt: record.startedAt,
        endedAt: record.endedAt,
        status: record.status,
        exitCode: record.exitCode,
        signal: record.signal,
        environmentProjection: record.environmentProjection,
        bufferLimitBytes: record.bufferLimitBytes,
        bufferedBytes: record.bufferedBytes,
        droppedBytes: record.droppedBytes,
        nextSeq: record.nextSeq,
        retentionExpiresAt:
            record.endedAt === null
                ? null
                : new Date(Date.parse(record.endedAt) + CLOSED_SESSION_RETENTION_MS).toISOString(),
    };
}

/** @param {TerminalSessionRecord} record */
function terminalNotRunning(record) {
    return { success: false, code: 'ERR_TERMINAL_SESSION_NOT_RUNNING', session: summarizeTerminalSession(record) };
}

/** @param {TerminalSessionRecord} record @param {number} waitMs */
async function waitForSessionExit(record, waitMs) {
    if (record.status !== 'running' || waitMs <= 0) return record.status !== 'running';
    await new Promise((resolvePromise) => {
        let settled = false;
        /** @type {NodeJS.Timeout | null} */
        let timeout = null;
        const cleanup = () => {
            record.waiters.delete(onChange);
            if (timeout) clearTimeout(timeout);
        };
        const settle = () => {
            if (settled) return;
            settled = true;
            cleanup();
            resolvePromise(undefined);
        };
        const onChange = () => {
            if (record.status !== 'running') settle();
        };
        record.waiters.add(onChange);
        timeout = setTimeout(settle, waitMs);
        timeout.unref();
        if (record.status !== 'running') settle();
    });
    return record.status !== 'running';
}

/** @param {TerminalSessionRecord} record */
function notifyTerminalSessionWaiters(record) {
    for (const waiter of [...record.waiters]) waiter();
}

/** @param {TerminalSessionRecord} record @param {number} afterSeq */
function terminalSessionReadChangeAvailable(record, afterSeq) {
    if (record.status !== 'running') return true;
    const earliestSeq = record.events[0]?.seq ?? record.nextSeq;
    if (afterSeq > 0 && afterSeq < earliestSeq - 1) return true;
    return record.events.some((event) => event.seq > afterSeq);
}

/**
 * @param {TerminalSessionRecord} record
 * @param {number} afterSeq
 * @param {number} waitMs
 * @param {TerminalExecutionRuntime} runtime
 * @returns {Promise<'change' | 'timeout'>}
 */
async function waitForTerminalSessionReadChange(record, afterSeq, waitMs, runtime) {
    if (runtime.signal?.aborted) throw terminalSessionWaitCancellationError(runtime);
    if (terminalSessionReadChangeAvailable(record, afterSeq)) return 'change';
    if (record.waiters.size >= MAX_SESSION_WAITERS_PER_SESSION) {
        throw Object.assign(new Error('Terminal session has reached the bounded concurrent read-wait limit.'), {
            code: 'ERR_TERMINAL_SESSION_WAITER_LIMIT',
            maxWaiters: MAX_SESSION_WAITERS_PER_SESSION,
        });
    }
    return await new Promise((resolvePromise, rejectPromise) => {
        let settled = false;
        /** @type {NodeJS.Timeout | null} */
        let timeout = null;
        const cleanup = () => {
            record.waiters.delete(onChange);
            runtime.signal?.removeEventListener('abort', onAbort);
            if (timeout) clearTimeout(timeout);
        };
        /** @param {'change' | 'timeout'} outcome */
        const resolveOnce = (outcome) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolvePromise(outcome);
        };
        /** @param {unknown} error */
        const rejectOnce = (error) => {
            if (settled) return;
            settled = true;
            cleanup();
            rejectPromise(error instanceof Error ? error : new Error(String(error)));
        };
        const onChange = () => resolveOnce('change');
        const onAbort = () => rejectOnce(terminalSessionWaitCancellationError(runtime));
        record.waiters.add(onChange);
        runtime.signal?.addEventListener('abort', onAbort, { once: true });
        timeout = setTimeout(() => resolveOnce('timeout'), waitMs);
        timeout.unref();
        // Close the race between the immediate read and waiter registration.
        if (terminalSessionReadChangeAvailable(record, afterSeq)) onChange();
        else if (runtime.signal?.aborted) onAbort();
    });
}

/** @param {TerminalExecutionRuntime} runtime */
function terminalSessionWaitCancellationError(runtime) {
    const source = runtime.cancellationSource?.() ?? 'caller';
    const reason = runtime.signal?.reason;
    return Object.assign(
        new Error(
            reason instanceof Error ? reason.message : `Terminal session read wait cancelled (${source}).`,
            reason instanceof Error ? { cause: reason } : undefined,
        ),
        {
            code: source === 'deadline' ? 'MCP_TOOL_TIMEOUT' : 'MCP_TOOL_CANCELLED',
            cancellationSource: source,
        },
    );
}

/** @param {string | undefined} ownerPrincipalKey */
function runningSessionCount(ownerPrincipalKey) {
    let count = 0;
    for (const record of sessions.values()) {
        if (record.status !== 'running') continue;
        if (ownerPrincipalKey !== undefined && record.ownerPrincipalKey !== ownerPrincipalKey) continue;
        count += 1;
    }
    return count;
}

/** @param {string | undefined} sessionId @param {string} ownerPrincipalKey */
function getOwnedTerminalSession(sessionId, ownerPrincipalKey) {
    const record = sessions.get(String(sessionId ?? ''));
    return record?.ownerPrincipalKey === ownerPrincipalKey ? record : null;
}

/** @param {TerminalExecutionRuntime} runtime */
function requireTerminalSessionPrincipalKey(runtime) {
    const principalKey = String(runtime.principalKey ?? '').trim();
    if (!principalKey) throw new TypeError('Persistent terminal session access requires an authorization-derived principal key.');
    return principalKey;
}

/** @param {TerminalSessionRecord} record @param {number} nowMs */
function terminalClosedRetentionExpired(record, nowMs) {
    if (record.status === 'running' || record.endedAt === null) return false;
    const endedAtMs = Date.parse(record.endedAt);
    return Number.isFinite(endedAtMs) && nowMs - endedAtMs >= CLOSED_SESSION_RETENTION_MS;
}

/** @param {string} ownerPrincipalKey @param {number} [nowMs] */
function pruneTerminalSessions(ownerPrincipalKey, nowMs = Date.now()) {
    for (const [sessionId, record] of sessions) {
        if (terminalClosedRetentionExpired(record, nowMs)) sessions.delete(sessionId);
    }
    if (sessions.size <= MAX_TERMINAL_SESSIONS) return;
    const ownedClosed = [...sessions.values()]
        .filter((record) => record.ownerPrincipalKey === ownerPrincipalKey && record.status !== 'running')
        .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
    for (const record of ownedClosed) {
        if (sessions.size <= MAX_TERMINAL_SESSIONS) break;
        sessions.delete(record.id);
    }
}

function ensureTerminalProcessExitCleanup() {
    if (terminalProcessExitCleanupInstalled) return;
    terminalProcessExitCleanupInstalled = true;
    process.once('exit', terminateRunningTerminalSessionsAtProcessExit);
}

function terminateRunningTerminalSessionsAtProcessExit() {
    for (const record of sessions.values()) {
        if (record.status !== 'running') continue;
        try {
            if (record.backend === 'pty' && record.pty) record.pty.kill('SIGKILL');
            else if (record.pid) signalProcessTree(record.pid, 'SIGKILL', { processGroup: true });
        } catch {
            // Process exit cleanup is best-effort and must never block MCP shutdown.
        }
    }
}

function getNodePtyModule() {
    if (nodePtyModule !== undefined) return nodePtyModule;
    try {
        nodePtyModule = require('node-pty');
    } catch {
        nodePtyModule = null;
    }
    return nodePtyModule;
}

/** @param {unknown} value */
function normalizeSignal(value) {
    const signal = String(value ?? 'SIGTERM').toUpperCase();
    if (!/^SIG[A-Z0-9]+$/u.test(signal)) throw new Error(`Invalid signal: ${signal}`);
    return /** @type {NodeJS.Signals} */ (signal);
}

/** @param {unknown} value @param {number} min @param {number} max @param {number} fallback */
function clampInteger(value, min, max, fallback) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, Math.trunc(numeric)));
}
