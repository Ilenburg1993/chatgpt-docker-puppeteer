// @ts-check
/**
 * Projection family: status.
 */

import { getWorkspaceContext } from '#copilot/boot';
import { readSystemPromptStatusSync } from '#copilot/config';
import { readIoRuntimeHealthSnapshot } from '#copilot/infra/public/observability';
import { buildRuntimeSdkFsRoutingProjection } from '../../../presentation/files/index.js';
import { buildRuntimeLifecycleSummary, readRuntimeLifecycleSnapshot } from '../../../presentation/runtime/index.js';
import {
    getLastSdkPlanChangedAt,
    getLastSdkPlanOperation,
    getSdkSessionMode,
} from '../../../presentation/state/index.js';
import {
    readTerminalActivitySnapshot,
    readTerminalElicitationSummary,
    readTerminalPermissionSummary,
    readTerminalUserInputSummary,
    renderTerminalPendingQuestionKindLabel,
} from '../../state/projections/index.js';
import {
    getTerminalPendingStructuredUserInputCount,
    getTerminalSdkSessionCapabilities,
    listTerminalPendingStructuredUserInputs,
    readTerminalToolRegistrySnapshot,
} from '../gateways/index.js';
import {
    formatTerminalRuntimeTopology,
    normalizeTerminalModelBillingProjection,
    readTerminalRuntimeBase,
} from './shared.js';
import { readTerminalTimelineProjection } from './timeline.js';

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function objectOrNull(value) {
    return value && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : null;
}

/**
 * @param {{ hubSessionId?: string | null; injectPort?: number; runtimeId?: string | null }} input
 * @returns {{
 *     snap: Record<string, unknown>;
 *     health: Record<string, any> | null;
 *     dialogLoopActive: boolean;
 *     pendingQuestion: boolean;
 *     pendingQuestionKind: import('../../../presentation/contracts/index.js').RuntimePendingQuestionKind | null;
 *     pendingQuestionText: string | null;
 *     pendingQuestionShadow: boolean;
 *     pendingQuestionShadowKind: import('../../../presentation/contracts/index.js').RuntimePendingQuestionKind | null;
 *     pendingQuestionShadowState:
 *         import('../../../presentation/contracts/index.js').RuntimePendingQuestionShadowState | null;
 *     pendingQuestionShadowText: string | null;
 *     pendingQuestionShadowExpired: boolean;
 *     pendingQuestionShadowAgeMs: number | null;
 *     pendingQuestionShadowExpiresAt: number | null;
 *     pendingQuestionShadowRemainingMs: number | null;
 *     systemPromptBinding: Record<string, unknown> | null;
 *     systemPromptFreshness: Record<string, unknown> | null;
 *     lastPrInfo: Record<string, any> | null;
 *     modelBilling: import('./shared.js').TerminalModelBillingProjection;
 *     recommendedAction: import('../../../presentation/contracts/index.js').RuntimeRecommendedAction | null;
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
 *     activity: import('../../state/activity-state.js').TerminalActivitySnapshot;
 *     lifecycle: ReturnType<typeof readRuntimeLifecycleSnapshot>;
 *     lifecycleSummary: ReturnType<typeof buildRuntimeLifecycleSummary>;
 *     pendingElicitations: number;
 *     latestElicitationMode: string | null;
 *     pendingPermissions: number;
 *     latestPermissionType: string | null;
 *     pendingUserInputs: number;
 *     pendingStructuredUserInputs: number;
 *     dialogInputChannel: {
 *         state: 'offline' | 'paused' | 'ready' | 'standby' | 'waiting-human' | 'shadow' | 'missing' | 'processing';
 *         label: string;
 *         detail: string;
 *         canAcceptTurn: boolean;
 *         recoveryExpected: boolean;
 *     };
 *     latestUserInput: ReturnType<typeof readTerminalUserInputSummary>['latest'];
 *     latestStructuredUserInput: ReturnType<typeof listTerminalPendingStructuredUserInputs>[number] | null;
 *     latestUserInputKind: 'question' | 'ready' | 'reply' | 'stopped' | null;
 *     permissionMode: 'approve_all' | 'audit_only' | 'selective';
 *     sdkCapabilities: Record<string, unknown> | null;
 *     toolLoad: {
 *         total: number;
 *         categories: Record<string, number>;
 *         disabled: string[];
 *         disabledRecords: { name: string; source: 'runtime' | 'session'; reason: string; disabledAt: string }[];
 *         hasCanonicalLocalFsTools: boolean;
 *         hasCanonicalLocalExecTools: boolean;
 *         hasSdkWorkspaceTooling: boolean;
 *         hasLegacySdkShellToolsLoaded: boolean;
 *         toolContract: {
 *             ok: boolean;
 *             errorCount: number;
 *             warningCount: number;
 *             noticeCount: number;
 *             decisionCount: number;
 *             riskySkipPermissionCount: number;
 *             autonomySkipPermissionCount: number;
 *             permissionMode: 'approve_all' | 'audit_only' | 'selective';
 *             metadataCoverage: {
 *                 descriptionPct: number;
 *                 parametersPct: number;
 *                 categoryPct: number;
 *                 tagsPct: number;
 *                 instructionsPct: number;
 *             };
 *         };
 *     };
 *     instructionLoad: {
 *         liveReloadMechanism: 'sdk-transform' | 'static-snapshot';
 *         sectionCount: number;
 *         sectionsMissingFileCount: number;
 *         appendFileMissingCount: number;
 *         sdkSupportsInstructionSourcesRpc: boolean;
 *     };
 *     sdkFsRouting: {
 *         canonicalFsReady: boolean;
 *         sdkWorkspaceAvailable: boolean;
 *         mode: 'local-fs-primary' | 'sdk-workspace-only' | 'degraded';
 *         reason: string;
 *     };
 *     ioRuntime: ReturnType<typeof readIoRuntimeHealthSnapshot>;
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
    const recommendedAction =
        /** @type {import('../../../presentation/contracts/index.js').RuntimeRecommendedAction | null} */ (
            typeof base.health?.['recommendedAction'] === 'string' ? base.health['recommendedAction'] : null
        );
    const lifecycle = readRuntimeLifecycleSnapshot();
    const modelBilling = normalizeTerminalModelBillingProjection(
        base.lastPrInfo,
        String(base.model ?? base.snap['model'] ?? ''),
    );
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
    const toolLoadSnapshot = readTerminalToolRegistrySnapshot();
    const promptStatus = readSystemPromptStatusSync();
    const toolLoad = {
        total: toolLoadSnapshot.total,
        categories: toolLoadSnapshot.categories,
        disabled: toolLoadSnapshot.disabled,
        disabledRecords: toolLoadSnapshot.disabledRecords,
        hasCanonicalLocalFsTools: toolLoadSnapshot.hasCanonicalLocalFsTools,
        hasCanonicalLocalExecTools: toolLoadSnapshot.hasCanonicalLocalExecTools,
        hasSdkWorkspaceTooling: toolLoadSnapshot.hasSdkWorkspaceTooling,
        hasLegacySdkShellToolsLoaded: toolLoadSnapshot.hasLegacySdkShellToolsLoaded,
        toolContract: {
            ok: toolLoadSnapshot.toolContract.ok,
            errorCount: toolLoadSnapshot.toolContract.errorCount,
            warningCount: toolLoadSnapshot.toolContract.warningCount,
            noticeCount: toolLoadSnapshot.toolContract.noticeCount,
            decisionCount: toolLoadSnapshot.toolContract.decisionCount,
            riskySkipPermissionCount: toolLoadSnapshot.toolContract.riskySkipPermissionCount,
            autonomySkipPermissionCount: toolLoadSnapshot.toolContract.autonomySkipPermissionCount,
            permissionMode: toolLoadSnapshot.toolContract.permissionMode,
            metadataCoverage: toolLoadSnapshot.toolContract.metadataCoverage,
        },
    };
    const sectionsMissingFileCount = promptStatus.sections.filter((section) => section.file.exists !== true).length;
    const appendFileMissingCount = promptStatus.appendFiles.filter((file) => file.exists !== true).length;
    const instructionLoad = {
        liveReloadMechanism: promptStatus.liveReloadMechanism,
        sectionCount: promptStatus.sectionCount,
        sectionsMissingFileCount,
        appendFileMissingCount,
        sdkSupportsInstructionSourcesRpc: promptStatus.sdkCompatibility.supportsInstructionSourcesRpc,
    };
    const sdkWorkspaceAvailable =
        objectOrNull(sdkCapabilities?.['tools'])?.['workspace'] === true || toolLoad.hasSdkWorkspaceTooling;
    const canonicalFsReady = toolLoad.hasCanonicalLocalFsTools;
    const sdkFsRouting = buildRuntimeSdkFsRoutingProjection({ canonicalFsReady, sdkWorkspaceAvailable });
    const ioRuntime = readIoRuntimeHealthSnapshot();
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
        pendingStructuredUserInputs: getTerminalPendingStructuredUserInputCount(),
        dialogInputChannel: buildDialogInputChannelProjection({
            dialogLoopActive: base.dialogLoopActive,
            dialogPaused: base.dialogPaused,
            runtimeStatus: String(base.snap['status'] ?? 'unknown'),
            pendingQuestion: pendingQuestion !== null,
            pendingQuestionKind: base.pendingQuestionKind,
            pendingQuestionShadow: pendingQuestionShadow !== null,
            pendingQuestionShadowKind: base.pendingQuestionShadowKind,
            pendingQuestionShadowExpired: base.pendingQuestionShadowExpired,
        }),
        latestUserInput: userInputSummary.latest ?? null,
        latestStructuredUserInput: listTerminalPendingStructuredUserInputs().at(-1) ?? null,
        latestUserInputKind: userInputSummary.latest?.kind ?? null,
        permissionMode,
        sdkCapabilities,
        toolLoad,
        instructionLoad,
        sdkFsRouting,
        ioRuntime,
    };
}

/**
 * Projeta a diferença entre a sessão SDK viva, a conversa ativa e o canal `ask_user` materializado.
 *
 * Uma conversa ativa e idle sem prontidão viva não é necessariamente falha: no modo de sessão retomada, o próximo turno
 * pode usar recuperação/envio direto sob demanda. O estado `missing` fica reservado para o caso mais suspeito: runtime
 * `waiting_for_input` sem pergunta viva.
 *
 * @param {{
 *     dialogLoopActive: boolean;
 *     dialogPaused: boolean;
 *     runtimeStatus: string;
 *     pendingQuestion: boolean;
 *     pendingQuestionKind: import('../../../presentation/contracts/index.js').RuntimePendingQuestionKind | null;
 *     pendingQuestionShadow: boolean;
 *     pendingQuestionShadowKind: import('../../../presentation/contracts/index.js').RuntimePendingQuestionKind | null;
 *     pendingQuestionShadowExpired: boolean;
 * }} input
 * @returns {{
 *     state: 'offline' | 'paused' | 'ready' | 'standby' | 'waiting-human' | 'shadow' | 'missing' | 'processing';
 *     label: string;
 *     detail: string;
 *     canAcceptTurn: boolean;
 *     recoveryExpected: boolean;
 * }}
 */
function buildDialogInputChannelProjection(input) {
    if (input.dialogPaused) {
        return {
            state: 'paused',
            label: 'pausado',
            detail: 'conversa pausada; input humano não será entregue ao modelo até resume',
            canAcceptTurn: false,
            recoveryExpected: false,
        };
    }
    if (!input.dialogLoopActive) {
        return {
            state: 'offline',
            label: 'offline',
            detail: 'conversa inativa; próximo turno precisa iniciar ou retomar a sessão',
            canAcceptTurn: false,
            recoveryExpected: true,
        };
    }
    if (input.pendingQuestion) {
        if (input.pendingQuestionKind === 'ready') {
            return {
                state: 'ready',
                label: 'pronto protocolar',
                detail: 'pergunta protocolar de prontidão está aguardando a próxima mensagem',
                canAcceptTurn: true,
                recoveryExpected: false,
            };
        }
        if (input.pendingQuestionKind === 'question' || input.pendingQuestionKind === null) {
            return {
                state: 'waiting-human',
                label: 'pergunta humana',
                detail: 'pergunta ao operador está pendente; a próxima linha responde a pergunta',
                canAcceptTurn: false,
                recoveryExpected: false,
            };
        }
        return {
            state: 'processing',
            label: `protocolo ${renderTerminalPendingQuestionKindLabel(input.pendingQuestionKind)}`,
            detail: 'mensagem protocolar transitória da conversa está em processamento',
            canAcceptTurn: false,
            recoveryExpected: false,
        };
    }
    if (input.pendingQuestionShadow && !input.pendingQuestionShadowExpired) {
        return {
            state: 'shadow',
            label: `pergunta restaurada ${renderTerminalPendingQuestionKindLabel(
                input.pendingQuestionShadowKind,
                'sem tipo',
            )}`,
            detail: 'há sombra persistida de pergunta sem pergunta viva; recuperação pode reaproveitar ou limpar',
            canAcceptTurn: input.pendingQuestionShadowKind === 'ready',
            recoveryExpected: true,
        };
    }
    if (input.runtimeStatus === 'idle') {
        return {
            state: 'standby',
            label: 'standby sem prontidão viva',
            detail: 'sessão e conversa estão ativas; próximo turno usa recuperação/envio direto sob demanda',
            canAcceptTurn: true,
            recoveryExpected: true,
        };
    }
    if (input.runtimeStatus === 'waiting_for_input') {
        return {
            state: 'missing',
            label: 'pergunta ausente',
            detail: 'ambiente aguarda input, mas não há pergunta viva materializada no terminal',
            canAcceptTurn: false,
            recoveryExpected: true,
        };
    }
    return {
        state: 'processing',
        label: input.runtimeStatus,
        detail: 'runtime não está idle; input ordinário deve aguardar o turno atual',
        canAcceptTurn: false,
        recoveryExpected: false,
    };
}
