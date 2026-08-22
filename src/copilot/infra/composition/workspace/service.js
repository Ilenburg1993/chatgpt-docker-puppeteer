// @ts-check
/** @module copilot/infra/composition/workspace/service */

import { resolve } from 'node:path';
import { createIoExternalWatcher } from '../../filesystem/invalidation/index.js';
import {
    createWorkspacePathAuthority,
    getWorkspacePathAuthorityStats,
} from '../../filesystem/workspace/authority/index.js';
import { createWorkspaceIo } from '../../filesystem/workspace/index.js';
import { createWorkspaceMutationIo } from '../../filesystem/workspace/mutation-io/index.js';
import { createWorkspaceReadIo } from '../../filesystem/workspace/read-io/index.js';
import { createWorkspaceIndexing } from '../../indexing/workspace/index.js';
import { createInfraLifecycle } from '../lifecycle/index.js';

let workspaceSequence = 0;

/** @param {{
 * workspaceRoot:string; blockedSegments?:readonly string[]; workspaceId?:string; runtimeOwnerId?:string; generation?:number;
 * indexRegistry?: ReturnType<typeof import('../../indexing/registry/instance/index.js').createIoIndexRegistryRuntime>;
 * coherenceRuntime?: ReturnType<typeof import('../../filesystem/invalidation/coherence-runtime/index.js').createIoCoherenceRuntime>;
 * parserCacheRuntime?: ReturnType<typeof import('../../indexing/parser/cache/runtime/index.js').createParserCacheRuntime>;
 * telemetryRuntime?: ReturnType<typeof import('#copilot/infra/internal/telemetry').createIoTelemetryRuntime>;
 * workspaceConfig?: ReturnType<typeof import('./config/index.js').readWorkspaceInfraConfig>;
 * indexRuntimeConfig?: ReturnType<typeof import('../../indexing/registry/instance/index.js').readIoIndexRuntimeConfig>;
 * rollbackPolicy?: ReturnType<typeof import('../../filesystem/transaction/index.js').readIoRollbackPolicy>;
 * rollbackCapabilityRuntime?: ReturnType<typeof import('../../operations/rollback/index.js').createIoRollbackCapabilityRuntime>;
 * capacityPreflight?: typeof import('../../filesystem/transaction/index.js').preflightIoCapacity;
 * onDisposed?: (identity:{workspaceId:string;workspaceRoot:string})=>void|Promise<void>;
 * }} options */
export function createWorkspaceInfra(options) {
    if (!options || typeof options.workspaceRoot !== 'string' || !options.workspaceRoot.trim()) {
        throw new TypeError('createWorkspaceInfra requires a non-empty workspaceRoot.');
    }
    const workspaceRoot = resolve(options.workspaceRoot);
    const generation =
        Number.isSafeInteger(options.generation) && Number(options.generation) > 0
            ? Math.trunc(Number(options.generation))
            : ++workspaceSequence;
    const workspaceId = options.workspaceId?.trim() || `workspace-${generation}`;
    const lifecycle = createInfraLifecycle(`WorkspaceInfra(${workspaceId})`);
    const authority = createWorkspacePathAuthority({
        workspaceRoot,
        ...(options.blockedSegments ? { blockedSegments: options.blockedSegments } : {}),
    });
    if (options.rollbackCapabilityRuntime && !options.rollbackPolicy) {
        throw new Error('Workspace rollback capability requires rollbackPolicy.');
    }
    const rollback = options.rollbackCapabilityRuntime
        ? options.rollbackCapabilityRuntime.bindWorkspace({
              workspaceId,
              workspaceRoot,
              policy: /** @type {NonNullable<typeof options.rollbackPolicy>} */ (options.rollbackPolicy),
          })
        : null;
    /** @type {ReturnType<typeof createWorkspaceReadIo> | undefined} */
    let readIo;
    /** @type {ReturnType<typeof createWorkspaceMutationIo> | undefined} */
    let mutationIo;
    /** @type {ReturnType<typeof createWorkspaceIo> | undefined} */
    let io;
    /** @type {ReturnType<typeof createWorkspaceIndexing> | undefined} */
    let indexing;
    /** @type {Map<string, ReturnType<typeof createIoExternalWatcher>>} */
    const externalWatchers = new Map();
    /** @type {Promise<void> | null} */
    let disposePromise = null;

    function assertActive() {
        if (lifecycle.state !== 'active') throw new Error(`WorkspaceInfra(${workspaceId}) is ${lifecycle.state}.`);
    }

    return Object.freeze({
        workspaceId,
        workspaceRoot,
        generation,
        authority,
        authorityStats() {
            return getWorkspacePathAuthorityStats(authority);
        },
        rollback,
        get readIo() {
            assertActive();
            return (readIo ??= createWorkspaceReadIo(
                authority,
                options.coherenceRuntime
                    ? {
                          cacheRuntime: options.coherenceRuntime,
                          readRuntime: options.coherenceRuntime.read,
                          ...(options.telemetryRuntime ? { telemetryRuntime: options.telemetryRuntime } : {}),
                      }
                    : options.telemetryRuntime
                      ? { telemetryRuntime: options.telemetryRuntime }
                      : {},
            ));
        },
        get mutationIo() {
            assertActive();
            return (mutationIo ??= createWorkspaceMutationIo(authority, {
                ...(options.coherenceRuntime ? { invalidationBus: options.coherenceRuntime.invalidation } : {}),
                ...(options.telemetryRuntime ? { telemetryRuntime: options.telemetryRuntime } : {}),
                ...(options.rollbackPolicy ? { rollbackPolicy: options.rollbackPolicy } : {}),
                ...(options.capacityPreflight ? { capacityPreflight: options.capacityPreflight } : {}),
            }));
        },
        get io() {
            assertActive();
            return (io ??= createWorkspaceIo(
                authority,
                options.coherenceRuntime
                    ? {
                          cacheRuntime: options.coherenceRuntime,
                          readRuntime: options.coherenceRuntime.read,
                          invalidationBus: options.coherenceRuntime.invalidation,
                          ...(options.telemetryRuntime ? { telemetryRuntime: options.telemetryRuntime } : {}),
                          ...(options.rollbackPolicy ? { rollbackPolicy: options.rollbackPolicy } : {}),
                          ...(options.capacityPreflight ? { capacityPreflight: options.capacityPreflight } : {}),
                      }
                    : {
                          ...(options.telemetryRuntime ? { telemetryRuntime: options.telemetryRuntime } : {}),
                          ...(options.rollbackPolicy ? { rollbackPolicy: options.rollbackPolicy } : {}),
                          ...(options.capacityPreflight ? { capacityPreflight: options.capacityPreflight } : {}),
                      },
            ));
        },
        get indexing() {
            assertActive();
            if (!indexing) {
                indexing = createWorkspaceIndexing(authority, {
                    ...(options.indexRegistry ? { indexRegistry: options.indexRegistry } : {}),
                    ...(options.coherenceRuntime
                        ? {
                              cacheRuntime: options.coherenceRuntime,
                              invalidationBus: options.coherenceRuntime.invalidation,
                          }
                        : {}),
                    ...(options.parserCacheRuntime ? { parserCacheRuntime: options.parserCacheRuntime } : {}),
                    ...(options.workspaceConfig
                        ? { maxActiveScopes: options.workspaceConfig.indexingContext.maxActiveScopes }
                        : {}),
                    ...(options.runtimeOwnerId ? { runtimeOwnerId: options.runtimeOwnerId } : {}),
                    workspaceOwnerId: workspaceId,
                    ...(options.indexRuntimeConfig ? { indexRuntimeConfig: options.indexRuntimeConfig } : {}),
                });
                const ownedIndexing = indexing;
                lifecycle.register('indexing-context', () => ownedIndexing.dispose());
            }
            return indexing;
        },
        /**
         * Start or reuse an external watcher whose canonical real root has passed this workspace authority.
         *
         * @param {string} [rootPath]
         * @param {Parameters<ReturnType<typeof createIoExternalWatcher>['start']>[0]} [watchOptions]
         */
        async startExternalWatch(rootPath = workspaceRoot, watchOptions = {}) {
            assertActive();
            if (!options.coherenceRuntime) {
                throw new Error(`WorkspaceInfra(${workspaceId}) requires runtime coherence to start external watch.`);
            }
            const approvedRoot = await authority.resolvePath(rootPath, 'scan');
            let watcher = externalWatchers.get(approvedRoot);
            if (!watcher) {
                watcher = createIoExternalWatcher(approvedRoot, {
                    invalidationBus: options.coherenceRuntime.invalidation,
                    ...(options.workspaceConfig ? { config: options.workspaceConfig.externalWatch } : {}),
                });
                externalWatchers.set(approvedRoot, watcher);
                const ownedWatcher = watcher;
                lifecycle.register(`external-watch:${approvedRoot}`, () => {
                    ownedWatcher.stop();
                    externalWatchers.delete(approvedRoot);
                });
            }
            const result = watcher.start(watchOptions);
            return Object.freeze({ ...result, root: approvedRoot, stats: watcher.getStats() });
        },
        externalWatchStats() {
            return Object.freeze([...externalWatchers.values()].map((watcher) => watcher.getStats()));
        },
        /**
         * Register derived state against this workspace's runtime-owned coherence bus.
         * @param {(filePath:string,event:{recursive:boolean;source:string})=>void} hook
         */
        registerInvalidationHook(hook) {
            assertActive();
            if (!options.coherenceRuntime) {
                throw new Error(`WorkspaceInfra(${workspaceId}) has no runtime-owned coherence bus.`);
            }
            const unregister = options.coherenceRuntime.invalidation.registerHook(hook);
            lifecycle.register(`invalidation-hook:${lifecycle.snapshot().registered.length + 1}`, unregister);
            return unregister;
        },
        coherenceStats() {
            assertActive();
            return options.coherenceRuntime?.l1.stats() ?? null;
        },
        /** @param {string} name @param {() => void | Promise<void>} dispose */
        registerDisposable(name, dispose) {
            return lifecycle.register(name, dispose);
        },
        lifecycleSnapshot() {
            return Object.freeze({
                ...lifecycle.snapshot(),
                workspaceId,
                workspaceRoot,
                generation,
                config: options.workspaceConfig ?? null,
                externalWatchers: externalWatchers.size,
                materializedCapabilities: Object.freeze({
                    readIo: readIo !== undefined,
                    mutationIo: mutationIo !== undefined,
                    io: io !== undefined,
                    indexing: indexing !== undefined,
                }),
            });
        },
        dispose() {
            if (disposePromise) return disposePromise;
            disposePromise = (async () => {
                const failures = [];
                try {
                    await lifecycle.dispose();
                } catch (error) {
                    failures.push(error);
                }
                try {
                    await options.onDisposed?.({ workspaceId, workspaceRoot });
                } catch (error) {
                    failures.push(error);
                }
                if (failures.length > 0) {
                    throw new AggregateError(failures, `WorkspaceInfra(${workspaceId}) teardown failed.`);
                }
            })();
            return disposePromise;
        },
    });
}
