// @ts-check
/** Workspace-owned scope runtime facade over the parameterized scope engine. @module copilot/infra/indexing/context/scope/runtime */

import { randomUUID } from 'node:crypto';
import { declareScope } from './lifecycle.js';
import {
    findSymbol,
    getScopeContext,
    getScopeStats,
    getScopeSymbolIndex,
    listScopes,
    peekScopeStats,
} from './query.js';
import { closeScope, invalidateScopePath, refreshScope } from './refresh.js';
import { registerScopeRuntimeProbe, unregisterScopeRuntimeProbe } from './runtime-registry.js';
import { createScopeRuntimeState } from './state.js';

/** @param {{
 * runtimeId?:string; runtimeOwnerId?:string; workspaceOwnerId?:string; workspaceRoot?:string; maxActiveScopes?:number;
 * indexRegistry?: ReturnType<typeof import('../../registry/instance/index.js').createIoIndexRegistryRuntime>;
 * cacheRuntime: {l1:ReturnType<typeof import('../../../cache/memory/index.js').createIoL1CacheRuntime>};
 * invalidationBus: ReturnType<typeof import('../../../filesystem/invalidation/bus/index.js').createIoInvalidationBusRuntime>;
 * parserCacheRuntime?: ReturnType<typeof import('../../parser/cache/runtime/index.js').createParserCacheRuntime>;
 * scannerConfig?: Readonly<{batchSize:number;hardMaxEntries:number}>;
 * }} [options] */
export function createWorkspaceScopeRuntime(options) {
    if (!options?.cacheRuntime || !options?.invalidationBus) {
        throw new TypeError('createWorkspaceScopeRuntime requires runtime-owned cacheRuntime and invalidationBus.');
    }
    const runtimeId = options.runtimeId?.trim() || `scope-runtime-${randomUUID()}`;
    const runtimeOwnerId = options.runtimeOwnerId?.trim() || runtimeId;
    const workspaceOwnerId = options.workspaceOwnerId?.trim() || runtimeId;
    const runtime = createScopeRuntimeState({
        ...(options.maxActiveScopes === undefined ? {} : { maxActiveScopes: options.maxActiveScopes }),
        ...(options.indexRegistry ? { indexRegistry: options.indexRegistry } : {}),
        cacheRuntime: options.cacheRuntime,
        invalidationBus: options.invalidationBus,
        ...(options.parserCacheRuntime ? { parserCacheRuntime: options.parserCacheRuntime } : {}),
        ...(options.scannerConfig ? { scannerConfig: options.scannerConfig } : {}),
    });
    let state = /** @type {'active' | 'disposing' | 'disposed'} */ ('active');
    /** @type {Promise<void> | null} */
    let disposePromise = null;
    let registered = false;

    function assertActive() {
        if (state !== 'active') throw new Error(`ScopeRuntime(${runtimeId}) is ${state}.`);
    }

    function syncProbeRegistration() {
        const shouldRegister = runtime.registry.size > 0 && state === 'active';
        if (shouldRegister && !registered) {
            registerScopeRuntimeProbe(probe);
            registered = true;
        } else if (!shouldRegister && registered) {
            unregisterScopeRuntimeProbe(probe);
            registered = false;
        }
    }

    /** @param {string} sessionId @param {import('./types.js')._InternalScope} scope */
    function isCurrentScopeGeneration(sessionId, scope) {
        return state === 'active' && runtime.registry.get(sessionId) === scope;
    }

    /** @param {string} sessionId */
    function staleHandleError(sessionId) {
        return Object.assign(new Error(`Scope handle for ${sessionId} no longer owns the active generation.`), {
            code: 'ERR_SCOPE_HANDLE_STALE',
            sessionId,
        });
    }

    /** @type {import('./runtime-registry.js').ScopeRuntimeProbe} */
    const probe = Object.freeze({
        scope: /** @type {const} */ ('workspace'),
        ownerId: workspaceOwnerId,
        runtimeOwnerId,
        probeId: runtimeId,
        mayMaterialize: /** @type {const} */ (false),
        snapshot() {
            const ids = listScopes(runtime);
            return Object.freeze({
                activeScopes: ids.length,
                scopes: Object.freeze(
                    ids.map((sessionId) => peekScopeStats(sessionId, runtime)).filter((scope) => scope !== null),
                ),
            });
        },
    });

    const api = Object.freeze({
        runtimeId,
        maxActiveScopes: runtime.maxActiveScopes,
        get state() {
            return state;
        },
        /** @param {import('./types.js').ScopeDeclareOptions} opts */
        declareScope(opts) {
            assertActive();
            const declared = declareScope(
                {
                    ...opts,
                    ...(options.workspaceRoot ? { workspaceRoot: options.workspaceRoot } : {}),
                },
                runtime,
            );
            const { sessionId, scope } = declared;
            syncProbeRegistration();

            return Object.freeze({
                sessionId,
                get ready() {
                    if (!isCurrentScopeGeneration(sessionId, scope)) return false;
                    return peekScopeStats(sessionId, runtime)?.ready === true;
                },
                async awaitReady() {
                    return declared.awaitReady();
                },
                /** @param {string[]} [modifiedPaths] */
                async refresh(modifiedPaths) {
                    assertActive();
                    if (!isCurrentScopeGeneration(sessionId, scope)) throw staleHandleError(sessionId);
                    const result = await refreshScope(sessionId, modifiedPaths, runtime);
                    syncProbeRegistration();
                    return result;
                },
                snapshot() {
                    if (!isCurrentScopeGeneration(sessionId, scope)) return null;
                    return peekScopeStats(sessionId, runtime);
                },
                close() {
                    if (!isCurrentScopeGeneration(sessionId, scope)) return null;
                    const result = closeScope(sessionId, runtime);
                    syncProbeRegistration();
                    return result;
                },
                async [Symbol.asyncDispose]() {
                    if (!isCurrentScopeGeneration(sessionId, scope)) return;
                    closeScope(sessionId, runtime);
                    syncProbeRegistration();
                },
            });
        },
        /** @param {string} sessionId @param {string[]} [modifiedPaths] */
        async refreshScope(sessionId, modifiedPaths) {
            assertActive();
            const result = await refreshScope(sessionId, modifiedPaths, runtime);
            syncProbeRegistration();
            return result;
        },
        /** @param {string} sessionId @param {string} filePath */
        invalidateScopePath(sessionId, filePath) {
            assertActive();
            if (!runtime.registry.has(sessionId)) return false;
            invalidateScopePath(sessionId, filePath, runtime);
            return true;
        },
        /** @param {string} sessionId */
        closeScope(sessionId) {
            const result = closeScope(sessionId, runtime);
            syncProbeRegistration();
            return result;
        },
        /** @param {string} sessionId */
        getScopeStats(sessionId) {
            return getScopeStats(sessionId, runtime);
        },
        /** @param {string} sessionId @param {{ maxFiles?:number; maxBytes?:number }} [queryOptions] */
        getScopeContext(sessionId, queryOptions = {}) {
            return getScopeContext(sessionId, queryOptions, runtime);
        },
        /** @param {string} sessionId */
        getScopeSymbolIndex(sessionId) {
            return getScopeSymbolIndex(sessionId, runtime);
        },
        /** @param {string} sessionId @param {string} name @param {{ exactMatch?:boolean }} [queryOptions] */
        findSymbol(sessionId, name, queryOptions = {}) {
            return findSymbol(sessionId, name, queryOptions, runtime);
        },
        listScopes() {
            return listScopes(runtime);
        },
        snapshot() {
            return Object.freeze({
                runtimeId,
                runtimeOwnerId,
                workspaceOwnerId,
                state,
                activeScopes: runtime.registry.size,
                warming: runtime.warmPromises.size,
                refreshing: runtime.refreshingPaths.size,
                prefetchSessions: runtime.prefetchSessions.list().length,
                maxActiveScopes: runtime.maxActiveScopes,
            });
        },
        dispose() {
            if (disposePromise) return disposePromise;
            disposePromise = (async () => {
                if (state === 'disposed') return;
                state = 'disposing';
                unregisterScopeRuntimeProbe(probe);
                registered = false;
                const pending = [...runtime.warmPromises.values()];
                for (const sessionId of [...runtime.registry.keys()]) closeScope(sessionId, runtime);
                runtime.prefetchSessions.dispose();
                await Promise.allSettled(pending);
                if (runtime.scopeInvalidationUnregister) {
                    runtime.scopeInvalidationUnregister();
                    runtime.scopeInvalidationUnregister = null;
                }
                state = 'disposed';
            })();
            return disposePromise;
        },
    });
    return api;
}
