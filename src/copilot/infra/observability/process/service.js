// @ts-check
/**
 * Process-scoped IO health projection.
 *
 * This surface owns diagnostics that are intrinsically process-global: lock kernels, Core process policy, path-policy
 * cache, stateless search defaults/subprocess environment and lifetime aggregate workspace-authority counters. Every
 * globally sourced facet is attributed only after its active owner `processId` matches the supplied ProcessInfra.
 *
 * @module copilot/infra/observability/process/service
 */

import { getCoreProcessPolicySnapshot } from '#copilot/core/process-policy';
import { getIoLockStats } from '#copilot/infra/internal/concurrency/locks';
import {
    getValidatedMutableWorkspacePathStats,
    getValidatedReadWorkspacePathStats,
    getWorkspacePathPolicyCacheStats,
} from '#copilot/infra/internal/filesystem/workspace';
import { getActiveProcessBudgetOwnerSnapshot } from '#copilot/infra/internal/policy';
import { getSearchSubprocessProcessSnapshot } from '../../indexing/search/subprocess/process/index.js';
import { getCopilotNodeCompileCacheHealth } from '../../platform/node/index.js';
import { buildIoProcessAlerts } from './alerts.js';

const MAX_RUNTIME_SAMPLE = 32;

/** @param {unknown} value */
function ownerProcessId(value) {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

/** @param {boolean} active @param {unknown} ownerId @param {string} processId */
function isOwnedBy(active, ownerId, processId) {
    return active && ownerProcessId(ownerId) === processId;
}

/**
 * @param {ReturnType<typeof import('../../composition/process/index.js').createProcessInfra>} processInfra
 */
export function readIoProcessHealthSnapshot(processInfra) {
    if (!processInfra || typeof processInfra !== 'object' || typeof processInfra.processId !== 'string') {
        throw new TypeError('readIoProcessHealthSnapshot requires an explicit ProcessInfra.');
    }
    const processId = processInfra.processId;
    const lifecycle = processInfra.lifecycleSnapshot();
    const lockOwner = lifecycle.locks.owner;
    const corePolicy = getCoreProcessPolicySnapshot();
    const pathPolicy = getWorkspacePathPolicyCacheStats();
    const searchBudget = getActiveProcessBudgetOwnerSnapshot();
    const searchExec = getSearchSubprocessProcessSnapshot();
    const compileCache = getCopilotNodeCompileCacheHealth();

    const facetOwnership = Object.freeze({
        locks: isOwnedBy(lockOwner.active === true, lockOwner.processId, processId),
        compileCache: isOwnedBy(compileCache.owner.active === true, compileCache.owner.processId, processId),
        corePolicy: isOwnedBy(corePolicy.active === true, corePolicy.processId, processId),
        pathPolicy: ownerProcessId(pathPolicy.ownerProcessId) === processId,
        searchBudget: isOwnedBy(searchBudget.active === true, searchBudget.processId, processId),
        searchSubprocess: isOwnedBy(searchExec.active === true, searchExec.processId, processId),
    });
    const expected = lifecycle.state === 'active' && lifecycle.processPoliciesActivated === true;
    const missingFacets = expected
        ? Object.entries(facetOwnership)
              .filter(([, owned]) => owned !== true)
              .map(([facet]) => facet)
        : [];
    const ownership = Object.freeze({
        expected,
        complete: !expected || missingFacets.length === 0,
        facets: facetOwnership,
        missingFacets: Object.freeze(missingFacets),
    });
    const ownsProcessGlobals = expected && ownership.complete;
    const locks = facetOwnership.locks
        ? (() => {
              try {
                  return getIoLockStats({ emitStaleEvents: false });
              } catch {
                  return null;
              }
          })()
        : null;
    const runtimes = processInfra.listRuntimes();
    const runtimeSample = runtimes.slice(0, MAX_RUNTIME_SAMPLE).map((runtime) =>
        Object.freeze({
            runtimeId: runtime.runtimeId,
            generation: runtime.generation,
            workspaces: runtime.listWorkspaces().length,
        }),
    );
    const authority = ownsProcessGlobals
        ? Object.freeze({
              aggregateLifetime: true,
              read: Object.freeze(getValidatedReadWorkspacePathStats()),
              mutable: Object.freeze(getValidatedMutableWorkspacePathStats()),
          })
        : null;
    const alerts = buildIoProcessAlerts({ locks, ownership });

    return Object.freeze({
        generatedAt: Date.now(),
        scope: /** @type {const} */ ('process'),
        status: alerts.length > 0 ? /** @type {const} */ ('degraded') : /** @type {const} */ ('healthy'),
        processId,
        lifecycle: Object.freeze({
            state: lifecycle.state,
            processPoliciesActivated: lifecycle.processPoliciesActivated === true,
        }),
        ownership,
        policies: Object.freeze({
            core: facetOwnership.corePolicy
                ? Object.freeze({ owned: true, ownerProcessId: processId, config: corePolicy.config })
                : Object.freeze({ owned: false, ownerProcessId: ownerProcessId(corePolicy.processId) }),
            pathPolicy: facetOwnership.pathPolicy
                ? Object.freeze({ owned: true, ...pathPolicy })
                : Object.freeze({ owned: false, ownerProcessId: ownerProcessId(pathPolicy.ownerProcessId) }),
            searchBudget: facetOwnership.searchBudget
                ? Object.freeze({ owned: true, ownerProcessId: processId, budget: searchBudget.searchBudget })
                : Object.freeze({ owned: false, ownerProcessId: ownerProcessId(searchBudget.processId) }),
            searchSubprocess: facetOwnership.searchSubprocess
                ? Object.freeze({
                      owned: true,
                      ownerProcessId: processId,
                      environmentKeys: searchExec.environmentKeys,
                      ripgrepAvailable: searchExec.ripgrepAvailable,
                      ripgrepProbePending: searchExec.ripgrepProbePending,
                  })
                : Object.freeze({ owned: false, ownerProcessId: ownerProcessId(searchExec.processId) }),
        }),
        locks,
        compileCache: facetOwnership.compileCache
            ? Object.freeze({
                  owned: true,
                  ownerProcessId: processId,
                  adoption: compileCache.owner.adoption,
                  enabled: compileCache.enabled,
                  attempted: compileCache.attempted,
                  statusName: compileCache.statusName,
                  portable: compileCache.portable,
                  nodeVersion: compileCache.nodeVersion,
                  directoryKnown: compileCache.directoryKnown,
                  enableError: compileCache.enableError,
                  lastFlush: compileCache.lastFlush,
              })
            : Object.freeze({
                  owned: false,
                  ownerProcessId: ownerProcessId(compileCache.owner.processId),
                  adoption: compileCache.owner.adoption,
                  enabled: compileCache.enabled,
                  attempted: compileCache.attempted,
                  statusName: compileCache.statusName,
                  portable: compileCache.portable,
                  nodeVersion: compileCache.nodeVersion,
                  directoryKnown: compileCache.directoryKnown,
                  enableError: compileCache.enableError,
                  lastFlush: compileCache.lastFlush,
              }),
        authority,
        runtimes: Object.freeze({
            count: runtimes.length,
            sample: Object.freeze(runtimeSample),
            truncated: runtimes.length > runtimeSample.length,
        }),
        alerts,
    });
}
