// @ts-check
/** Bounded buffered subprocess execution for local search adapters. */

import { concatBufferViews, toOwnedBuffer } from '#copilot/infra/internal/platform/buffer';
import { spawn } from 'node:child_process';
import {
    makeSearchExitError,
    makeSearchRuntimeError,
    normalizeMaxBuffer,
    normalizeSearchArgs,
    normalizeSearchExecutable,
    normalizeTimeout,
    resolveSearchSpawnEnvironment,
    terminateSearchChild,
} from './support.js';

/** @typedef {import('./types.js').SearchSubprocessOptions} SearchSubprocessOptions */

/**
 * Executa um binário de busca com argumentos já normalizados pelo adapter chamador.
 *
 * Usa `spawn` e coleta stdout/stderr com limite explícito para evitar que um `execFile` bufferize grandes resultados
 * antes de a IO conseguir reagir.
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

    return new Promise((resolve, reject) => {
        /** @type {Buffer[]} */
        const stdoutChunks = [];
        /** @type {Buffer[]} */
        const stderrChunks = [];
        let stdoutBytes = 0;
        let stderrBytes = 0;
        let settled = false;
        /** @type {NodeJS.Timeout | null} */
        let timeoutId = null;

        const spawnOptions = {
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: environment,
            ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
        };
        const child = spawn(
            executable,
            normalizedArgs,
            /** @type {import('node:child_process').SpawnOptions} */ (spawnOptions),
        );

        const decodeStdout = () => concatBufferViews(stdoutChunks, stdoutBytes).toString('utf8');
        const decodeStderr = () => concatBufferViews(stderrChunks, stderrBytes).toString('utf8');

        /** @returns {void} */
        const cleanup = () => {
            if (timeoutId) clearTimeout(timeoutId);
            options.signal?.removeEventListener('abort', onAbort);
        };

        /**
         * @param {() => void} callback
         * @returns {void}
         */
        const finish = (callback) => {
            if (settled) return;
            settled = true;
            cleanup();
            callback();
        };

        /**
         * @param {string} message
         * @param {string} code
         * @returns {void}
         */
        const rejectRuntime = (message, code) => {
            if (settled) return;
            const stdout = decodeStdout();
            const stderr = decodeStderr();
            terminateSearchChild(child);
            finish(() => reject(makeSearchRuntimeError(message, stdout, stderr, code)));
        };

        /** @returns {void} */
        const onAbort = () => {
            rejectRuntime('Subprocesso de busca abortado.', 'ABORT_ERR');
        };

        /**
         * @param {'stdout' | 'stderr'} target
         * @param {unknown} chunk
         * @returns {void}
         */
        const collect = (target, chunk) => {
            if (settled) return;
            const buffer = toOwnedBuffer(
                typeof chunk === 'string'
                    ? chunk
                    : /** @type {Buffer | Uint8Array | ArrayBuffer | SharedArrayBuffer | DataView} */ (chunk),
            );
            if (target === 'stdout') {
                stdoutBytes += buffer.byteLength;
                if (stdoutBytes > maxBuffer) {
                    rejectRuntime(
                        `stdout excedeu maxBuffer (${maxBuffer} bytes) no subprocesso de busca.`,
                        'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
                    );
                    return;
                }
                stdoutChunks.push(buffer);
                return;
            }
            stderrBytes += buffer.byteLength;
            if (stderrBytes > maxBuffer) {
                rejectRuntime(
                    `stderr excedeu maxBuffer (${maxBuffer} bytes) no subprocesso de busca.`,
                    'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
                );
                return;
            }
            stderrChunks.push(buffer);
        };

        if (options.signal?.aborted) {
            onAbort();
            return;
        }
        options.signal?.addEventListener('abort', onAbort, { once: true });

        if (timeoutMs !== null) {
            timeoutId = setTimeout(() => {
                rejectRuntime(`Subprocesso de busca excedeu timeout (${timeoutMs}ms).`, 'ETIMEDOUT');
            }, timeoutMs);
            timeoutId.unref?.();
        }

        child.stdout?.on('data', (chunk) => collect('stdout', chunk));
        child.stderr?.on('data', (chunk) => collect('stderr', chunk));

        child.once('error', (error) => {
            finish(() => reject(error));
        });

        child.once('close', (status, signal) => {
            const stdout = decodeStdout();
            const stderr = decodeStderr();
            if (status === 0) {
                finish(() => resolve({ stdout, stderr }));
                return;
            }
            finish(() => reject(makeSearchExitError(executable, normalizedArgs, status, signal, stdout, stderr)));
        });
    });
}
