// @ts-check
/**
 * Process-isolated façade for TypeScript semantic tools.
 *
 * O cliente do LSP nativo do TypeScript 7 permanece atrás de um worker descartável. A curta janela de ociosidade agrupa
 * requisições relacionadas e o encerramento do processo devolve integralmente seu heap ao sistema.
 */

import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const WORKER_FILE = fileURLToPath(new URL('./tsserver-worker.mjs', import.meta.url));
const DEFAULT_TIMEOUT_MS = Number(process.env['LSP_TOOL_TIMEOUT_MS'] || 15_000);
const DEFAULT_PROCESS_IDLE_TTL_MS = Number(process.env['LSP_PROCESS_IDLE_TTL_MS'] || 30_000);
const MAX_PROCESS_IDLE_TTL_MS = 10 * 60_000;
const MAX_STDERR_TAIL_BYTES = 64 * 1024;
const WORKER_STOP_GRACE_MS = 1_000;

function boundedIdleTtlMs(/** @type {unknown} */ value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return DEFAULT_PROCESS_IDLE_TTL_MS;
    return Math.max(0, Math.min(MAX_PROCESS_IDLE_TTL_MS, Math.trunc(parsed)));
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @typedef {{ rootDir?: string; timeoutMs?: number; idleTtlMs?: number }} TsserverProcessDaemonOptions
 *
 * @typedef {{ signal?: AbortSignal; timeoutMs?: number }} TsserverExecuteOptions
 */

/**
 * @param {string} message
 * @param {string} code
 * @param {Record<string, unknown>} [details]
 * @returns {Error & { code: string } & Record<string, unknown>}
 */
function errorWithCode(message, code, details = {}) {
    const error = /** @type {Error & { code: string } & Record<string, unknown>} */ (new Error(message));
    error.code = code;
    Object.assign(error, details);
    return error;
}

export class TsserverProcessDaemon {
    /** @param {TsserverProcessDaemonOptions} [options] */
    constructor(options = {}) {
        this.rootDir = String(options.rootDir || process.cwd());
        this.timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
        this.idleTtlMs = boundedIdleTtlMs(options.idleTtlMs ?? process.env['LSP_PROCESS_IDLE_TTL_MS']);
        this.requestSeq = 0;
        this.workerPid = null;
        this.stderrTail = '';
        this._child = null;
        this._readyPromise = null;
        this._readyResolve = null;
        this._readyReject = null;
        this._idleTimer = null;
        this._stopping = false;
        /**
         * @type {Map<
         *     string,
         *     {
         *         resolve: (value: unknown) => void;
         *         reject: (reason?: unknown) => void;
         *         timer: NodeJS.Timeout;
         *         cleanupAbort: () => void;
         *     }
         * >}
         */
        this._pending = new Map();
    }

    _appendStderr(/** @type {unknown} */ chunk) {
        this.stderrTail += String(chunk || '');
        const bytes = Buffer.byteLength(this.stderrTail, 'utf8');
        if (bytes <= MAX_STDERR_TAIL_BYTES) return;
        this.stderrTail = Buffer.from(this.stderrTail, 'utf8')
            .subarray(bytes - MAX_STDERR_TAIL_BYTES)
            .toString('utf8');
    }

    _clearIdleTimer() {
        if (!this._idleTimer) return;
        clearTimeout(this._idleTimer);
        this._idleTimer = null;
    }

    _scheduleIdleStop() {
        this._clearIdleTimer();
        if (!this._child || this._pending.size > 0) return;
        if (this.idleTtlMs <= 0) {
            void this.stop();
            return;
        }
        this._idleTimer = setTimeout(() => {
            this._idleTimer = null;
            void this.stop();
        }, this.idleTtlMs);
        this._idleTimer.unref?.();
    }

    _rejectPending(/** @type {unknown} */ error) {
        for (const pending of this._pending.values()) {
            clearTimeout(pending.timer);
            pending.cleanupAbort();
            pending.reject(error);
        }
        this._pending.clear();
    }

    _clearWorkerState(/** @type {import('node:child_process').ChildProcess} */ child) {
        if (this._child !== child) return;
        this._child = null;
        this.workerPid = null;
        this._readyPromise = null;
        this._readyResolve = null;
        this._readyReject = null;
    }

    async start() {
        this._clearIdleTimer();
        if (this._child && this._readyPromise) {
            await this._readyPromise;
            return {
                started: true,
                rootDir: this.rootDir,
                timeoutMs: this.timeoutMs,
                idleTtlMs: this.idleTtlMs,
                workerPid: this.workerPid,
            };
        }

        this._stopping = false;
        this.stderrTail = '';
        const child = fork(WORKER_FILE, [], {
            cwd: this.rootDir,
            // Flags such as --input-type are valid only for eval/stdin entrypoints and make a forked file fail at
            // process startup. Preserve useful parent flags while removing entrypoint-specific ones.
            execArgv: process.execArgv.filter((arg) => !arg.startsWith('--input-type')),
            env: {
                ...process.env,
                LSP_TOOL_TIMEOUT_MS: String(this.timeoutMs),
                LSP_WORKER_SERVICE_IDLE_TTL_MS: String(Math.max(60_000, this.idleTtlMs * 2)),
            },
            stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
            serialization: 'advanced',
        });
        this._child = child;
        this.workerPid = child.pid ?? null;
        child.stderr?.on('data', (chunk) => this._appendStderr(chunk));

        this._readyPromise = new Promise((resolve, reject) => {
            this._readyResolve = () => resolve(undefined);
            this._readyReject = reject;
        });

        child.on('message', (message) => {
            const payload = isRecord(message) ? message : {};
            if (payload['type'] === 'ready') {
                this.workerPid = Number(payload['pid']) || child.pid || null;
                this._readyResolve?.();
                return;
            }
            if (payload['type'] !== 'result' || typeof payload['id'] !== 'string') return;
            const pending = this._pending.get(payload['id']);
            if (!pending) return;
            this._pending.delete(payload['id']);
            clearTimeout(pending.timer);
            pending.cleanupAbort();
            if (payload['success'] === true) {
                pending.resolve(payload['result']);
            } else {
                const remote = isRecord(payload['error']) ? payload['error'] : {};
                pending.reject(
                    errorWithCode(
                        String(remote['message'] || 'TypeScript worker request failed.'),
                        'LSP_WORKER_REMOTE_ERROR',
                        { remoteName: remote['name'] },
                    ),
                );
            }
            this._scheduleIdleStop();
        });

        child.once('error', (error) => {
            this._readyReject?.(error);
            this._rejectPending(error);
        });
        child.once('exit', (code, signal) => {
            const wasStopping = this._stopping;
            const error = errorWithCode(
                `TypeScript worker exited${code === null ? '' : ` with code ${code}`}${signal ? ` (${signal})` : ''}.`,
                wasStopping ? 'LSP_WORKER_STOPPED' : 'LSP_WORKER_EXITED',
                { exitCode: code, signal, stderrTail: this.stderrTail },
            );
            if (!wasStopping) this._readyReject?.(error);
            if (this._pending.size > 0) this._rejectPending(error);
            this._clearWorkerState(child);
            this._stopping = false;
        });

        await this._readyPromise;
        return {
            started: true,
            rootDir: this.rootDir,
            timeoutMs: this.timeoutMs,
            idleTtlMs: this.idleTtlMs,
            workerPid: this.workerPid,
        };
    }

    async execute(
        /** @type {string} */ operation,
        /** @type {Record<string, unknown>} */ params = {},
        /** @type {TsserverExecuteOptions} */ options = {},
    ) {
        const startState = await this.start();
        const child = this._child;
        if (!child?.connected)
            throw errorWithCode('TypeScript worker IPC is not connected.', 'LSP_WORKER_NOT_CONNECTED');

        const externalSignal = options.signal;
        if (externalSignal?.aborted) throw errorWithCode('LSP request cancelled before dispatch.', 'LSP_CANCELLED');

        const id = `lsp-worker-${++this.requestSeq}`;
        const timeoutMs = Number(options.timeoutMs || this.timeoutMs);
        this._clearIdleTimer();

        return await new Promise((resolve, reject) => {
            /** @type {(() => void) | null} */
            let abortHandler = null;
            const cleanupAbort = () => {
                if (abortHandler && externalSignal) externalSignal.removeEventListener('abort', abortHandler);
            };
            const recycle = (/** @type {unknown} */ error) => {
                const current = this._pending.get(id);
                if (!current) return;
                this._pending.delete(id);
                clearTimeout(current.timer);
                current.cleanupAbort();
                current.reject(error);
                this._rejectPending(
                    errorWithCode('TypeScript worker recycled after cancellation/timeout.', 'LSP_WORKER_RECYCLED'),
                );
                this._terminateWorker('SIGKILL');
            };
            const timer = setTimeout(
                () => recycle(errorWithCode(`LSP request timed out after ${timeoutMs}ms.`, 'LSP_TIMEOUT')),
                timeoutMs,
            );
            timer.unref?.();
            if (externalSignal) {
                abortHandler = () => recycle(errorWithCode('LSP request cancelled.', 'LSP_CANCELLED'));
                externalSignal.addEventListener('abort', abortHandler, { once: true });
            }
            this._pending.set(id, { resolve, reject, timer, cleanupAbort });
            try {
                child.send({
                    type: 'execute',
                    id,
                    operation,
                    params,
                    timeoutMs,
                    workerPid: startState.workerPid,
                });
            } catch (error) {
                recycle(error instanceof Error ? error : new Error(String(error)));
            }
        });
    }

    _terminateWorker(/** @type {NodeJS.Signals} */ signal = 'SIGTERM') {
        const child = this._child;
        if (!child) return;
        try {
            child.kill(signal);
        } catch {
            // Process may already have exited between state inspection and signal delivery.
        }
    }

    async stop() {
        this._clearIdleTimer();
        const child = this._child;
        if (!child) return { stopped: true };
        this._stopping = true;
        this._rejectPending(errorWithCode('TypeScript worker stopped.', 'LSP_WORKER_STOPPED'));

        return await new Promise((resolve) => {
            let settled = false;
            const finish = () => {
                if (settled) return;
                settled = true;
                clearTimeout(killTimer);
                resolve({ stopped: true });
            };
            const killTimer = setTimeout(() => {
                this._terminateWorker('SIGKILL');
                finish();
            }, WORKER_STOP_GRACE_MS);
            killTimer.unref?.();
            child.once('exit', finish);
            try {
                if (child.connected) child.send({ type: 'stop' });
                else this._terminateWorker('SIGTERM');
            } catch {
                this._terminateWorker('SIGTERM');
            }
        });
    }
}

/** @type {TsserverProcessDaemon | null} */
let singleton = null;

export function getTsserverDaemon() {
    if (!singleton) {
        singleton = new TsserverProcessDaemon({
            rootDir: process.cwd(),
            timeoutMs: DEFAULT_TIMEOUT_MS,
            idleTtlMs: DEFAULT_PROCESS_IDLE_TTL_MS,
        });
    }
    return singleton;
}

/** @param {TsserverProcessDaemonOptions} [options] */
export async function startTsserverDaemon(options = {}) {
    if (String(process.env['LSP_ENABLED'] || 'false').toLowerCase() !== 'true') {
        throw new Error('LSP_DISABLED_BY_POLICY');
    }
    const daemon = getTsserverDaemon();
    if (options.timeoutMs !== undefined) daemon.timeoutMs = Number(options.timeoutMs);
    if (options.idleTtlMs !== undefined) daemon.idleTtlMs = boundedIdleTtlMs(options.idleTtlMs);
    return daemon.start();
}

export async function stopTsserverDaemon() {
    if (!singleton) return { stopped: true };
    return singleton.stop();
}
