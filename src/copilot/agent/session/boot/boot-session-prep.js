// @ts-check
/**
 * @module copilot/agent/session/boot-session-prep
 * @file Seams de preparação de sessão no pipeline de boot.
 */

import { EMITTER_SESSION_CLEANUP } from '#copilot/events';
import { defaultEventCollector, defaultMetrics } from '../../ports/index.js';
import { cleanupStaleSessionsWithPolicy } from '../lifecycle/index.js';
import { wireSessionEvents } from '../wiring/index.js';

/**
 * @typedef {import('#copilot/sdk/types').CopilotClient} CopilotClient
 *
 * @typedef {import('#copilot/sdk/types').CopilotSession} CopilotSession
 *
 * @typedef {import('../../dialog/orchestrators/loop-manager.js').DialogLoopManager} DialogLoopManager
 *
 * @typedef {import('../lifecycle/keepalive.js').SessionKeepalive} SessionKeepalive
 *
 * @typedef {import('../../ports/index.js').AgentMcpCapability} AgentMcpCapability
 */

/**
 * @typedef {Object} BootWiringContext
 * @property {(event: string, payload?: unknown) => boolean} emit
 * @property {() => import('../../types.js').AgentStatusSnapshot} getStatusSnapshot
 * @property {(path: string) => void} onCheckpointPath
 * @property {(state: { tokens: number; tokenLimit: number; utilization: number } | null) => void} onContextState
 * @property {(info: { model?: string; cost?: number; quotaSnapshots?: Record<string, unknown>; ts: number }) => void} onPrInfo
 * @property {() => boolean} isProcessing
 * @property {() => boolean} dialogLoopActive
 * @property {() => string | null} getSessionId
 * @property {() => string} getStatus
 * @property {() => boolean} hasPendingQuestion
 * @property {() => boolean} hasPendingQuestionShadow
 * @property {() => boolean} isPendingQuestionShadowExpired
 * @property {() => void} clearPendingQuestionShadow
 * @property {DialogLoopManager} dialogLoop
 * @property {SessionKeepalive} keepalive
 * @property {(event: {
 *     fromAgent: string;
 *     toAgent: string;
 *     reason?: string;
 *     context?: Record<string, unknown>;
 * }) => void} receiveHandoff
 * @property {() => void} ensureDialogLoopAttached
 * @property {() => Promise<void>} resumeDialogLoop
 * @property {() => Promise<void>} startDialogLoop
 * @property {(options?: {
 *     isIdle?: () => boolean;
 *     onKeepalive?: (info: { ts: number; strategy: 'client.ping' | 'session.send' }) => void;
 * }) => boolean} startKeepalive
 * @property {() => { boots: number; resumesWithPR: number; resumesZeroPR: number; totalPR: number } | null} getDialogPrMetrics
 * @property {(task: Promise<unknown>, meta?: { label?: string; description?: string }) => Promise<void>} trackBackgroundTask
 * @property {() => AgentMcpCapability | null} [getMcpBridgeSnapshot]
 * @property {AgentMcpCapability | null | undefined} mcpBridge
 */

/**
 * @typedef {Object} BootWiringPipelineState
 * @property {(() => void)[]} unsubs
 * @property {{
 *     attach: (agent: import('node:events').EventEmitter) => void;
 *     attachToBus?: (bus: import('../../../core/event-bus.js').EventBus) => void;
 *     detach: () => void;
 * } | null} agentObserver
 * @property {ReturnType<typeof setInterval> | null} metricsTimer
 * @property {(() => void) | null} mcpReconnectCancel
 * @property {import('#copilot/sdk/quota-monitor').QuotaMonitor | null} quotaMonitor
 * @property {import('../../types.js').AgentBootStepResult[]} stepReports
 * @property {number} bootStartedAt
 */

/**
 * Cria o estado inicial do pipeline de boot wiring.
 *
 * @returns {BootWiringPipelineState}
 */
export function createBootWiringState() {
    return {
        unsubs: [],
        agentObserver: null,
        metricsTimer: null,
        mcpReconnectCancel: null,
        quotaMonitor: null,
        stepReports: [],
        bootStartedAt: Date.now(),
    };
}

/**
 * @param {CopilotSession} session
 * @param {boolean} isResumed
 * @param {BootWiringContext} ctx
 * @param {BootWiringPipelineState} state
 * @returns {void}
 */
export function stepWireSessionEvents(session, isResumed, ctx, state) {
    const sessionUnsubs = wireSessionEvents(session, isResumed, {
        emit: ctx.emit,
        getStatusSnapshot: ctx.getStatusSnapshot,
        onCheckpointPath: ctx.onCheckpointPath,
        onContextState: ctx.onContextState,
        onPrInfo: ctx.onPrInfo,
        isProcessing: ctx.isProcessing,
        dialogLoopActive: ctx.dialogLoopActive,
    });
    state.unsubs.push(...sessionUnsubs);
}

/**
 * @param {CopilotSession} session
 * @param {BootWiringPipelineState} state
 * @returns {void}
 */
export function stepAttachEventCollector(session, state) {
    const collectorUnsubs = defaultEventCollector.attach(session, session.sessionId ?? 'unknown');
    state.unsubs.push(...collectorUnsubs);
}

/**
 * @param {CopilotClient} client
 * @param {CopilotSession} session
 * @param {BootWiringContext} ctx
 * @returns {void}
 */
export function stepCleanupStaleSessions(client, session, ctx) {
    void ctx.trackBackgroundTask(
        cleanupStaleSessionsWithPolicy(
            client,
            { currentSessionId: session.sessionId },
            { label: 'session.cleanup.stale', phase: 'boot', sessionId: session.sessionId },
        ).then((policyResult) => {
            if (!policyResult.ok) {
                return;
            }
            const result = policyResult.value;
            if (result.deleted > 0) {
                for (let i = 0; i < result.deleted; i++) {
                    defaultMetrics.recordSessionCleanup();
                }
            }
            if (result.deleted > 0 || result.errors.length > 0) {
                ctx.emit(EMITTER_SESSION_CLEANUP, result);
            }
        }),
        {
            label: 'session.cleanup.stale',
            description: 'Cleanup stale SDK sessions after boot',
        },
    );
}
