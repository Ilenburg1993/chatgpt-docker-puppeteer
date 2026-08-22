// @ts-check
/** Runtime-owned coherence aggregate: L1 + L2 + cross-process journal + local invalidation bus. */
import { createIoL2CacheRuntime } from '#copilot/infra/internal/cache/l2';
import { createIoL1CacheRuntime } from '#copilot/infra/internal/cache/memory/runtime';
import { createIoReadRuntime } from '../../read/runtime/index.js';
import { createIoInvalidationBusRuntime } from '../bus/index.js';
import { createCrossProcessInvalidationRuntime } from '../cross-process/index.js';

/**
 * @param {{
 *   database:import('#copilot/infra/internal/database/port').InfraSqliteProviderReader;
 *   runtimeId?:string;
 *   config?:{l1:ReturnType<typeof import('../../../cache/memory/runtime/index.js').readIoL1CacheConfig>;l2:ReturnType<typeof import('../../../cache/l2/index.js').getIoL2CacheConfiguration>;debugIoL2:boolean;invalidation:{debounceMs:number;crossProcess:ReturnType<typeof import('../cross-process/index.js').readCrossProcessInvalidationConfig>};read:ReturnType<typeof import('../../read/runtime/index.js').readIoReadRuntimeConfig>};
 * }} options
 */
export function createIoCoherenceRuntime(options) {
    if (!options?.database) throw new TypeError('createIoCoherenceRuntime requires { database }.');
    const runtimeId = options.runtimeId ?? 'io-coherence-runtime';
    const config = options.config;
    const l1 = createIoL1CacheRuntime(config ? { config: config.l1 } : {});
    const l2 = createIoL2CacheRuntime({
        database: options.database,
        runtimeId: `${runtimeId}:l2`,
        ...(config ? { configuration: config.l2, debug: config.debugIoL2 } : {}),
    });
    const crossProcess = createCrossProcessInvalidationRuntime({
        database: options.database,
        runtimeId: `${runtimeId}:cross-process`,
        ...(config ? { config: config.invalidation.crossProcess } : {}),
    });
    const invalidation = createIoInvalidationBusRuntime({
        l1,
        l2,
        crossProcess,
        runtimeId: `${runtimeId}:bus`,
        registerProcessShutdown: false,
        ...(config ? { debounceMs: config.invalidation.debounceMs } : {}),
    });
    const read = createIoReadRuntime({
        invalidationBus: invalidation,
        runtimeId: `${runtimeId}:read`,
        ...(config ? { config: config.read } : {}),
    });
    let disposed = false;
    return Object.freeze({
        runtimeId,
        l1,
        l2,
        crossProcess,
        invalidation,
        read,
        snapshot() {
            return Object.freeze({
                runtimeId,
                disposed,
                l1: l1.stats(),
                l2: l2.state(),
                invalidation: invalidation.snapshot(),
                read: read.snapshot(),
            });
        },
        dispose() {
            if (disposed) return;
            read.dispose();
            invalidation.dispose();
            crossProcess.dispose();
            l2.dispose();
            l1.dispose();
            disposed = true;
        },
    });
}
