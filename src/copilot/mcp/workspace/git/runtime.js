// @ts-check
/**
 * Governed Git execution primitive for the MCP workspace.
 *
 * The primitive owns physical subprocess completion: caller cancellation, local timeout and output-budget exhaustion
 * terminate the Git process tree and resolve only after Node observes child `close`. This prevents a cancelled MCP
 * response from leaving `git commit`, hooks, SSH or `git push` descendants executing in the background.
 *
 * @module copilot/mcp/workspace/git/runtime
 */

import { createAttachedChildProcessSupervisor } from '#copilot/mcp/public/process/supervision';
import { spawn } from 'node:child_process';

const DEFAULT_GIT_TIMEOUT_MS = 15_000;
const DEFAULT_GIT_MAX_BUFFER_BYTES = 2 * 1024 * 1024;
const MAX_GIT_TIMEOUT_MS = 5 * 60_000;
const MAX_GIT_BUFFER_BYTES = 32 * 1024 * 1024;
const TERMINATION_GRACE_MS = 1_500;

/**
 * @typedef {Readonly<{
 *     success: boolean;
 *     stdout: string;
 *     stderr: string;
 *     error?: string;
 *     exitCode: number | null;
 *     signal: NodeJS.Signals | null;
 *     cancelled: boolean;
 *     timedOut: boolean;
 *     outputLimitExceeded: boolean;
 * }>} WorkspaceGitExecutionResult
 */

/**
 * @param {string[]} args
 * @param {{
 *     config: import('./config.js').McpGitProcessConfig;
 *     timeoutMs?: number;
 *     maxBufferBytes?: number;
 *     cwd: string;
 *     signal?: AbortSignal;
 * }} opts
 * @returns {Promise<WorkspaceGitExecutionResult>}
 */
export async function execWorkspaceGit(args, opts) {
    if (!opts?.config) throw new TypeError('Workspace Git execution requires an explicit Git process config.');
    if (typeof opts.cwd !== 'string' || opts.cwd.length === 0)
        throw new TypeError('Workspace Git execution requires an explicit cwd authority.');
    if (!Array.isArray(args)) throw new TypeError('Workspace Git execution requires an argument array.');
    const timeoutMs = normalizeBoundedInteger(opts.timeoutMs, DEFAULT_GIT_TIMEOUT_MS, 1, MAX_GIT_TIMEOUT_MS);
    const maxBufferBytes = normalizeBoundedInteger(
        opts.maxBufferBytes,
        DEFAULT_GIT_MAX_BUFFER_BYTES,
        1024,
        MAX_GIT_BUFFER_BYTES,
    );
    if (opts.signal?.aborted) {
        return Object.freeze({
            success: false,
            stdout: '',
            stderr: '',
            error: abortMessage(opts.signal, 'Git execution cancelled before spawn.'),
            exitCode: null,
            signal: null,
            cancelled: true,
            timedOut: false,
            outputLimitExceeded: false,
        });
    }

    /** @type {Buffer[]} */
    const stdoutChunks = [];
    /** @type {Buffer[]} */
    const stderrChunks = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let spawnError = null;
    let cancelled = false;
    let timedOut = false;
    let outputLimitExceeded = false;

    const child = spawn('git', args, {
        cwd: opts.cwd,
        env: opts.config.childEnvironment,
        detached: process.platform !== 'win32',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const supervisor = createAttachedChildProcessSupervisor(child, { processGroup: true });

    const terminate = () =>
        supervisor.requestTermination({
            graceMs: TERMINATION_GRACE_MS,
            initialSignal: 'SIGTERM',
            forceSignal: 'SIGKILL',
        });

    /** @param {Buffer[]} chunks @param {number} currentBytes @param {Buffer | string} chunk */
    const appendBounded = (chunks, currentBytes, chunk) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        const remaining = Math.max(0, maxBufferBytes - currentBytes);
        if (remaining > 0) chunks.push(buffer.subarray(0, remaining));
        const observed = currentBytes + buffer.length;
        if (observed > maxBufferBytes && !outputLimitExceeded) {
            outputLimitExceeded = true;
            terminate();
        }
        return observed;
    };

    child.stdout?.on('data', (chunk) => {
        stdoutBytes = appendBounded(stdoutChunks, stdoutBytes, chunk);
    });
    child.stderr?.on('data', (chunk) => {
        stderrBytes = appendBounded(stderrChunks, stderrBytes, chunk);
    });
    child.once('error', (error) => {
        spawnError = error instanceof Error ? error.message : String(error);
    });

    const onAbort = () => {
        cancelled = true;
        terminate();
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    const timeout = setTimeout(() => {
        timedOut = true;
        terminate();
    }, timeoutMs);
    timeout.unref();

    try {
        const closed = await supervisor.closed;
        const stdout = Buffer.concat(stdoutChunks).toString('utf8');
        const stderr = Buffer.concat(stderrChunks).toString('utf8');
        const success =
            closed.exitCode === 0 &&
            closed.signal === null &&
            spawnError === null &&
            !cancelled &&
            !timedOut &&
            !outputLimitExceeded;
        const error = success
            ? undefined
            : (spawnError ??
              (cancelled
                  ? abortMessage(opts.signal, 'Git execution cancelled.')
                  : timedOut
                    ? `Git execution timed out after ${timeoutMs}ms.`
                    : outputLimitExceeded
                      ? `Git output exceeded ${maxBufferBytes} bytes.`
                      : stderr.trim() ||
                        (closed.signal
                            ? `Git process terminated by ${closed.signal}.`
                            : `Git process exited with code ${String(closed.exitCode)}.`)));
        return Object.freeze({
            success,
            stdout,
            stderr,
            ...(error ? { error } : {}),
            exitCode: closed.exitCode,
            signal: closed.signal,
            cancelled,
            timedOut,
            outputLimitExceeded,
        });
    } finally {
        clearTimeout(timeout);
        opts.signal?.removeEventListener('abort', onAbort);
        supervisor.cancelEscalation();
    }
}

/** @param {AbortSignal | undefined} signal @param {string} fallback */
function abortMessage(signal, fallback) {
    const reason = signal?.reason;
    return reason instanceof Error ? reason.message : reason === undefined ? fallback : String(reason);
}

/** @param {unknown} value @param {number} fallback @param {number} min @param {number} max */
function normalizeBoundedInteger(value, fallback, min, max) {
    const parsed = Number(value ?? fallback);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.trunc(parsed)));
}
