// @ts-check
/**
 * Generic bounded buffered subprocess execution.
 *
 * Physical process IO lives here: spawn, stdout/stderr capture, cancellation, timeout, output-limit termination and
 * observed close. Callers must provide an explicit environment and own all command/application policy.
 *
 * @module copilot/infra/process/execution/buffered
 */

import { createBoundedProcessOutputCapture } from '../../platform/process-output/index.js';
import { createAttachedChildProcessSupervisor } from '../supervision/index.js';
import { spawn } from 'node:child_process';

export const DEFAULT_BUFFERED_PROCESS_TIMEOUT_MS = 15_000;
export const DEFAULT_BUFFERED_PROCESS_MAX_BYTES = 2 * 1024 * 1024;
export const MAX_BUFFERED_PROCESS_TIMEOUT_MS = 60 * 60_000;
export const MAX_BUFFERED_PROCESS_MAX_BYTES = 64 * 1024 * 1024;

/**
 * @typedef {Readonly<{
 *   success:boolean;
 *   stdout:string;
 *   stderr:string;
 *   exitCode:number|null;
 *   signal:NodeJS.Signals|null;
 *   cancelled:boolean;
 *   timedOut:boolean;
 *   outputLimitExceeded:boolean;
 *   spawnError:string|null;
 * }>} BufferedProcessExecutionResult
 */

/** @param {unknown} value @param {string} label */
function requireProcessString(value, label) {
    if (typeof value !== 'string' || value.length === 0 || value.includes('\u0000')) {
        throw new TypeError(`${label} must be a non-empty NUL-free string.`);
    }
    return value;
}

/** @param {unknown} args */
function normalizeArgs(args) {
    if (!Array.isArray(args)) throw new TypeError('Buffered process args must be an array of strings.');
    return args.map((arg, index) => requireProcessString(arg, `args[${String(index)}]`));
}

/** @param {unknown} value @param {number|null} fallback */
function normalizeTimeout(value, fallback) {
    if (value === undefined) return fallback;
    if (value === null || value === 0) return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) throw new RangeError('Buffered process timeout must be null/0 or >= 1ms.');
    return Math.min(MAX_BUFFERED_PROCESS_TIMEOUT_MS, Math.trunc(parsed));
}

/** @param {unknown} value */
function normalizeMaxBytes(value) {
    const parsed = Number(value ?? DEFAULT_BUFFERED_PROCESS_MAX_BYTES);
    if (!Number.isFinite(parsed) || parsed < 1) throw new RangeError('Buffered process maxBufferBytes must be >= 1.');
    return Math.min(MAX_BUFFERED_PROCESS_MAX_BYTES, Math.trunc(parsed));
}

/**
 * @param {string} executable
 * @param {readonly string[]} args
 * @param {{
 *   cwd?:string;
 *   env:Readonly<NodeJS.ProcessEnv>;
 *   signal?:AbortSignal;
 *   timeoutMs?:number|null;
 *   maxBufferBytes?:number;
 *   processGroup?:boolean;
 *   terminationGraceMs?:number;
 * }} options
 * @returns {Promise<BufferedProcessExecutionResult>}
 */
export async function executeBufferedProcess(executable, args, options) {
    const command = requireProcessString(executable, 'executable');
    const normalizedArgs = normalizeArgs(args);
    if (!options || !options.env || typeof options.env !== 'object') {
        throw new TypeError('Buffered process execution requires an explicit environment projection.');
    }
    const cwd = options.cwd === undefined ? undefined : requireProcessString(options.cwd, 'cwd');
    const timeoutMs = normalizeTimeout(options.timeoutMs, DEFAULT_BUFFERED_PROCESS_TIMEOUT_MS);
    const maxBufferBytes = normalizeMaxBytes(options.maxBufferBytes);
    if (options.signal?.aborted) {
        return Object.freeze({
            success: false,
            stdout: '',
            stderr: '',
            exitCode: null,
            signal: null,
            cancelled: true,
            timedOut: false,
            outputLimitExceeded: false,
            spawnError: null,
        });
    }

    const stdoutCapture = createBoundedProcessOutputCapture({ maxBytes: maxBufferBytes, mode: 'head' });
    const stderrCapture = createBoundedProcessOutputCapture({ maxBytes: maxBufferBytes, mode: 'head' });
    let cancelled = false;
    let timedOut = false;
    let outputLimitExceeded = false;
    /** @type {string | null} */
    let spawnError = null;

    const child = spawn(command, normalizedArgs, {
        ...(cwd === undefined ? {} : { cwd }),
        env: { ...options.env },
        detached: options.processGroup !== false && process.platform !== 'win32',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const supervisor = createAttachedChildProcessSupervisor(child, { processGroup: options.processGroup !== false });

    /** @param {'stdout'|'stderr'} stream @param {unknown} chunk */
    const collect = (stream, chunk) => {
        const capture = stream === 'stdout' ? stdoutCapture : stderrCapture;
        const result = capture.append(
            /** @type {string|Buffer|Uint8Array|ArrayBuffer|SharedArrayBuffer|DataView} */ (chunk),
        );
        if (!result.truncated || outputLimitExceeded) return;
        outputLimitExceeded = true;
        supervisor.requestTermination({
            ...(options.terminationGraceMs === undefined ? {} : { graceMs: options.terminationGraceMs }),
            initialSignal: 'SIGTERM',
            forceSignal: 'SIGKILL',
        });
    };

    child.stdout?.on('data', (chunk) => collect('stdout', chunk));
    child.stderr?.on('data', (chunk) => collect('stderr', chunk));
    child.once('error', (error) => {
        spawnError = error instanceof Error ? error.message : String(error);
    });

    /** @param {'abort'|'timeout'} reason */
    const terminate = (reason) => {
        if (reason === 'abort') cancelled = true;
        else timedOut = true;
        supervisor.requestTermination({
            ...(options.terminationGraceMs === undefined ? {} : { graceMs: options.terminationGraceMs }),
            initialSignal: 'SIGTERM',
            forceSignal: 'SIGKILL',
        });
    };
    const onAbort = () => terminate('abort');
    options.signal?.addEventListener('abort', onAbort, { once: true });
    /** @type {NodeJS.Timeout | null} */
    let timeout = null;
    if (timeoutMs !== null) {
        timeout = setTimeout(() => terminate('timeout'), timeoutMs);
        timeout.unref();
    }

    try {
        const closed = await supervisor.closed;
        const stdout = stdoutCapture.toString();
        const stderr = stderrCapture.toString();
        return Object.freeze({
            success:
                closed.exitCode === 0 &&
                closed.signal === null &&
                !cancelled &&
                !timedOut &&
                !outputLimitExceeded &&
                spawnError === null,
            stdout,
            stderr,
            exitCode: closed.exitCode,
            signal: closed.signal,
            cancelled,
            timedOut,
            outputLimitExceeded,
            spawnError,
        });
    } finally {
        if (timeout) clearTimeout(timeout);
        options.signal?.removeEventListener('abort', onAbort);
        supervisor.cancelEscalation();
    }
}
