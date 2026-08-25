// @ts-check
/** @module copilot/infra/composition/process/service */

import { activateWorkspacePathPolicyCacheConfig } from '#copilot/infra/internal/filesystem/workspace';
import { activateProcessBudgetConfig } from '#copilot/infra/internal/policy';
import { createProcessLockRuntime } from '../../concurrency/locks/process/index.js';
import { activateSearchSubprocessProcessConfig } from '../../indexing/search/subprocess/process/index.js';
import { activateCopilotNodeCompileCacheProcessOwner } from '../../platform/node/index.js';
import { createInfraLifecycle } from '../lifecycle/index.js';
import { createInfraRuntime } from '../runtime/index.js';
import { readProcessInfraConfig } from './config/index.js';
import { createProcessScheduler } from './scheduler/index.js';
import { createProcessShutdownController } from './shutdown/index.js';

let processSequence = 0;

/** @param {{ processId?:string; env?:NodeJS.ProcessEnv; config?:ReturnType<typeof readProcessInfraConfig>; workspaceRoot?:string|null; activateProcessPolicies?:boolean }} [options] */
export function createProcessInfra(options = {}) {
    const processId = options.processId?.trim() || `process-infra-${++processSequence}`;
    const config =
        options.config ??
        readProcessInfraConfig(options.env ?? process.env, { workspaceRoot: options.workspaceRoot ?? null });
    const lifecycle = createInfraLifecycle(`ProcessInfra(${processId})`);
    const processLocks = createProcessLockRuntime({ processId, config: config.locks });
    const scheduler = createProcessScheduler({ processId });
    const shutdown = createProcessShutdownController({ processId });
    const processPolicyToken = Object.freeze({ processId });
    const processPoliciesActivated = options.activateProcessPolicies === true;
    /** @type {(() => void) | null} */
    let deactivateCompileCache = null;
    /** @type {(() => void) | null} */
    let deactivatePathPolicy = null;
    /** @type {(() => void) | null} */
    let deactivateBudgetPolicy = null;
    /** @type {(() => void) | null} */
    let deactivateSearchSubprocess = null;
    if (processPoliciesActivated) {
        try {
            processLocks.activate();
            deactivateCompileCache = activateCopilotNodeCompileCacheProcessOwner({
                token: processPolicyToken,
                processId,
                config: config.compileCache,
            });
            deactivatePathPolicy = activateWorkspacePathPolicyCacheConfig({
                token: processPolicyToken,
                processId,
                config: config.pathPolicyCache,
            });
            deactivateBudgetPolicy = activateProcessBudgetConfig({
                token: processPolicyToken,
                processId,
                searchBudget: config.search.budget,
            });
            deactivateSearchSubprocess = activateSearchSubprocessProcessConfig({
                token: processPolicyToken,
                processId,
                config: config.search.subprocess,
            });
        } catch (error) {
            deactivateSearchSubprocess?.();
            deactivateSearchSubprocess = null;
            deactivateBudgetPolicy?.();
            deactivateBudgetPolicy = null;
            deactivatePathPolicy?.();
            deactivatePathPolicy = null;
            deactivateCompileCache?.();
            deactivateCompileCache = null;
            processLocks.dispose();
            throw error;
        }
    }
    /** @type {Map<string, ReturnType<typeof createInfraRuntime>>} */
    const runtimes = new Map();
    let runtimeGeneration = 0;
    /** @type {Promise<void> | null} */
    let disposePromise = null;

    return Object.freeze({
        processId,
        config,
        scheduler,
        shutdown,
        /** @param {Omit<NonNullable<Parameters<typeof createInfraRuntime>[0]>, 'env' | 'processConfig' | 'runtimeConfig'>} [runtimeOptions] */
        createRuntime(runtimeOptions = {}) {
            if (lifecycle.state !== 'active') throw new Error(`ProcessInfra(${processId}) is ${lifecycle.state}.`);
            const requestedId = runtimeOptions.runtimeId?.trim();
            const nextGeneration = runtimeGeneration + 1;
            const runtimeId = requestedId || `${processId}:runtime:${nextGeneration}`;
            const existing = runtimes.get(runtimeId);
            if (existing) {
                const state = existing.lifecycleSnapshot().state;
                if (state === 'active') throw new Error(`Duplicate InfraRuntime id: ${runtimeId}`);
                if (state === 'disposing') {
                    throw new Error(`InfraRuntime(${runtimeId}) is disposing; await dispose before recreating it.`);
                }
                runtimes.delete(runtimeId);
            }
            const callerOnDisposed = runtimeOptions.onDisposed;
            const runtime = createInfraRuntime({
                ...runtimeOptions,
                runtimeId,
                generation: nextGeneration,
                processConfig: config,
                runtimeConfig: config.runtimeDefaults,
                onDisposed: async (identity) => {
                    const registered = runtimes.get(identity.runtimeId);
                    if (registered?.lifecycleSnapshot().state === 'disposed') runtimes.delete(identity.runtimeId);
                    await callerOnDisposed?.(identity);
                },
            });
            runtimeGeneration = nextGeneration;
            runtimes.set(runtimeId, runtime);
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
            return Object.freeze({
                ...lifecycle.snapshot(),
                processId,
                config,
                processPoliciesActivated,
                runtimeGeneration,
                runtimes: runtimes.size,
                runtimeIds: Object.freeze([...runtimes.keys()]),
                locks: processLocks.snapshot(),
                scheduler: scheduler.snapshot(),
                shutdown: shutdown.snapshot(),
            });
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
                    deactivateSearchSubprocess?.();
                    deactivateSearchSubprocess = null;
                } catch (error) {
                    failures.push(error);
                }
                try {
                    deactivateBudgetPolicy?.();
                    deactivateBudgetPolicy = null;
                } catch (error) {
                    failures.push(error);
                }
                try {
                    deactivatePathPolicy?.();
                    deactivatePathPolicy = null;
                } catch (error) {
                    failures.push(error);
                }
                try {
                    deactivateCompileCache?.();
                    deactivateCompileCache = null;
                } catch (error) {
                    failures.push(error);
                }
                try {
                    processLocks.dispose();
                } catch (error) {
                    failures.push(error);
                }
                try {
                    scheduler.dispose();
                } catch (error) {
                    failures.push(error);
                }
                try {
                    shutdown.dispose();
                } catch (error) {
                    failures.push(error);
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
