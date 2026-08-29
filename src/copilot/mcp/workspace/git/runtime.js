// @ts-check
/**
 * Governed Git execution adapter for the MCP workspace.
 *
 * Physical subprocess IO is owned by infra/process/execution. This adapter owns only Git-specific bounded defaults,
 * explicit workspace/config authority and Git-oriented failure text. No tool/schema policy belongs here.
 *
 * @module copilot/mcp/workspace/git/runtime
 */

import { executeBufferedProcess } from '#copilot/infra/public/process/execution';

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
    if (typeof opts.cwd !== 'string' || opts.cwd.length === 0) {
        throw new TypeError('Workspace Git execution requires an explicit cwd authority.');
    }
    if (!Array.isArray(args)) throw new TypeError('Workspace Git execution requires an argument array.');
    const timeoutMs = normalizeBoundedInteger(opts.timeoutMs, DEFAULT_GIT_TIMEOUT_MS, 1, MAX_GIT_TIMEOUT_MS);
    const maxBufferBytes = normalizeBoundedInteger(
        opts.maxBufferBytes,
        DEFAULT_GIT_MAX_BUFFER_BYTES,
        1024,
        MAX_GIT_BUFFER_BYTES,
    );

    const result = await executeBufferedProcess('git', args, {
        cwd: opts.cwd,
        env: opts.config.childEnvironment,
        timeoutMs,
        maxBufferBytes,
        processGroup: true,
        terminationGraceMs: TERMINATION_GRACE_MS,
        ...(opts.signal ? { signal: opts.signal } : {}),
    });
    if (result.success) {
        return Object.freeze({
            success: true,
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            signal: result.signal,
            cancelled: false,
            timedOut: false,
            outputLimitExceeded: false,
        });
    }

    const error = result.spawnError
        ? result.spawnError
        : result.cancelled
          ? abortMessage(opts.signal, 'Git execution cancelled.')
          : result.timedOut
            ? `Git execution timed out after ${String(timeoutMs)}ms.`
            : result.outputLimitExceeded
              ? `Git output exceeded ${String(maxBufferBytes)} bytes.`
              : result.stderr.trim() ||
                (result.signal
                    ? `Git process terminated by ${result.signal}.`
                    : `Git process exited with code ${String(result.exitCode)}.`);
    return Object.freeze({
        success: false,
        stdout: result.stdout,
        stderr: result.stderr,
        error,
        exitCode: result.exitCode,
        signal: result.signal,
        cancelled: result.cancelled,
        timedOut: result.timedOut,
        outputLimitExceeded: result.outputLimitExceeded,
    });
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
