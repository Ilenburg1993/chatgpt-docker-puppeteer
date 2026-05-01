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
import { listTerminalElicitations, readTerminalPermissionSummary } from '../../sdk-interactions.js';
import { readTerminalTurnCount } from '../gateways/dialog.js';
import {
    formatTerminalRuntimeTopology,
    normalizeTerminalModelBillingProjection,
    readTerminalRuntimeBase,
} from './shared.js';

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
 *     lastPrInfo: Record<string, any> | null;
 *     modelBilling: import('./shared.js').TerminalModelBillingProjection;
 *     recommendedAction: import('../../../presentation/types.js').RuntimeRecommendedAction | null;
 *     sdkSessionMode: 'interactive' | 'plan' | 'autopilot' | 'shell' | null;
 *     sdkPlanOperation: 'create' | 'update' | 'delete' | null;
 *     sdkPlanChangedAt: number | null;
 *     injectPort: number | null;
 *     hubSessionId: string | null;
 *     sdkSessionId: string | null;
 *     requestedRuntimeId: string | null;
 *     runtimeId: string;
 *     runtimeFound: boolean;
 *     usedDefaultRuntimeFallback: boolean;
 *     agentRuntimes: import('./shared.js').TerminalRuntimeBase['agentRuntimes'];
 *     runtimeTopologyLabel: string;
 *     runtimeSessionId: string | null;
 *     workspace: ReturnType<typeof getWorkspaceContext>;
 *     turnCount: number;
 *     activity: import('../../activity-state.js').TerminalActivitySnapshot;
 *     lifecycle: ReturnType<typeof readRuntimeLifecycleSnapshot>;
 *     lifecycleSummary: ReturnType<typeof buildRuntimeLifecycleSummary>;
 *     pendingElicitations: number;
 *     pendingPermissions: number;
 *     latestPermissionType: string | null;
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
    const permissionSummary = readTerminalPermissionSummary();
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
        lastPrInfo: base.lastPrInfo,
        modelBilling,
        recommendedAction,
        sdkSessionMode: getSdkSessionMode(),
        sdkPlanOperation: getLastSdkPlanOperation(),
        sdkPlanChangedAt: getLastSdkPlanChangedAt(),
        injectPort: typeof injectPort === 'number' ? injectPort : null,
        hubSessionId: hubSessionId ?? base.binding.hubSessionId ?? null,
        sdkSessionId: base.binding.sdkSessionId,
        requestedRuntimeId: base.requestedRuntimeId,
        runtimeId: base.runtimeId,
        runtimeFound: base.runtimeFound,
        usedDefaultRuntimeFallback: base.usedDefaultRuntimeFallback,
        agentRuntimes: base.agentRuntimes,
        runtimeTopologyLabel: formatTerminalRuntimeTopology(base.agentRuntimes),
        runtimeSessionId: base.runtimeSessionId,
        workspace: getWorkspaceContext(),
        turnCount: readTerminalTurnCount(),
        activity: readTerminalActivitySnapshot(),
        lifecycle,
        lifecycleSummary: buildRuntimeLifecycleSummary(lifecycle),
        pendingElicitations: listTerminalElicitations().length,
        pendingPermissions: permissionSummary.pending,
        latestPermissionType: permissionSummary.latest?.permissionType ?? null,
    };
}
