// @ts-check
/** @module copilot/infra/composition/runtime/service */

import { createIoTelemetryRuntime, publishIoLifecycleEvent } from '#copilot/infra/internal/telemetry';
import { resolve } from 'node:path';
import { createInfraSqliteProviderBinding } from '../../database/provider/index.js';
import { createIoCoherenceRuntime } from '../../filesystem/invalidation/coherence-runtime/index.js';
import { preflightIoCapacity } from '../../filesystem/transaction/index.js';
import { createParserCacheRuntime } from '../../indexing/parser/cache/runtime/index.js';
import { readParserProcessConfig } from '../../indexing/parser/foundation/index.js';
import { createParserWorkerRuntime } from '../../indexing/parser/worker/index.js';
import { createIoIndexRegistryRuntime } from '../../indexing/registry/instance/index.js';
import { createIoRollbackCapabilityRuntime } from '../../operations/rollback/index.js';
import { createInfraLifecycle } from '../lifecycle/index.js';
import { createWorkspaceInfra } from '../workspace/index.js';
import { readInfraConfig, withInfraRuntimeConfigOverrides } from './config.js';
import { createRuntimeMutationAuditOwner } from './mutation-audit-owner.js';

let runtimeSequence = 0;

/**
 * @typedef {Readonly<{
 *   parser: ReturnType<typeof readParserProcessConfig>;
 *   runtimeDefaults?: ReturnType<typeof readInfraConfig>;
 * }>} RuntimeProcessConfigPort
 */

/** @param {{ runtimeId?:string; generation?:number; processConfig?:RuntimeProcessConfigPort; runtimeConfig?:ReturnType<typeof readInfraConfig>; sqliteProvider?: import('#copilot/infra/internal/database/port').InfraSqliteProvider; mutationAuditLogPath?:string|null; env?:NodeJS.ProcessEnv; onDisposed?:(identity:{runtimeId:string;generation:number})=>void|Promise<void> }} [options] */
export function createInfraRuntime(options = {}) {
    const generation =
        Number.isSafeInteger(options.generation) && Number(options.generation) > 0
            ? Math.trunc(Number(options.generation))
            : ++runtimeSequence;
    const runtimeId = options.runtimeId?.trim() || `infra-runtime-${generation}`;
    const env = options.env ?? Object.freeze({});
    const processConfig =
        options.processConfig ??
        Object.freeze({
            parser: readParserProcessConfig(env),
            runtimeDefaults: readInfraConfig(env),
        });
    const config = withInfraRuntimeConfigOverrides(
        options.runtimeConfig ?? processConfig.runtimeDefaults ?? readInfraConfig(env),
        {
            ...(options.mutationAuditLogPath === undefined
                ? {}
                : { mutationAuditLogPath: options.mutationAuditLogPath }),
        },
    );
    const lifecycle = createInfraLifecycle(`InfraRuntime(${runtimeId})`);
    /** @param {string} targetPath @param {number} requiredBytes */
    const capacityPreflight = (targetPath, requiredBytes) =>
        preflightIoCapacity(targetPath, requiredBytes, config.capacityPreflight);
    const database = createInfraSqliteProviderBinding(options.sqliteProvider ?? null);
    const rollbackCapabilities = createIoRollbackCapabilityRuntime({ runtimeId, ttlMs: config.rollback.ttlMs });
    const mutationAudit = createRuntimeMutationAuditOwner({
        runtimeId,
        filePath: config.mutationAudit.filePath,
    });
    const telemetry = createIoTelemetryRuntime({
        runtimeId: `${runtimeId}:telemetry`,
        advisoryBudgetConfig: config.telemetry.advisoryBudget,
        onAdvisoryPressure(operation, stats) {
            publishIoLifecycleEvent('budget', 'pressure', { runtimeId, operation, ...stats });
        },
    });
    const coherence = createIoCoherenceRuntime({
        database,
        runtimeId: `${runtimeId}:coherence`,
        config: {
            l1: config.l1,
            l2: config.l2,
            debugIoL2: config.debugIoL2,
            invalidation: config.invalidation,
            read: config.read,
        },
    });
    const parserWorkers = createParserWorkerRuntime({
        runtimeId: `${runtimeId}:parser-workers`,
        config: processConfig.parser,
    });
    const parserCache = createParserCacheRuntime({
        invalidationBus: coherence.invalidation,
        runtimeId: `${runtimeId}:parser-cache`,
        config: config.parserCache,
        parserConfig: processConfig.parser,
        workerRuntime: parserWorkers,
    });
    const indexRegistry = createIoIndexRegistryRuntime({
        database,
        invalidationBus: coherence.invalidation,
        telemetryRuntime: telemetry,
        parserWorkerRuntime: parserWorkers,
        runtimeId: `${runtimeId}:index`,
        config: config.index,
    });
    /** @type {Map<string, ReturnType<typeof createWorkspaceInfra>>} */
    const workspaces = new Map();
    let workspaceGeneration = 0;
    /** @type {Promise<void> | null} */
    let disposePromise = null;

    function disposeRuntime() {
        if (disposePromise) return disposePromise;
        disposePromise = (async () => {
            const failures = [];
            for (const workspace of [...workspaces.values()].reverse()) {
                try {
                    await workspace.dispose();
                } catch (error) {
                    failures.push(error);
                }
            }
            try {
                rollbackCapabilities.dispose();
            } catch (error) {
                failures.push(error);
            }
            try {
                await mutationAudit.dispose();
            } catch (error) {
                failures.push(error);
            }
            try {
                await indexRegistry.dispose();
            } catch (error) {
                failures.push(error);
            }
            try {
                await parserWorkers.dispose();
            } catch (error) {
                failures.push(error);
            }
            try {
                parserCache.dispose();
            } catch (error) {
                failures.push(error);
            }
            try {
                coherence.dispose();
            } catch (error) {
                failures.push(error);
            }
            try {
                telemetry.dispose();
            } catch (error) {
                failures.push(error);
            }
            try {
                await lifecycle.dispose();
            } catch (error) {
                failures.push(error);
            }
            try {
                await options.onDisposed?.({ runtimeId, generation });
            } catch (error) {
                failures.push(error);
            }
            if (failures.length > 0) throw new AggregateError(failures, `InfraRuntime(${runtimeId}) teardown failed.`);
        })();
        return disposePromise;
    }

    return Object.freeze({
        runtimeId,
        generation,
        processConfig,
        config,
        database,
        rollbackCapabilities,
        mutationAudit,
        telemetry,
        coherence,
        parserWorkers,
        parserCache,
        indexRegistry,
        /** @param {string} workspaceRoot */
        workspace(workspaceRoot) {
            if (lifecycle.state !== 'active') throw new Error(`InfraRuntime(${runtimeId}) is ${lifecycle.state}.`);
            const key = resolve(workspaceRoot);
            const existing = workspaces.get(key);
            if (existing) {
                const state = existing.lifecycleSnapshot().state;
                if (state === 'active') return existing;
                if (state === 'disposing') {
                    throw new Error(
                        `WorkspaceInfra(${existing.workspaceId}) is disposing; await dispose before recreating ${key}.`,
                    );
                }
                workspaces.delete(key);
            }
            const generation = workspaceGeneration + 1;
            const workspaceId = `${runtimeId}:workspace:${generation}`;
            const workspace = createWorkspaceInfra({
                workspaceRoot: key,
                workspaceId,
                runtimeOwnerId: runtimeId,
                generation,
                indexRegistry,
                coherenceRuntime: coherence,
                parserCacheRuntime: parserCache,
                telemetryRuntime: telemetry,
                workspaceConfig: config.workspace,
                indexRuntimeConfig: config.index,
                rollbackPolicy: config.rollback,
                rollbackCapabilityRuntime: rollbackCapabilities,
                capacityPreflight,
                onDisposed: () => {
                    const registered = workspaces.get(key);
                    if (registered?.lifecycleSnapshot().state === 'disposed') workspaces.delete(key);
                },
            });
            workspaceGeneration = generation;
            workspaces.set(key, workspace);
            return workspace;
        },
        listWorkspaces() {
            return [...workspaces.values()];
        },
        /** @param {string} name @param {() => void | Promise<void>} dispose */
        registerDisposable(name, dispose) {
            return lifecycle.register(name, dispose);
        },
        lifecycleSnapshot() {
            return Object.freeze({
                ...lifecycle.snapshot(),
                runtimeId,
                generation,
                processConfig,
                workspaceGeneration,
                workspaces: workspaces.size,
                workspaceIdentities: Object.freeze(
                    [...workspaces.values()].map((workspace) =>
                        Object.freeze({
                            workspaceId: workspace.workspaceId,
                            workspaceRoot: workspace.workspaceRoot,
                            generation: workspace.generation,
                        }),
                    ),
                ),
                database: database.status(),
                rollbackCapabilities: rollbackCapabilities.snapshot(),
                mutationAudit: mutationAudit.snapshot(),
                telemetry: telemetry.snapshot(),
                coherence: coherence.snapshot(),
                parserWorkers: parserWorkers.status(),
                parserCache: parserCache.snapshot(),
                indexRegistry: indexRegistry.snapshot(),
            });
        },
        dispose: disposeRuntime,
        [Symbol.asyncDispose]: disposeRuntime,
    });
}
