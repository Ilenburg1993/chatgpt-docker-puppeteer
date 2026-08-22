// @ts-check

import { readScopeRuntimeRegistrySnapshot } from '#copilot/infra/internal/indexing/context';
import { createProcessInfra } from '#copilot/infra/public/composition/process';
import { readIoRuntimeHealthSnapshot } from '#copilot/infra/public/observability';
import { readIoProcessHealthSnapshot } from '#copilot/infra/public/observability/process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getSearchSubprocessProcessSnapshot } from '../../../../src/copilot/infra/indexing/search/subprocess/process/index.js';

/** @type {Array<ReturnType<typeof createProcessInfra>>} */
const processes = [];
/** @type {string[]} */
const tempRoots = [];

afterEach(async () => {
    await Promise.allSettled(processes.splice(0).map((processInfra) => processInfra.dispose()));
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/**
 * @param {ReturnType<typeof createProcessInfra>} processInfra
 * @param {ReturnType<ReturnType<typeof createProcessInfra>['createRuntime']>} runtime
 * @param {ReturnType<ReturnType<ReturnType<typeof createProcessInfra>['createRuntime']>['workspace']>} workspace
 */
function captureMaterializationState(processInfra, runtime, workspace) {
    const l2 = runtime.coherence.l2.state();
    const parserWorkers = runtime.parserWorkers.status();
    const index = runtime.indexRegistry.status();
    const invalidation = runtime.coherence.invalidation.snapshot();
    const workspaceLifecycle = workspace.lifecycleSnapshot();
    const scopes = readScopeRuntimeRegistrySnapshot({ runtimeOwnerId: runtime.runtimeId });
    const searchExec = getSearchSubprocessProcessSnapshot();
    const processLifecycle = processInfra.lifecycleSnapshot();

    return Object.freeze({
        l2: Object.freeze({
            materialized: l2.materialized,
            pruneTimerPending: l2.pruneTimerPending,
            initFailCount: l2.initFailCount,
            databaseRevision: l2.databaseRevision,
        }),
        parserWorkers: Object.freeze({
            poolInitialized: parserWorkers.poolInitialized,
            poolSize: parserWorkers.poolSize,
            queueLength: parserWorkers.queueLength,
            inFlight: parserWorkers.inFlight,
            poolRestarting: parserWorkers.poolRestarting,
            nextInitAttemptAtMs: parserWorkers.nextInitAttemptAtMs,
        }),
        index: Object.freeze({
            materialized: index.lifecycle.materialized,
            materializations: index.lifecycle.materializations,
            timerPending: index.autoRefresh.timerPending,
            pending: index.autoRefresh.pending,
            running: index.autoRefresh.running,
            workspaceRootKnown: index.autoRefresh.workspaceRootKnown,
        }),
        invalidation: Object.freeze({
            hooks: invalidation.hooks,
            pending: invalidation.pending,
            timerPending: invalidation.timerPending,
            consumerStarted: invalidation.consumerStarted,
            shutdownRegistered: invalidation.shutdownRegistered,
            crossProcessPolling: invalidation.crossProcess['polling'],
        }),
        workspace: Object.freeze({
            externalWatchers: workspaceLifecycle.externalWatchers,
            materializedCapabilities: workspaceLifecycle.materializedCapabilities,
        }),
        scopes: Object.freeze({
            activeProbes: scopes.activeProbes,
            activeScopes: scopes.activeScopes,
        }),
        searchExec: Object.freeze({
            processId: searchExec.processId,
            ripgrepAvailable: searchExec.ripgrepAvailable,
            ripgrepProbePending: searchExec.ripgrepProbePending,
        }),
        process: Object.freeze({
            state: processLifecycle.state,
            processPoliciesActivated: processLifecycle.processPoliciesActivated,
            runtimes: processLifecycle.runtimes,
        }),
    });
}

describe('IO health non-materialization invariant', () => {
    it('runtime/process health não cria stores, workers, timers, watchers, scopes ou lazy workspace capabilities', async () => {
        const workspaceRoot = await mkdtemp(join(tmpdir(), 'io-health-nonmaterializing-'));
        tempRoots.push(workspaceRoot);
        const processInfra = createProcessInfra({
            processId: 'io-health-nonmaterializing-process',
            activateProcessPolicies: true,
            env: {
                IO_INDEX_ENABLED: '1',
                IO_INDEX_AUTO_REFRESH_ENABLED: '1',
                IO_L2_CACHE_PROFILE: 'balanced',
                IO_CROSS_PROCESS_INVALIDATION_ENABLED: '1',
            },
        });
        processes.push(processInfra);
        const runtime = processInfra.createRuntime({ runtimeId: 'io-health-nonmaterializing-runtime' });
        const workspace = runtime.workspace(workspaceRoot);

        const before = captureMaterializationState(processInfra, runtime, workspace);
        expect(before.l2).toMatchObject({ materialized: false, pruneTimerPending: false });
        expect(before.parserWorkers).toMatchObject({
            poolInitialized: false,
            poolSize: 0,
            queueLength: 0,
            inFlight: 0,
        });
        expect(before.index).toMatchObject({ materialized: false, timerPending: false, pending: 0, running: false });
        expect(before.workspace).toMatchObject({
            externalWatchers: 0,
            materializedCapabilities: { readIo: false, mutationIo: false, io: false, indexing: false },
        });
        expect(before.scopes).toEqual({ activeProbes: 0, activeScopes: 0 });
        expect(before.searchExec).toMatchObject({ ripgrepAvailable: null, ripgrepProbePending: false });

        const runtimeHealthA = readIoRuntimeHealthSnapshot(runtime);
        const processHealthA = readIoProcessHealthSnapshot(processInfra);
        const runtimeHealthB = readIoRuntimeHealthSnapshot(runtime);
        const processHealthB = readIoProcessHealthSnapshot(processInfra);

        expect(runtimeHealthA).toMatchObject({ scope: 'runtime', runtimeId: runtime.runtimeId });
        expect(runtimeHealthB.scopes).toMatchObject({ active: 0, ids: [] });
        expect(processHealthA).toMatchObject({ scope: 'process', processId: processInfra.processId });
        expect(processHealthA.ownership).toMatchObject({ expected: true, complete: true });
        expect(processHealthB.policies.searchSubprocess).toMatchObject({
            owned: true,
            ripgrepAvailable: null,
            ripgrepProbePending: false,
        });

        const after = captureMaterializationState(processInfra, runtime, workspace);
        expect(after).toEqual(before);
    });
});
