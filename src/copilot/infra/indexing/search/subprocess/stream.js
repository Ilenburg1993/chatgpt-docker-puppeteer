// @ts-check
/** Bounded line-streaming subprocess execution with early-stop support. */

import { concatBufferViews, toOwnedBuffer } from '#copilot/infra/internal/platform';
import { spawn } from 'node:child_process';
import {
    makeSearchExitError,
    makeSearchRuntimeError,
    normalizeMaxBuffer,
    normalizeSearchArgs,
    normalizeSearchExecutable,
    normalizeTimeout,
    terminateSearchChild,
} from './support.js';

/** @typedef {import('./types.js').SearchStreamingSubprocessOptions} SearchStreamingSubprocessOptions */

/**
 * Executa um binário de busca processando stdout por linha.
 *
 * Quando `onStdoutLine` retorna `false`, o subprocesso é encerrado com sucesso via `SIGTERM`. Isso permite que callers
 * façam early stop depois de sanitizar/paginar sem materializar todo o stdout.
 *
 * @param {string} file
 * @param {readonly string[]} args
 * @param {SearchStreamingSubprocessOptions} [options]
 * @returns {Promise<{ stdout: string; stderr: string; stoppedEarly: boolean }>}
 */
export async function streamSearchFile(file, args, options = {}) {
    const executable = normalizeSearchExecutable(file);
    const normalizedArgs = normalizeSearchArgs(args);
    const maxBuffer = normalizeMaxBuffer(options.maxBuffer);
    const timeoutMs = normalizeTimeout(options.timeout);
    const collectStdout = options.collectStdout !== false;

    return new Promise((resolve, reject) => {
        /** @type {string[]} */
        const stdoutLines = [];
        /** @type {Buffer[]} */
        const stderrChunks = [];
        let stdoutBytes = 0;
        let stderrBytes = 0;
        let settled = false;
        let stoppedEarly = false;
        let pendingStdout = '';
        const stdoutDecoder = new TextDecoder('utf-8', { fatal: true });
        /** @type {NodeJS.Timeout | null} */
        let timeoutId = null;

        const child = spawn(
            executable,
            normalizedArgs,
            /** @type {import('node:child_process').SpawnOptions} */ ({
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe'],
                ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
            }),
        );

        const decodeStdout = () => {
            const text = stdoutLines.join('\n');
            return pendingStdout ? (text ? `${text}\n${pendingStdout}` : pendingStdout) : text;
        };
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
         * @param {string} line
         * @returns {boolean}
         */
        const emitLine = (line) => {
            const keepGoing = options.onStdoutLine?.(line);
            if (collectStdout) stdoutLines.push(line);
            if (keepGoing === false) {
                stoppedEarly = true;
                terminateSearchChild(child);
                return false;
            }
            return true;
        };

        /**
         * @param {unknown} chunk
         * @returns {void}
         */
        const collectStdoutChunk = (chunk) => {
            if (settled || stoppedEarly) return;
            const buffer = toOwnedBuffer(
                typeof chunk === 'string'
                    ? chunk
                    : /** @type {Buffer | Uint8Array | ArrayBuffer | SharedArrayBuffer | DataView} */ (chunk),
            );
            stdoutBytes += buffer.byteLength;
            if (stdoutBytes > maxBuffer) {
                rejectRuntime(
                    `stdout excedeu maxBuffer (${maxBuffer} bytes) no subprocesso de busca.`,
                    'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
                );
                return;
            }
            try {
                pendingStdout += stdoutDecoder.decode(buffer, { stream: true });
            } catch {
                rejectRuntime('stdout contém bytes inválidos para UTF-8.', 'EUTF8SEARCHOUTPUT');
                return;
            }
            let lineStart = 0;
            while (true) {
                const newlineIndex = pendingStdout.indexOf('\n', lineStart);
                if (newlineIndex < 0) break;
                const line = pendingStdout.slice(lineStart, newlineIndex);
                lineStart = newlineIndex + 1;
                if (!emitLine(line)) {
                    pendingStdout = '';
                    return;
                }
            }
            if (lineStart > 0) pendingStdout = pendingStdout.slice(lineStart);
        };

        /**
         * @param {unknown} chunk
         * @returns {void}
         */
        const collectStderrChunk = (chunk) => {
            if (settled) return;
            const buffer = toOwnedBuffer(
                typeof chunk === 'string'
                    ? chunk
                    : /** @type {Buffer | Uint8Array | ArrayBuffer | SharedArrayBuffer | DataView} */ (chunk),
            );
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

        child.stdout?.on('data', collectStdoutChunk);
        child.stderr?.on('data', collectStderrChunk);

        child.once('error', (error) => {
            finish(() => reject(error));
        });

        child.once('close', (status, signal) => {
            if (settled) return;
            if (!stoppedEarly) {
                try {
                    pendingStdout += stdoutDecoder.decode();
                } catch {
                    rejectRuntime('stdout contém sequência UTF-8 truncada.', 'EUTF8SEARCHOUTPUT');
                    return;
                }
                if (pendingStdout) {
                    emitLine(pendingStdout);
                    pendingStdout = '';
                }
            }
            const stdout = decodeStdout();
            const stderr = decodeStderr();
            if (stoppedEarly || status === 0) {
                finish(() => resolve({ stdout, stderr, stoppedEarly }));
                return;
            }
            finish(() => reject(makeSearchExitError(executable, normalizedArgs, status, signal, stdout, stderr)));
        });
    });
}
