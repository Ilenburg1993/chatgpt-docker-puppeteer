// @ts-check
/** Validation, errors and child termination policy shared by search subprocess modes. */

const DEFAULT_SEARCH_SUBPROCESS_MAX_BUFFER_BYTES = 1024 * 1024;
const SEARCH_SUBPROCESS_KILL_GRACE_MS = 3_000;

/**
 * Envia SIGTERM e escala para SIGKILL se o processo não fechar dentro da janela de graça.
 *
 * @param {import('node:child_process').ChildProcess} child
 * @returns {void}
 */
export function terminateSearchChild(child) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    const killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }, SEARCH_SUBPROCESS_KILL_GRACE_MS);
    killTimer.unref?.();
    child.once('close', () => clearTimeout(killTimer));
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeSearchExecutable(value) {
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
export function normalizeSearchArgs(args) {
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
export function normalizeMaxBuffer(maxBuffer) {
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
export function normalizeTimeout(timeout) {
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
export function makeSearchExitError(file, args, status, signal, stdout, stderr) {
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
export function makeSearchRuntimeError(message, stdout, stderr, code) {
    const error = /** @type {Error & { code?: string; stdout?: string; stderr?: string; killed?: boolean }} */ (
        new Error(message)
    );
    error.code = code;
    error.stdout = stdout;
    error.stderr = stderr;
    error.killed = true;
    return error;
}
