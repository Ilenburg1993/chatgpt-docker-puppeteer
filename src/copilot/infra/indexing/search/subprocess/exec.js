// @ts-check
/** Bounded buffered subprocess adapter for local search commands. */

import { executeBufferedProcess } from '../../../process/execution/index.js';
import {
    makeSearchExitError,
    makeSearchRuntimeError,
    normalizeMaxBuffer,
    normalizeSearchArgs,
    normalizeSearchExecutable,
    normalizeTimeout,
    resolveSearchSpawnEnvironment,
} from './support.js';

/** @typedef {import('./types.js').SearchSubprocessOptions} SearchSubprocessOptions */

/**
 * Execute one search binary through the generic infra buffered-process owner while preserving the historical search
 * adapter API/error taxonomy. Streaming/early-stop search remains a distinct specialized owner.
 *
 * @param {string} file
 * @param {readonly string[]} args
 * @param {SearchSubprocessOptions} [options]
 * @returns {Promise<{ stdout: string; stderr: string }>}
 */
export async function execSearchFile(file, args, options = {}) {
    const executable = normalizeSearchExecutable(file);
    const normalizedArgs = normalizeSearchArgs(args);
    const maxBuffer = normalizeMaxBuffer(options.maxBuffer);
    const timeoutMs = normalizeTimeout(options.timeout);
    const environment = resolveSearchSpawnEnvironment(executable, options.env);

    const result = await executeBufferedProcess(executable, normalizedArgs, {
        env: environment,
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        timeoutMs,
        maxBufferBytes: maxBuffer,
        processGroup: false,
        terminationGraceMs: 3_000,
    });
    if (result.success) return { stdout: result.stdout, stderr: result.stderr };

    if (result.cancelled) {
        throw makeSearchRuntimeError('Subprocesso de busca abortado.', result.stdout, result.stderr, 'ABORT_ERR');
    }
    if (result.timedOut) {
        throw makeSearchRuntimeError(
            `Subprocesso de busca excedeu timeout (${String(timeoutMs)}ms).`,
            result.stdout,
            result.stderr,
            'ETIMEDOUT',
        );
    }
    if (result.outputLimitExceeded) {
        throw makeSearchRuntimeError(
            `stdout/stderr excedeu maxBuffer (${String(maxBuffer)} bytes) no subprocesso de busca.`,
            result.stdout,
            result.stderr,
            'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
        );
    }
    if (result.spawnError) {
        const error = /** @type {Error & {stdout?:string;stderr?:string}} */ (new Error(result.spawnError));
        error.stdout = result.stdout;
        error.stderr = result.stderr;
        throw error;
    }
    throw makeSearchExitError(
        executable,
        normalizedArgs,
        result.exitCode,
        result.signal,
        result.stdout,
        result.stderr,
    );
}
