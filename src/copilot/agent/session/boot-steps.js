// @ts-check
/**
 * src/copilot/agent/session/boot-steps.js
 *
 * K5b: etapas reais do pipeline de boot extraídas de `boot-wiring.js`.
 *
 * O objetivo deste módulo é concentrar a lógica operacional das steps, deixando `boot-wiring.js` como runner e ponto de
 * composição do pipeline público.
 *
 * @module copilot/agent/session/boot-steps
 * @internal
 */

import {
    EMITTER_AGENT_METRICS,
    EMITTER_DIALOG_BOOT_RECOVERY,
    EMITTER_MCP_RECONNECTED,
    EMITTER_QUESTION_ANSWERED,
    EMITTER_SESSION_CLEANUP,
    EMITTER_SESSION_KEEPALIVE,
} from '#copilot/events';
import { BOOT_RECOVERY_DELAY_MS, MCP_RECONNECT_MS, METRICS_INTERVAL_MS } from '../../config/agent.js';
import { logSwallowed, toError } from '../../core/error-handlers.js';
import { registerTimer } from '../../core/timer-registry.js';
import { getAgentSdkModelStatsTracker, isAgentSdkExperimentalEnabled } from '../facades/agent-sdk-access.js';
import { persistStateWithPolicy, readStateAsync } from '../lifecycle/state-io.js';
import { startDefaultMcpAutoReconnect } from '../ports/mcp-port.js';
import {
    createAgentEventObserver,
    defaultErrorTracker,
    defaultEventCollector,
    defaultMetrics,
    log,
} from '../ports/observability-port.js';
import { resolveAgentUserInput } from '../ports/tool-port.js';
import { cleanupStaleSessionsWithPolicy } from './cleanup.js';
import { wireSessionEvents } from './event-wirer.js';

/**
 * @typedef {import('#copilot/sdk/types').CopilotClient} CopilotClient
 *
 * @typedef {import('#copilot/sdk/types').CopilotSession} CopilotSession
 *
 * @typedef {import('../dialog/loop-manager.js').DialogLoopManager} DialogLoopManager
 *
 * @typedef {import('../session/keepalive.js').SessionKeepalive} SessionKeepalive
 */

/**
 * Callbacks e referências passados pelo AlwaysAliveAgent para evitar acoplamento direto.
 *
 * @typedef {Object} BootWiringContext
 * @property {(event: string, payload?: unknown) => boolean} emit
 * @property {() => import('../types.js').AgentStatusSnapshot} getStatusSnapshot
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
 * @property {(options?: { isIdle?: () => boolean; onKeepalive?: (ts: number) => void }) => boolean} startKeepalive
 * @property {() => { boots: number; resumesWithPR: number; resumesZeroPR: number; totalPR: number } | null} getDialogPrMetrics
 * @property {(task: Promise<unknown>, meta?: { label?: string; description?: string }) => Promise<void>} trackBackgroundTask
 * @property {() => {
 *     startAutoReconnect: (
 *         onTools: (tools: import('#copilot/sdk/types').Tool[]) => void,
 *         intervalMs: number,
 *     ) => () => void;
 * } | null} [getMcpBridgeSnapshot]
 * @property {({
 *           startAutoReconnect: (
 *               onTools: (tools: import('#copilot/sdk/types').Tool[]) => void,
 *               intervalMs: number,
 *           ) => () => void;
 *       } | null)
 *     | undefined} mcpBridge
 */

/**
 * Estado mutável interno do pipeline de boot wiring.
 *
 * @typedef {Object} BootWiringPipelineState
 * @property {(() => void)[]} unsubs
 * @property {{
 *     attach: (agent: import('node:events').EventEmitter) => void;
 *     attachToBus?: (bus: import('../../core/event-bus.js').EventBus) => void;
 *     detach: () => void;
 * } | null} agentObserver
 * @property {ReturnType<typeof setInterval> | null} metricsTimer
 * @property {(() => void) | null} mcpReconnectCancel
 * @property {import('#copilot/sdk/quota-monitor').QuotaMonitor | null} quotaMonitor
 * @property {import('../types.js').AgentBootStepResult[]} stepReports
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
 * @param {import('node:events').EventEmitter} agentEmitter
 * @param {BootWiringPipelineState} state
 * @param {{ eventBus?: import('../../core/event-bus.js').EventBus }} [options]
 * @returns {void}
 */
export function stepAttachAgentObserver(agentEmitter, state, options) {
    const agentObserver = createAgentEventObserver({
        metrics: defaultMetrics,
        errorTracker: defaultErrorTracker,
        modelStatsTracker: getAgentSdkModelStatsTracker(),
    });
    if (options?.eventBus) {
        agentObserver.attachToBus(options.eventBus);
    } else {
        agentObserver.attach(agentEmitter);
    }
    state.agentObserver = agentObserver;
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
                for (let i = 0; i < result.deleted; i++) defaultMetrics.recordSessionCleanup();
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

/**
 * @param {BootWiringContext} ctx
 * @returns {void}
 */
export function scheduleDialogBootRecovery(ctx) {
    log('DEBUG', '[AlwaysAlive] F53/F42.1: Recovery do dialog loop agendado após resume.');
    const bootRecoveryTimer = setTimeout(() => {
        if (ctx.getStatus() === 'stopped') {
            return;
        }

        void ctx.trackBackgroundTask(runDialogBootRecovery(ctx), {
            label: 'dialog.boot_recovery.run',
            description: 'Retry dialog loop recovery after resumed session boot',
        });
    }, BOOT_RECOVERY_DELAY_MS);
    bootRecoveryTimer.unref?.();
    registerTimer('agent.dialogBootRecovery', 'timeout', bootRecoveryTimer);
}

/**
 * Executa a rotina assíncrona de boot recovery do dialog loop.
 *
 * @param {BootWiringContext} ctx
 * @returns {Promise<void>}
 */
export async function runDialogBootRecovery(ctx) {
    const status = ctx.getStatus();
    if (ctx.dialogLoopActive()) {
        log('DEBUG', '[AlwaysAlive] F53: Boot recovery dispensado — dialog loop já está ativo.');
        return;
    }
    if (status === 'processing') {
        log('DEBUG', '[AlwaysAlive] F53: Boot recovery dispensado — boot normal ainda está processando.');
        return;
    }
    if (status !== 'idle' && status !== 'waiting_for_input') {
        log('DEBUG', `[AlwaysAlive] F53: Boot recovery dispensado — status atual '${status}' não permite resume.`);
        return;
    }

    try {
        ctx.ensureDialogLoopAttached();
        const pausedPersist = await persistStateWithPolicy(
            { dialogPaused: true },
            { label: 'dialog.boot_recovery.pause' },
        );
        if (!pausedPersist.ok) {
            logSwallowed(pausedPersist.error, 'agent.bootWiring.persistDialogPaused');
        }
        await ctx.resumeDialogLoop();
        log('INFO', '[AlwaysAlive] F53: Dialog loop retomado após boot recovery.');
        ctx.emit(EMITTER_DIALOG_BOOT_RECOVERY, { zeroPR: !ctx.dialogLoopActive(), ts: Date.now() });
    } catch (e) {
        log('WARN', `[AlwaysAlive] F53: Boot recovery falhou (${toError(e).message}) — fallback para startDialogLoop.`);
        try {
            await ctx.startDialogLoop();
        } catch (e2) {
            log('WARN', `[AlwaysAlive] F53: Fallback startDialogLoop também falhou: ${toError(e2).message}`);
        }
    }
}

/**
 * @param {boolean} isResumed
 * @param {BootWiringContext} ctx
 * @returns {void}
 */
export function stepScheduleDialogRecovery(isResumed, ctx) {
    if (!isResumed) {
        return;
    }

    void ctx.trackBackgroundTask(
        readStateAsync().then((savedState) => {
            if (savedState?.dialogLoopActive && !savedState?.dialogPaused) {
                scheduleDialogBootRecovery(ctx);
            }
        }),
        {
            label: 'dialog.boot_recovery.schedule',
            description: 'Read persisted state to schedule dialog boot recovery',
        },
    );
}

/**
 * @param {BootWiringContext} ctx
 * @param {BootWiringPipelineState} state
 * @returns {void}
 */
export function stepStartMetricsTimer(ctx, state) {
    if (METRICS_INTERVAL_MS <= 0) {
        state.metricsTimer = null;
        return;
    }

    const metricsTimer = setInterval(() => {
        reapExpiredPendingQuestionShadow(ctx);
        ctx.emit(EMITTER_AGENT_METRICS, ctx.getStatusSnapshot());
    }, METRICS_INTERVAL_MS);
    metricsTimer.unref();
    registerTimer('agent.metricsEmit', 'interval', metricsTimer);
    state.metricsTimer = metricsTimer;
}

/**
 * Reap contínuo da shadow persistida de `ask_user` quando ela já expirou em runtime.
 *
 * Mantém a regra: nunca limpar pergunta viva do SDK; apenas a shadow restaurada do disco.
 *
 * @param {BootWiringContext} ctx
 * @returns {boolean}
 */
export function reapExpiredPendingQuestionShadow(ctx) {
    if (ctx.hasPendingQuestion() || !ctx.hasPendingQuestionShadow() || !ctx.isPendingQuestionShadowExpired()) {
        return false;
    }

    ctx.clearPendingQuestionShadow();
    void ctx.trackBackgroundTask(
        persistStateWithPolicy(
            { pendingQuestion: null, pendingQuestionMeta: null },
            { label: 'state.pendingQuestionShadow.reap' },
        ).then((result) => {
            if (!result.ok) {
                throw result.error;
            }
            return undefined;
        }),
        {
            label: 'state.pendingQuestionShadow.reap',
            description: 'Reap expired ask_user shadow during runtime metrics tick',
        },
    );
    return true;
}

/**
 * @param {BootWiringContext} ctx
 * @param {BootWiringPipelineState} state
 * @returns {void}
 */
export function stepStartMcpReconnect(ctx, state) {
    const mcpBridge = ctx.getMcpBridgeSnapshot?.() ?? ctx.mcpBridge ?? null;
    const _mcpBridgeFn = mcpBridge?.startAutoReconnect ?? startDefaultMcpAutoReconnect;
    state.mcpReconnectCancel = _mcpBridgeFn((/** @type {import('#copilot/sdk/types').Tool[]} */ tools) => {
        ctx.emit(EMITTER_MCP_RECONNECTED, { toolCount: tools.length, ts: Date.now() });
    }, MCP_RECONNECT_MS);
}

/**
 * @param {BootWiringContext} ctx
 * @returns {void}
 */
export function stepStartKeepalive(ctx) {
    ctx.startKeepalive({
        isIdle: () => ctx.getStatus() === 'idle',
        onKeepalive: (/** @type {number} */ ts) => {
            defaultMetrics.recordKeepalivePing();
            ctx.emit(EMITTER_SESSION_KEEPALIVE, { ts });
        },
    });
}

/**
 * @param {import('node:events').EventEmitter} agentEmitter
 * @param {BootWiringContext} ctx
 * @param {BootWiringPipelineState} state
 * @returns {void}
 */
export function stepWireHandoff(agentEmitter, ctx, state) {
    if (isAgentSdkExperimentalEnabled('fleet')) {
        const onHandoff = (
            /**
             * @type {{
             *     fromAgent: string;
             *     toAgent: string;
             *     reason?: string;
             *     context?: Record<string, unknown>;
             * }}
             */ data,
        ) => {
            ctx.receiveHandoff(data);
            defaultMetrics.recordHandoff();
        };
        agentEmitter.on('session.handoff', onHandoff);
        state.unsubs.push(() => agentEmitter.off('session.handoff', onHandoff));
    } else {
        log('DEBUG', '[BootWiring] Handoff wiring desabilitado (experimental.fleet não habilitado).');
    }
}

/**
 * @param {import('node:events').EventEmitter} agentEmitter
 * @param {BootWiringContext} ctx
 * @param {BootWiringPipelineState} state
 * @returns {void}
 */
export function stepWireQuestionAnsweredRelay(agentEmitter, ctx, state) {
    const onQuestionAnswered = (/** @type {{ answer?: string }} */ evt) => {
        if (typeof evt?.answer !== 'string') return;
        const answer = evt.answer;
        void ctx.trackBackgroundTask(Promise.resolve(resolveAgentUserInput(answer)), {
            label: 'hooks.question_answered.relay',
            description: 'Relay question.answered answers into hook tools resolver',
        });
    };
    agentEmitter.on(EMITTER_QUESTION_ANSWERED, onQuestionAnswered);
    state.unsubs.push(() => agentEmitter.off(EMITTER_QUESTION_ANSWERED, onQuestionAnswered));
}
