// @ts-check
/**
 * Porta baixa para subprocessos de busca local.
 *
 * Mantém a engine canônica afastada dos detalhes de `child_process` e concentra caches de disponibilidade/execução
 * usados por adapters como rg e grep.
 *
 * @module copilot/infra/io/search/subprocess
 */

import { spawn } from 'node:child_process';
import { concatBufferViews, toOwnedBuffer } from '../../shared/buffer.js';

const DEFAULT_SEARCH_SUBPROCESS_MAX_BUFFER_BYTES = 1024 * 1024;
const SEARCH_SUBPROCESS_KILL_GRACE_MS = 3_000;

/** @type {boolean | null} */
let _rgAvailable = null;

/**
 * Envia SIGTERM e escala para SIGKILL se o processo não fechar dentro da janela de graça.
 *
 * @param {import('node:child_process').ChildProcess} child
 * @returns {void}
 */
function terminateSearchChild(child) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    const killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }, SEARCH_SUBPROCESS_KILL_GRACE_MS);
    killTimer.unref?.();
    child.once('close', () => clearTimeout(killTimer));
}

/**
 * @typedef {object} SearchSubprocessOptions
 * @property {string | undefined} [cwd]
 * @property {number} [timeout]
 * @property {number} [maxBuffer]
 * @property {AbortSignal} [signal]
 */

/**
 * @typedef {SearchSubprocessOptions & {
 *     onStdoutLine?: (line: string) => boolean | void;
 *     collectStdout?: boolean;
 * }} SearchStreamingSubprocessOptions
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeSearchExecutable(value) {
    if (typeof value !== 'string' || value.trim().length === 0 || value.includes('\u0000')) {
        const error = new TypeError('Executável de busca inválido.');
        /** @type {{ code?: string }} */ (error).code = 'ERR_INVALID_ARG_VALUE';
        throw error;
    }
    return value;
}

/**
 * @param {readonly string[]} args
 * @returns {string[]}
 */
function normalizeSearchArgs(args) {
    if (!Array.isArray(args)) {
        const error = new TypeError('Argumentos de busca inválidos: esperado array de strings.');
        /** @type {{ code?: string }} */ (error).code = 'ERR_INVALID_ARG_VALUE';
        throw error;
    }
    return args.map((arg) => {
        if (typeof arg !== 'string' || arg.includes('\u0000')) {
            const error = new TypeError('Argumento de busca inválido.');
            /** @type {{ code?: string }} */ (error).code = 'ERR_INVALID_ARG_VALUE';
            throw error;
        }
        return arg;
    });
}

/**
 * @param {number | undefined} maxBuffer
 * @returns {number}
 */
function normalizeMaxBuffer(maxBuffer) {
    if (maxBuffer === undefined) return DEFAULT_SEARCH_SUBPROCESS_MAX_BUFFER_BYTES;
    if (!Number.isFinite(maxBuffer) || maxBuffer <= 0) {
        const error = new RangeError('maxBuffer de subprocesso de busca inválido.');
        /** @type {{ code?: string }} */ (error).code = 'ERR_OUT_OF_RANGE';
        throw error;
    }
    return Math.trunc(maxBuffer);
}

/**
 * @param {number | undefined} timeout
 * @returns {number | null}
 */
function normalizeTimeout(timeout) {
    if (timeout === undefined) return null;
    if (!Number.isFinite(timeout) || timeout <= 0) {
        const error = new RangeError('timeout de subprocesso de busca inválido.');
        /** @type {{ code?: string }} */ (error).code = 'ERR_OUT_OF_RANGE';
        throw error;
    }
    return Math.trunc(timeout);
}

/**
 * @param {string} file
 * @param {readonly string[]} args
 * @param {number | null} status
 * @param {NodeJS.Signals | null} signal
 * @param {string} stdout
 * @param {string} stderr
 * @returns {Error & {
 *     code?: number | string;
 *     status?: number;
 *     signal?: NodeJS.Signals;
 *     stdout?: string;
 *     stderr?: string;
 *     killed?: boolean;
 * }}
 */
function makeSearchExitError(file, args, status, signal, stdout, stderr) {
    const descriptor = [file, ...args].join(' ');
    const reason = signal ? `signal ${signal}` : `exit code ${String(status)}`;
    const error =
        /**
         * @type {Error & {
         *     code?: number | string;
         *     status?: number;
         *     signal?: NodeJS.Signals;
         *     stdout?: string;
         *     stderr?: string;
         *     killed?: boolean;
         * }}
         */ (new Error(`Comando de busca falhou (${reason}): ${descriptor}`));
    if (status !== null) {
        error.code = status;
        error.status = status;
    } else if (signal !== null) {
        error.code = signal;
        error.signal = signal;
    }
    error.stdout = stdout;
    error.stderr = stderr;
    error.killed = signal !== null;
    return error;
}

/**
 * @param {string} message
 * @param {string} stdout
 * @param {string} stderr
 * @param {string} code
 * @returns {Error & { code?: string; stdout?: string; stderr?: string; killed?: boolean }}
 */
function makeSearchRuntimeError(message, stdout, stderr, code) {
    const error = /** @type {Error & { code?: string; stdout?: string; stderr?: string; killed?: boolean }} */ (
        new Error(message)
    );
    error.code = code;
    error.stdout = stdout;
    error.stderr = stderr;
    error.killed = true;
    return error;
}

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

/**
 * Verifica e cacheia a disponibilidade de ripgrep no ambiente atual.
 *
 * @returns {Promise<boolean>}
 */
export async function isRipgrepAvailable() {
    if (_rgAvailable !== null) return _rgAvailable;
    try {
        await execSearchFile('rg', ['--version'], { timeout: 3000 });
        _rgAvailable = true;
    } catch {
        _rgAvailable = false;
    }
    return _rgAvailable;
}

/**
 * Auxiliar de teste para cenários que precisam reavaliar o binário no mesmo processo.
 *
 * @returns {void}
 */
export function resetSearchSubprocessCacheForTest() {
    _rgAvailable = null;
}
