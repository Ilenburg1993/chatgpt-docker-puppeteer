// @ts-check
/** @module copilot/infra/composition/lifecycle/service */

/**
 * Small deterministic teardown registry used by infra composition scopes.
 * Registration is synchronous; disposal is idempotent, reverse-ordered and aggregates teardown failures.
 *
 * @param {string} label
 */
export function createInfraLifecycle(label) {
    /** @type {{ name:string; dispose:() => void | Promise<void> }[]} */
    const entries = [];
    let state = /** @type {'active' | 'disposing' | 'disposed'} */ ('active');
    /** @type {Promise<void> | null} */
    let disposePromise = null;

    return Object.freeze({
        get state() {
            return state;
        },
        /** @param {string} name @param {() => void | Promise<void>} dispose */
        register(name, dispose) {
            if (state !== 'active') throw new Error(`${label} is ${state}; cannot register ${name}.`);
            if (typeof dispose !== 'function') throw new TypeError(`${label}:${name} dispose must be a function.`);
            const entry = { name, dispose };
            entries.push(entry);
            return () => {
                const index = entries.indexOf(entry);
                if (index >= 0) entries.splice(index, 1);
            };
        },
        snapshot() {
            return Object.freeze({ label, state, registered: entries.map((entry) => entry.name) });
        },
        dispose() {
            if (disposePromise) return disposePromise;
            disposePromise = (async () => {
                if (state === 'disposed') return;
                state = 'disposing';
                const failures = [];
                for (const entry of [...entries].reverse()) {
                    try {
                        await entry.dispose();
                    } catch (error) {
                        failures.push(new Error(`${label}:${entry.name} teardown failed`, { cause: error }));
                    }
                }
                entries.length = 0;
                state = 'disposed';
                if (failures.length > 0) throw new AggregateError(failures, `${label} teardown failed.`);
            })();
            return disposePromise;
        },
    });
}
