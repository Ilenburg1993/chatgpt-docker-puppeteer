// @ts-check
/** @module copilot/infra/composition/process/service */

import { createInfraLifecycle } from '../lifecycle/index.js';
import { createInfraRuntime } from '../runtime/index.js';

let processSequence = 0;

/** @param {{ processId?:string }} [options] */
export function createProcessInfra(options = {}) {
    const processId = options.processId?.trim() || `process-infra-${++processSequence}`;
    const lifecycle = createInfraLifecycle(`ProcessInfra(${processId})`);
    /** @type {Map<string, ReturnType<typeof createInfraRuntime>>} */
    const runtimes = new Map();
    /** @type {Promise<void> | null} */
    let disposePromise = null;

    return Object.freeze({
        processId,
        /** @param {Parameters<typeof createInfraRuntime>[0]} [runtimeOptions] */
        createRuntime(runtimeOptions = {}) {
            if (lifecycle.state !== 'active') throw new Error(`ProcessInfra(${processId}) is ${lifecycle.state}.`);
            const runtime = createInfraRuntime(runtimeOptions);
            if (runtimes.has(runtime.runtimeId)) throw new Error(`Duplicate InfraRuntime id: ${runtime.runtimeId}`);
            runtimes.set(runtime.runtimeId, runtime);
            return runtime;
        },
        listRuntimes() {
            return [...runtimes.values()];
        },
        /** @param {string} name @param {() => void | Promise<void>} dispose */
        registerDisposable(name, dispose) {
            return lifecycle.register(name, dispose);
        },
        lifecycleSnapshot() {
            return Object.freeze({ ...lifecycle.snapshot(), processId, runtimes: runtimes.size });
        },
        dispose() {
            if (disposePromise) return disposePromise;
            disposePromise = (async () => {
                const failures = [];
                for (const runtime of [...runtimes.values()].reverse()) {
                    try {
                        await runtime.dispose();
                    } catch (error) {
                        failures.push(error);
                    }
                }
                try {
                    await lifecycle.dispose();
                } catch (error) {
                    failures.push(error);
                }
                if (failures.length > 0)
                    throw new AggregateError(failures, `ProcessInfra(${processId}) teardown failed.`);
            })();
            return disposePromise;
        },
    });
}
