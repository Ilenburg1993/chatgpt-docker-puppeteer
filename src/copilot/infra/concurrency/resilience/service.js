// @ts-check
/** Generic bounded retry/timeout primitives. Domain retry policy remains with the domain. */
import { setTimeout as sleepTimer } from 'node:timers/promises';

export class OperationTimeoutError extends Error {
    /** @param {string} label @param {number} timeoutMs */
    constructor(label, timeoutMs) {
        super(`${label} timed out after ${timeoutMs}ms`);
        this.name = 'OperationTimeoutError';
        this.code = 'ERR_OPERATION_TIMEOUT';
        this.timeoutMs = timeoutMs;
    }
}

/** @param {unknown} value @param {string} name @param {{minimum?:number;allowZero?:boolean}} [policy] */
function boundedNumber(value, name, policy = {}) {
    const numeric = Number(value);
    const minimum = policy.minimum ?? (policy.allowZero ? 0 : 1);
    if (!Number.isFinite(numeric) || numeric < minimum)
        throw new RangeError(`${name} must be a finite number >= ${minimum}.`);
    return numeric;
}

/** @param {unknown} reason @param {string} fallback */
function normalizeAbortReason(reason, fallback) {
    if (reason instanceof Error) return reason;
    return new Error(reason == null ? fallback : String(reason));
}

/** @param {number} delayMs @param {AbortSignal|undefined} signal @param {(callback:()=>void,ms:number)=>ReturnType<typeof setTimeout>} setTimer @param {(handle:ReturnType<typeof setTimeout>)=>void} clearTimer */
function abortableDelay(delayMs, signal, setTimer, clearTimer) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(normalizeAbortReason(signal.reason, 'Retry aborted'));
            return;
        }
        /** @type {ReturnType<typeof setTimeout>|null} */ let timer = null;
        const cleanup = () => {
            if (timer) clearTimer(timer);
            signal?.removeEventListener('abort', onAbort);
        };
        const onAbort = () => {
            cleanup();
            reject(normalizeAbortReason(signal?.reason, 'Retry aborted'));
        };
        timer = setTimer(() => {
            cleanup();
            resolve(undefined);
        }, delayMs);
        timer.unref?.();
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{maxAttempts?:number;baseDelayMs?:number;maxDelayMs?:number;jitter?:boolean;signal?:AbortSignal;shouldRetry?:(error:unknown,attempt:number)=>boolean;onRetry?:(error:unknown,attempt:number)=>void;random?:()=>number;setTimer?:(callback:()=>void,ms:number)=>ReturnType<typeof setTimeout>;clearTimer?:(handle:ReturnType<typeof setTimeout>)=>void}} [options]
 */
export async function withRetry(fn, options = {}) {
    if (typeof fn !== 'function') throw new TypeError('withRetry requires a function.');
    const maxAttempts = Math.trunc(boundedNumber(options.maxAttempts ?? 3, 'maxAttempts'));
    const baseDelayMs = boundedNumber(options.baseDelayMs ?? 200, 'baseDelayMs', { allowZero: true });
    const maxDelayMs = boundedNumber(options.maxDelayMs ?? 10_000, 'maxDelayMs', { allowZero: true });
    if (maxDelayMs < baseDelayMs) throw new RangeError('maxDelayMs must be >= baseDelayMs.');
    const random = options.random ?? Math.random;
    const setTimer = options.setTimer ?? setTimeout;
    const clearTimer = options.clearTimer ?? clearTimeout;
    const shouldRetry = options.shouldRetry ?? (() => true);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        if (options.signal?.aborted) throw options.signal.reason ?? new Error('Retry aborted');
        try {
            return await fn();
        } catch (error) {
            if (attempt >= maxAttempts || !shouldRetry(error, attempt)) throw error;
            options.onRetry?.(error, attempt);
            const exponential = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
            const delay = options.jitter === false ? exponential : exponential + random() * exponential * 0.5;
            await abortableDelay(delay, options.signal, setTimer, clearTimer);
        }
    }
    throw new Error('withRetry exhausted without result.');
}

/**
 * @template T
 * @param {(signal:AbortSignal)=>Promise<T>} fn
 * @param {number} timeoutMs
 * @param {string} [label='operation']
 */
export async function withTimeout(fn, timeoutMs, label = 'operation') {
    if (typeof fn !== 'function') throw new TypeError('withTimeout requires a function.');
    const duration = boundedNumber(timeoutMs, 'timeoutMs', { allowZero: true });
    const controller = new AbortController();
    const timeoutError = new OperationTimeoutError(label, duration);
    const timer = setTimeout(() => controller.abort(timeoutError), duration);
    timer.unref?.();
    /** @type {() => void} */ let detach = () => {};
    try {
        const timeout = new Promise((_, reject) => {
            const onAbort = () => reject(normalizeAbortReason(controller.signal.reason, timeoutError.message));
            if (controller.signal.aborted) {
                onAbort();
                return;
            }
            controller.signal.addEventListener('abort', onAbort, { once: true });
            detach = () => controller.signal.removeEventListener('abort', onAbort);
        });
        return /** @type {T} */ (await Promise.race([fn(controller.signal), timeout]));
    } finally {
        detach();
        clearTimeout(timer);
    }
}

/**
 * Pure abortable delay. It does not register process-global state; the returned Promise is the entire resource.
 * @param {number} delayMs
 * @param {{signal?:AbortSignal;ref?:boolean}} [options]
 */
export async function sleep(delayMs, options = {}) {
    const duration = boundedNumber(delayMs, 'delayMs', { allowZero: true });
    if (duration === 0) return;
    await sleepTimer(duration, undefined, {
        ref: options.ref === true,
        ...(options.signal ? { signal: options.signal } : {}),
    });
}
