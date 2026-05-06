// @ts-check
/**
 * Projection family: status.
 */

import { getWorkspaceContext } from '#copilot/boot';
import { buildRuntimeLifecycleSummary, readRuntimeLifecycleSnapshot } from '../../../presentation/runtime-lifecycle.js';
import {
    getLastSdkPlanChangedAt,
    getLastSdkPlanOperation,
    getSdkSessionMode,
} from '../../../presentation/runtime-ui-state-store.js';
import { readTerminalActivitySnapshot } from '../../activity-state.js';
import {
    readTerminalElicitationSummary,
    readTerminalPermissionSummary,
    readTerminalUserInputSummary,
} from '../../sdk-interactions.js';
import { getTerminalSdkSessionCapabilities } from '../gateways/sdk-session.js';
import {
    formatTerminalRuntimeTopology,
    normalizeTerminalModelBillingProjection,
    readTerminalRuntimeBase,
} from './shared.js';
import { readTerminalTimelineProjection } from './timeline.js';

/**
 * @param {{ hubSessionId?: string | null; injectPort?: number; runtimeId?: string | null }} input
 * @returns {{
 *     snap: Record<string, unknown>;
 *     health: Record<string, any> | null;
 *     dialogLoopActive: boolean;
 *     pendingQuestion: boolean;
 *     pendingQuestionKind: import('../../../presentation/types.js').RuntimePendingQuestionKind | null;
 *     pendingQuestionText: string | null;
 *     pendingQuestionShadow: boolean;
 *     pendingQuestionShadowKind: import('../../../presentation/types.js').RuntimePendingQuestionKind | null;
 *     pendingQuestionShadowState: import('../../../presentation/types.js').RuntimePendingQuestionShadowState | null;
 *     pendingQuestionShadowText: string | null;
 *     pendingQuestionShadowExpired: boolean;
 *     pendingQuestionShadowAgeMs: number | null;
 *     pendingQuestionShadowExpiresAt: number | null;
 *     pendingQuestionShadowRemainingMs: number | null;
 *     systemPromptBinding: Record<string, unknown> | null;
 *     systemPromptFreshness: Record<string, unknown> | null;
 *     lastPrInfo: Record<string, any> | null;
 *     modelBilling: import('./shared.js').TerminalModelBillingProjection;
 *     recommendedAction: import('../../../presentation/types.js').RuntimeRecommendedAction | null;
 *     sdkSessionMode: 'interactive' | 'plan' | 'autopilot' | 'shell' | null;
 *     sdkPlanOperation: 'create' | 'update' | 'delete' | null;
 *     sdkPlanChangedAt: number | null;
 *     injectPort: number | null;
 *     hubSessionId: string | null;
 *     sdkSessionId: string | null;
 *     agentProfileId: string | null;
 *     requestedRuntimeId: string | null;
 *     runtimeId: string;
 *     runtimeFound: boolean;
 *     usedDefaultRuntimeFallback: boolean;
 *     runtimeFallbackWarning: string | null;
 *     agentRuntimes: import('./shared.js').TerminalRuntimeBase['agentRuntimes'];
 *     runtimeTopologyLabel: string;
 *     runtimeSessionId: string | null;
 *     workspace: ReturnType<typeof getWorkspaceContext>;
 *     turnCount: number;
 *     bridgeTurnCount: number;
 *     activity: import('../../activity-state.js').TerminalActivitySnapshot;
 *     lifecycle: ReturnType<typeof readRuntimeLifecycleSnapshot>;
 *     lifecycleSummary: ReturnType<typeof buildRuntimeLifecycleSummary>;
 *     pendingElicitations: number;
 *     latestElicitationMode: string | null;
 *     pendingPermissions: number;
 *     latestPermissionType: string | null;
 *     pendingUserInputs: number;
 *     latestUserInputKind: 'question' | 'ready' | 'reply' | 'stopped' | null;
 *     permissionMode: 'approve_all' | 'audit_only' | 'selective';
 *     sdkCapabilities: Record<string, unknown> | null;
 *     timelineSource: import('./timeline.js').TerminalTimelineSource;
 *     timelineAuthority: import('./timeline.js').TerminalTimelineAuthority;
 *     timelineReconciliationStatus: import('./timeline.js').TerminalTimelineReconciliation;
 *     timelineTurnCount: number;
 *     persistedTimelineTurnCount: number;
 *     liveBridgeTailCount: number;
 *     timelineSyncStatus: import('./timeline.js').TerminalTimelineSyncStatus;
 *     timelineSyncReason: string | null;
 *     timelineSyncPendingCount: number;
 *     timelineSyncSyncedCount: number;
 *     timelineSyncFailedCount: number;
 *     timelineSyncLastError: string | null;
 *     timelineSyncAttempts: number;
 *     timelineSyncNextRetryAt: number | null;
 * }}
 */
export function readTerminalStatusProjection({ hubSessionId = null, injectPort, runtimeId = null } = {}) {
    const base = readTerminalRuntimeBase(runtimeId);
    const pendingQuestion = base.pendingQuestion;
    const pendingQuestionShadow = base.pendingQuestionShadow;
    const recommendedAction = /** @type {import('../../../presentation/types.js').RuntimeRecommendedAction | null} */ (
        typeof base.health?.['recommendedAction'] === 'string' ? base.health['recommendedAction'] : null
    );
    const lifecycle = readRuntimeLifecycleSnapshot();
    const modelBilling = normalizeTerminalModelBillingProjection(base.lastPrInfo, String(base.snap['model'] ?? ''));
    const elicitationSummary = readTerminalElicitationSummary();
    const permissionSummary = readTerminalPermissionSummary();
    const userInputSummary = readTerminalUserInputSummary();
    const permissionMode =
        base.snap['permissionMode'] === 'audit_only' || base.snap['permissionMode'] === 'selective'
            ? /** @type {'approve_all' | 'audit_only' | 'selective'} */ (base.snap['permissionMode'])
            : 'approve_all';
    const sdkCapabilities = (() => {
        try {
            const value = getTerminalSdkSessionCapabilities(runtimeId);
            return value && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : null;
        } catch {
            return null;
        }
    })();
    const timeline = readTerminalTimelineProjection({ limitPairs: 10, runtimeId });
    return {
        snap: base.snap,
        health: base.health,
        dialogLoopActive: base.dialogLoopActive,
        pendingQuestion: pendingQuestion !== null,
        pendingQuestionKind: base.pendingQuestionKind,
        pendingQuestionText: pendingQuestion?.question ?? null,
        pendingQuestionShadow: pendingQuestionShadow !== null,
        pendingQuestionShadowKind: base.pendingQuestionShadowKind,
        pendingQuestionShadowState: base.pendingQuestionShadowState,
        pendingQuestionShadowText: pendingQuestionShadow?.question ?? null,
        pendingQuestionShadowExpired: base.pendingQuestionShadowExpired,
        pendingQuestionShadowAgeMs: base.pendingQuestionShadowAgeMs,
        pendingQuestionShadowExpiresAt: base.pendingQuestionShadowExpiresAt,
        pendingQuestionShadowRemainingMs: base.pendingQuestionShadowRemainingMs,
        systemPromptBinding: base.systemPromptBinding,
        systemPromptFreshness: base.systemPromptFreshness,
        lastPrInfo: base.lastPrInfo,
        modelBilling,
        recommendedAction,
        sdkSessionMode: getSdkSessionMode(),
        sdkPlanOperation: getLastSdkPlanOperation(),
        sdkPlanChangedAt: getLastSdkPlanChangedAt(),
        injectPort: typeof injectPort === 'number' ? injectPort : null,
        hubSessionId: hubSessionId ?? base.binding.hubSessionId ?? null,
        sdkSessionId: base.binding.sdkSessionId,
        agentProfileId: base.agentProfileId,
        requestedRuntimeId: base.requestedRuntimeId,
        runtimeId: base.runtimeId,
        runtimeFound: base.runtimeFound,
        usedDefaultRuntimeFallback: base.usedDefaultRuntimeFallback,
        runtimeFallbackWarning: base.runtimeFallbackWarning,
        agentRuntimes: base.agentRuntimes,
        runtimeTopologyLabel: formatTerminalRuntimeTopology(base.agentRuntimes),
        runtimeSessionId: base.runtimeSessionId,
        workspace: getWorkspaceContext(),
        turnCount: timeline.turns.length,
        bridgeTurnCount: timeline.bridgeTurnCount,
        timelineSource: timeline.timelineSource,
        timelineAuthority: timeline.timelineAuthority,
        timelineReconciliationStatus: timeline.reconciliationStatus,
        timelineTurnCount: timeline.turns.length,
        persistedTimelineTurnCount: timeline.totalPersistedTurns,
        liveBridgeTailCount: timeline.liveBridgeTailCount,
        timelineSyncStatus: timeline.sync.status,
        timelineSyncReason: timeline.sync.reason,
        timelineSyncPendingCount: timeline.sync.pendingCount,
        timelineSyncSyncedCount: timeline.sync.syncedCount,
        timelineSyncFailedCount: timeline.sync.failedCount,
        timelineSyncLastError: timeline.sync.lastError,
        timelineSyncAttempts: timeline.sync.attempts,
        timelineSyncNextRetryAt: timeline.sync.nextRetryAt,
        activity: readTerminalActivitySnapshot(),
        lifecycle,
        lifecycleSummary: buildRuntimeLifecycleSummary(lifecycle),
        pendingElicitations: elicitationSummary.pending,
        latestElicitationMode: elicitationSummary.latest?.mode ?? null,
        pendingPermissions: permissionSummary.pending,
        latestPermissionType: permissionSummary.latest?.permissionType ?? null,
        pendingUserInputs: userInputSummary.pending,
        latestUserInputKind: userInputSummary.latest?.kind ?? null,
        permissionMode,
        sdkCapabilities,
    };
}
