// @ts-check
/** @module copilot/infra/composition/runtime/service */

import { createIoTelemetryRuntime, publishIoLifecycleEvent } from '#copilot/infra/internal/telemetry';
import { resolve } from 'node:path';
import { createInfraSqliteProviderBinding } from '../../database/index.js';
import { createIoCoherenceRuntime } from '../../filesystem/invalidation/coherence-runtime/index.js';
import { preflightIoCapacity } from '../../filesystem/transaction/index.js';
import { createParserCacheRuntime } from '../../indexing/parser/cache/runtime/index.js';
import { createParserWorkerRuntime } from '../../indexing/parser/worker/index.js';
import { createIoIndexRegistryRuntime } from '../../indexing/registry/instance/index.js';
import { createInfraLifecycle } from '../lifecycle/index.js';
import { createWorkspaceInfra } from '../workspace/index.js';
import { readInfraConfig } from './config.js';
import { createRuntimeMutationAuditOwner } from './mutation-audit-owner.js';

let runtimeSequence = 0;

/** @param {{ runtimeId?:string; sqliteProvider?: (() => import('better-sqlite3').Database); mutationAuditLogPath?:string|null; env?:NodeJS.ProcessEnv }} [options] */
export function createInfraRuntime(options = {}) {
    const runtimeId = options.runtimeId?.trim() || `infra-runtime-${++runtimeSequence}`;
    const config = readInfraConfig(options.env ?? process.env, {
        ...(options.mutationAuditLogPath === undefined ? {} : { mutationAuditLogPath: options.mutationAuditLogPath }),
    });
    const lifecycle = createInfraLifecycle(`InfraRuntime(${runtimeId})`);
    /** @param {string} targetPath @param {number} requiredBytes */
    const capacityPreflight = (targetPath, requiredBytes) =>
        preflightIoCapacity(targetPath, requiredBytes, config.capacityPreflight);
    const database = createInfraSqliteProviderBinding(options.sqliteProvider ?? null);
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
    const parserWorkers = createParserWorkerRuntime({ runtimeId: `${runtimeId}:parser-workers` });
    const parserCache = createParserCacheRuntime({
        invalidationBus: coherence.invalidation,
        runtimeId: `${runtimeId}:parser-cache`,
        config: config.parserCache,
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
    /** @type {Promise<void> | null} */
    let disposePromise = null;

    return Object.freeze({
        runtimeId,
        config,
        database,
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
            if (existing) return existing;
            const workspace = createWorkspaceInfra({
                workspaceRoot: key,
                workspaceId: `${runtimeId}:workspace:${workspaces.size + 1}`,
                indexRegistry,
                coherenceRuntime: coherence,
                parserCacheRuntime: parserCache,
                telemetryRuntime: telemetry,
                externalWatchConfig: config.externalWatch,
                rollbackPolicy: config.rollback,
                capacityPreflight,
            });
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
                workspaces: workspaces.size,
                database: database.status(),
                mutationAudit: mutationAudit.snapshot(),
                telemetry: telemetry.snapshot(),
                coherence: coherence.snapshot(),
                parserWorkers: parserWorkers.status(),
                parserCache: parserCache.snapshot(),
                indexRegistry: indexRegistry.snapshot(),
            });
        },
        dispose() {
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
                if (failures.length > 0)
                    throw new AggregateError(failures, `InfraRuntime(${runtimeId}) teardown failed.`);
            })();
            return disposePromise;
        },
    });
}
