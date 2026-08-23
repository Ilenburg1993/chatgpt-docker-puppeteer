// @ts-check
/**
 * Lightweight lazy owner for runtime mutation-audit persistence.
 *
 * Composition captures configuration exactly once, but the JSONL/persistence implementation is loaded only after the
 * first actual audit record. Read-side snapshots and teardown of an unused owner never activate persistence.
 *
 * @module copilot/infra/composition/runtime/mutation-audit-owner
 */

/** @typedef {ReturnType<typeof import('#copilot/infra/internal/operations').createIoMutationAuditRuntime>} IoMutationAuditRuntime */

/** @param {unknown} value @returns {string | null} */
function normalizeAuditPath(value) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}

/**
 * @param {{ runtimeId:string; filePath:string|null }} options
 */
export function createRuntimeMutationAuditOwner(options) {
    const runtimeId = `${options.runtimeId}:mutation-audit`;
    const filePath = normalizeAuditPath(options.filePath);
    /** @type {IoMutationAuditRuntime | null} */
    let runtime = null;
    /** @type {Promise<IoMutationAuditRuntime> | null} */
    let runtimePromise = null;
    /** @type {Promise<void> | null} */
    let disposePromise = null;
    let disposed = false;

    async function materialize() {
        if (disposed) throw new Error(`Mutation audit owner ${runtimeId} is disposed.`);
        if (runtime) return runtime;
        if (!runtimePromise) {
            runtimePromise = import('#copilot/infra/internal/operations')
                .then(({ createIoMutationAuditRuntime }) => createIoMutationAuditRuntime({ runtimeId, filePath }))
                .then((created) => {
                    runtime = created;
                    return created;
                })
                .finally(() => {
                    runtimePromise = null;
                });
        }
        return await runtimePromise;
    }

    /**
     * @param {ReturnType<typeof import('#copilot/infra/internal/operations').createIoOperationEnvelope>} envelope
     * @param {{tool?:string;io?:import('#copilot/infra/internal/operations/contracts').IoMeta|null;result?:Record<string,unknown>}} [context]
     * @returns {Promise<{enabled:boolean;path:string|null;written:boolean;error?:string}>}
     */
    async function record(envelope, context = {}) {
        if (!filePath) return { enabled: false, path: null, written: false };
        if (disposed) {
            return {
                enabled: true,
                path: filePath,
                written: false,
                error: `Mutation audit owner ${runtimeId} is disposed.`,
            };
        }
        try {
            return await (await materialize()).record(envelope, context);
        } catch (error) {
            return {
                enabled: true,
                path: filePath,
                written: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    async function flush() {
        if (runtime) {
            await runtime.flush();
            return;
        }
        if (runtimePromise) await (await runtimePromise).flush();
    }

    function snapshot() {
        if (runtime) return runtime.snapshot();
        return Object.freeze({
            runtimeId,
            enabled: filePath !== null,
            path: filePath,
            materialized: false,
            disposed,
            writer: null,
        });
    }

    function dispose() {
        if (disposePromise) return disposePromise;
        disposed = true;
        disposePromise = (async () => {
            const activeRuntime = runtime ?? (runtimePromise ? await runtimePromise.catch(() => null) : null);
            if (activeRuntime) await activeRuntime.dispose();
            runtime = null;
            runtimePromise = null;
        })();
        return disposePromise;
    }

    return Object.freeze({
        runtimeId,
        enabled: filePath !== null,
        path: filePath,
        record,
        flush,
        snapshot,
        dispose,
    });
}
