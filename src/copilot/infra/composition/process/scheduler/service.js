// @ts-check
/** Process-owned timer scheduler. Timers are resource state, never module-global state. */

/** @typedef {'timeout'|'interval'|'external-timeout'|'external-interval'|'sleep'} ProcessTimerType */
/** @typedef {{id:string;type:ProcessTimerType;handle:ReturnType<typeof setTimeout>;registeredAt:number;settle?:()=>void}} ProcessTimerEntry */

/** @param {{processId:string;now?:()=>number}} options */
export function createProcessScheduler(options) {
    const processId = String(options?.processId ?? '').trim();
    if (!processId) throw new TypeError('createProcessScheduler requires processId.');
    const now = options.now ?? Date.now;
    /** @type {Map<string,ProcessTimerEntry>} */ const timers = new Map();
    let sleepSequence = 0;
    let state = /** @type {'active'|'disposed'} */ ('active');

    function assertActive() {
        if (state !== 'active') throw new Error(`ProcessScheduler(${processId}) is disposed.`);
    }
    /** @param {string} id */
    function normalizeId(id) {
        const value = String(id ?? '').trim();
        if (!value) throw new TypeError('Process timer id is required.');
        return value;
    }
    /** @param {ProcessTimerEntry} entry */
    function clearEntry(entry) {
        if (entry.type === 'interval' || entry.type === 'external-interval') clearInterval(entry.handle);
        else clearTimeout(entry.handle);
        timers.delete(entry.id);
        entry.settle?.();
    }
    /** @param {string} id */
    function cancel(id) {
        const entry = timers.get(id);
        if (!entry) return false;
        clearEntry(entry);
        return true;
    }
    /** @param {string} id @param {ProcessTimerType} type @param {ReturnType<typeof setTimeout>} handle @param {()=>void} [settle] */
    function store(id, type, handle, settle) {
        assertActive();
        const key = normalizeId(id);
        cancel(key);
        timers.set(key, { id: key, type, handle, registeredAt: now(), ...(settle ? { settle } : {}) });
        return handle;
    }

    const api = Object.freeze({
        processId,
        /** Existing native timer adoption is intentionally narrow; new code should use interval()/timeout().
         * @param {string} id @param {'interval'|'timeout'} type @param {ReturnType<typeof setTimeout>} handle
         */
        adopt(id, type, handle) {
            if (type !== 'interval' && type !== 'timeout')
                throw new TypeError(`Unsupported adopted timer type: ${String(type)}`);
            return store(id, type === 'interval' ? 'external-interval' : 'external-timeout', handle);
        },
        /** @param {string} id @param {Parameters<typeof setInterval>[0]} callback @param {number} delay @param  {...unknown} args */
        interval(id, callback, delay, ...args) {
            assertActive();
            const key = normalizeId(id);
            cancel(key);
            const handle = setInterval(callback, Math.max(0, Number(delay) || 0), ...args);
            handle.unref?.();
            return store(key, 'interval', handle);
        },
        /** @param {string} id @param {Parameters<typeof setTimeout>[0]} callback @param {number} delay @param  {...unknown} args */
        timeout(id, callback, delay, ...args) {
            assertActive();
            const key = normalizeId(id);
            cancel(key);
            /** @param {...unknown} callbackArgs */
            const wrapped = (...callbackArgs) => {
                timers.delete(key);
                if (typeof callback === 'function') callback(...callbackArgs);
            };
            const handle = setTimeout(wrapped, Math.max(0, Number(delay) || 0), ...args);
            handle.unref?.();
            return store(key, 'timeout', handle);
        },
        /** Cancellation settles sleep early instead of leaving a permanently pending Promise. */
        /** @param {number} delayMs @param {{id?:string;ref?:boolean;signal?:AbortSignal}} [sleepOptions] */
        sleep(delayMs, sleepOptions = {}) {
            assertActive();
            const delay = Math.max(0, Number.isFinite(delayMs) ? Math.trunc(delayMs) : 0);
            if (delay === 0 || sleepOptions.signal?.aborted) return Promise.resolve();
            const id = `${sleepOptions.id ?? 'process.sleep'}:${processId}:${now()}:${++sleepSequence}`;
            return new Promise((resolve) => {
                let settled = false;
                const settle = () => {
                    if (settled) return;
                    settled = true;
                    sleepOptions.signal?.removeEventListener('abort', onAbort);
                    resolve(undefined);
                };
                const onAbort = () => {
                    cancel(id);
                    settle();
                };
                const handle = setTimeout(() => {
                    timers.delete(id);
                    settle();
                }, delay);
                if (sleepOptions.ref !== true) handle.unref?.();
                store(id, 'sleep', handle, settle);
                sleepOptions.signal?.addEventListener('abort', onAbort, { once: true });
            });
        },
        cancel,
        cancelAll() {
            const entries = [...timers.values()];
            for (const entry of entries) clearEntry(entry);
            return entries.length;
        },
        activeCount() {
            return timers.size;
        },
        list(snapshotNow = now()) {
            return [...timers.values()]
                .map((entry) =>
                    Object.freeze({
                        id: entry.id,
                        type: entry.type,
                        registeredAt: entry.registeredAt,
                        ageMs: Math.max(0, snapshotNow - entry.registeredAt),
                    }),
                )
                .sort((a, b) => b.ageMs - a.ageMs || a.id.localeCompare(b.id));
        },
        snapshot() {
            return Object.freeze({ processId, state, activeCount: timers.size, timers: api.list() });
        },
        dispose() {
            if (state === 'disposed') return;
            state = 'disposed';
            api.cancelAll();
        },
        [Symbol.dispose]() {
            api.dispose();
        },
    });
    return api;
}
