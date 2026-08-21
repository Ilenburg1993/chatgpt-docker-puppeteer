// @ts-check
/** Instance-owned synchronous local coherence bus plus debounced cross-process replication. */
import { invalidateIoPathPolicyCache, registerShutdownHandler, SHUTDOWN_PRIORITY } from '#copilot/core';
import { normalizeIoInvalidationEvent } from './events.js';
/** @typedef {import('./events.js').IoInvalidationEvent} IoInvalidationEvent */

/**
 * @param {{
 *   l1:{invalidate:(filePath:string,options?:{recursive?:boolean})=>void};
 *   l2:{get:()=>({invalidatePath:(filePath:string)=>unknown}|null)};
 *   crossProcess:{publish:(filePath:string,event?:IoInvalidationEvent)=>boolean;start:(hook:(filePath:string,event:{recursive:boolean;source:string;sequence:number;createdAtMs:number})=>void)=>()=>void;stop:()=>void;stats:()=>Record<string,unknown>};
 *   runtimeId?:string;
 *   debounceMs?:number;
 *   registerProcessShutdown?:boolean;
 * }} options
 */
export function createIoInvalidationBusRuntime(options) {
    if (!options?.l1 || !options?.l2 || !options?.crossProcess)
        throw new TypeError('createIoInvalidationBusRuntime requires l1, l2 and crossProcess runtimes.');
    const runtimeId = options.runtimeId ?? 'io-invalidation-runtime';
    const isTestRuntime =
        process.env['VITEST'] === 'true' || process.env['NODE_ENV'] === 'test' || process.env['NODE_ENV'] === 'testing';
    const debounceMs = Math.max(
        0,
        Number.isFinite(options.debounceMs)
            ? Number(options.debounceMs)
            : Number(process.env['IO_INVALIDATION_DEBOUNCE_MS'] ?? (isTestRuntime ? 0 : 50)),
    );
    /** @type {((filePath:string,event:ReturnType<typeof normalizeIoInvalidationEvent>)=>void)[]} */ const hooks = [];
    /** @type {Map<string,ReturnType<typeof normalizeIoInvalidationEvent>>} */ const pending = new Map();
    /** @type {Map<string,{source:string;atMs:number}>} */ const recent = new Map();
    const stats = {
        localDispatches: 0,
        replicationQueued: 0,
        replicationCoalesced: 0,
        replicationFlushes: 0,
        replicationPublished: 0,
    };
    /** @type {NodeJS.Timeout|null} */ let timer = null;
    /** @type {(()=>void)|null} */ let stopConsumer = null;
    let shutdownRegistered = false;
    let disposed = false;
    const MAX_RECENT = 2048;

    /** @param {ReturnType<typeof normalizeIoInvalidationEvent>|undefined} previous @param {ReturnType<typeof normalizeIoInvalidationEvent>} next */
    const merge = (previous, next) => ({ ...next, recursive: Boolean(previous?.recursive || next.recursive) });

    /** @param {string} filePath @param {ReturnType<typeof normalizeIoInvalidationEvent>} event */
    function dispatchLocal(filePath, event) {
        stats.localDispatches += 1;
        try {
            options.l1.invalidate(filePath, { recursive: event.recursive });
        } catch {
            // Best-effort cache invalidation.
        }
        try {
            options.l2.get()?.invalidatePath(filePath);
        } catch {
            // Best-effort durable-cache invalidation.
        }
        try {
            invalidateIoPathPolicyCache(filePath, { recursive: event.recursive });
        } catch {
            // Process policy cache is process coordination state and remains best effort.
        }
        recent.delete(filePath);
        recent.set(filePath, { source: event.source, atMs: Date.now() });
        while (recent.size > MAX_RECENT) {
            const oldest = recent.keys().next().value;
            if (typeof oldest !== 'string') break;
            recent.delete(oldest);
        }
        for (const hook of [...hooks]) {
            try {
                hook(filePath, event);
            } catch {
                // Derived-state hooks never fail canonical mutations.
            }
        }
    }
    function flush() {
        if (timer) clearTimeout(timer);
        timer = null;
        if (pending.size === 0) return 0;
        const batch = [...pending.entries()];
        pending.clear();
        stats.replicationFlushes += 1;
        for (const [filePath, event] of batch) {
            if (options.crossProcess.publish(filePath, event)) stats.replicationPublished += 1;
        }
        return batch.length;
    }
    function ensureConsumer() {
        if (stopConsumer || disposed) return;
        stopConsumer = options.crossProcess.start((filePath, event) => {
            dispatchLocal(filePath, normalizeIoInvalidationEvent(event));
        });
    }
    function ensureShutdown() {
        if (!options.registerProcessShutdown || shutdownRegistered) return;
        shutdownRegistered = true;
        registerShutdownHandler(
            `copilot-infra.invalidation.${runtimeId}.flush-stop`,
            async () => api.dispose(),
            SHUTDOWN_PRIORITY.CACHE_PERSISTENCE,
        );
    }
    /** @param {string} filePath @param {IoInvalidationEvent} [event] */
    function publish(filePath, event = {}) {
        if (disposed) return;
        ensureShutdown();
        ensureConsumer();
        const normalized = normalizeIoInvalidationEvent(event);
        dispatchLocal(filePath, normalized);
        if (!(debounceMs > 0)) {
            if (options.crossProcess.publish(filePath, normalized)) stats.replicationPublished += 1;
            return;
        }
        const previous = pending.get(filePath);
        if (previous) stats.replicationCoalesced += 1;
        else stats.replicationQueued += 1;
        pending.set(filePath, merge(previous, normalized));
        if (!timer) {
            timer = setTimeout(flush, debounceMs);
            timer.unref?.();
        }
    }
    /** @param {(filePath:string,event:ReturnType<typeof normalizeIoInvalidationEvent>)=>void} hook */
    function registerHook(hook) {
        if (disposed) throw new Error(`IoInvalidationBusRuntime(${runtimeId}) is disposed.`);
        ensureShutdown();
        ensureConsumer();
        hooks.push(hook);
        return () => {
            const index = hooks.indexOf(hook);
            if (index !== -1) hooks.splice(index, 1);
        };
    }
    function snapshot() {
        return Object.freeze({
            runtimeId,
            hooks: hooks.length,
            pending: pending.size,
            pendingReplications: pending.size,
            debounceMs,
            ...stats,
            crossProcess: options.crossProcess.stats(),
            disposed,
        });
    }
    function reset() {
        if (timer) clearTimeout(timer);
        timer = null;
        hooks.length = 0;
        pending.clear();
        recent.clear();
        Object.assign(stats, {
            localDispatches: 0,
            replicationQueued: 0,
            replicationCoalesced: 0,
            replicationFlushes: 0,
            replicationPublished: 0,
        });
        stopConsumer?.();
        stopConsumer = null;
    }
    const api = Object.freeze({
        runtimeId,
        publish,
        registerHook,
        flush,
        snapshot,
        /** @param {string} filePath */
        recent(filePath) {
            return recent.get(filePath) ?? null;
        },
        /** @param {string} filePath @param {IoInvalidationEvent} [event] */
        invalidatePath(filePath, event = {}) {
            publish(filePath, { ...event, recursive: false, source: event.source ?? 'io-coherence' });
        },
        /** @param {string} filePath @param {IoInvalidationEvent} [event] */
        invalidateSubtree(filePath, event = {}) {
            publish(filePath, { ...event, recursive: true, source: event.source ?? 'io-coherence' });
        },
        reset,
        dispose() {
            if (disposed) return;
            flush();
            reset();
            options.crossProcess.stop();
            disposed = true;
        },
    });
    return api;
}
