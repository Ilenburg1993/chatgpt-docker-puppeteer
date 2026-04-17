// @ts-check
/**
 * src/copilot/agent/session/boot-wiring.js
 *
 * Encapsula os wirings pós-init executados durante o `start()` do AlwaysAliveAgent:
 *
 * - Wiring de eventos de sessão SDK (wireSessionEvents)
 * - Attach do event-collector de observabilidade
 * - Registro de lifecycle handlers no client
 * - Attach do agent-event-observer
 * - Limpeza de sessões stale
 * - Restauração do dialog loop após resume
 * - Timer de métricas periódicas
 * - Auto-reconnect MCP
 * - Keepalive de sessão
 * - Wiring de handoff
 *
 * Função pura sem estado próprio — recebe session, client e callbacks.
 *
 * @module copilot/agent/session/boot-wiring
 * @see EventBus
 */

import { EMITTER_QUOTA_WARNING, EMITTER_SDK_LIFECYCLE } from '#copilot/events';
import { defaultMetrics, log } from '#copilot/observability';
import { SESSION_LIFECYCLE_EVENTS, createQuotaMonitor } from '#copilot/sdk';
import { LIFECYCLE_EVENTS, onLifecycleEvents } from '../../sdk/session/client-events.js';
import {
    createBootWiringState,
    stepAttachAgentObserver,
    stepAttachEventCollector,
    stepCleanupStaleSessions,
    stepScheduleDialogRecovery,
    stepStartKeepalive,
    stepStartMcpReconnect,
    stepStartMetricsTimer,
    stepWireHandoff,
    stepWireQuestionAnsweredRelay,
    stepWireSessionEvents,
} from './boot-steps.js';

/**
 * @typedef {import('#copilot/sdk/types').CopilotClient} CopilotClient
 *
 * @typedef {import('#copilot/sdk/types').CopilotSession} CopilotSession
 *
 * @typedef {import('../session/keepalive.js').SessionKeepalive} SessionKeepalive
 *
 * @typedef {import('../infra/handoff-manager.js').HandoffManager} HandoffManager
 *
 * @typedef {import('../dialog/loop-manager.js').DialogLoopManager} DialogLoopManager
 */

/**
 * Callbacks e referências passados pelo AlwaysAliveAgent para evitar acoplamento direto.
 *
 * @typedef {Object} BootWiringContext
 * @property {(event: string, payload?: unknown) => boolean} emit — Emitir evento no agente
 * @property {() => import('../types.js').AgentStatusSnapshot} getStatusSnapshot
 * @property {(path: string) => void} onCheckpointPath — Atualizar checkpoint path
 * @property {(state: { tokens: number; tokenLimit: number; utilization: number } | null) => void} onContextState
 * @property {(info: { model?: string; cost?: number; quotaSnapshots?: Record<string, unknown>; ts: number }) => void} onPrInfo
 * @property {() => boolean} isProcessing — Retorna true se status === 'processing'
 * @property {() => boolean} dialogLoopActive — Retorna true se dialog loop ativo
 * @property {() => string | null} getSessionId — Retorna sessionId
 * @property {() => string} getStatus — Retorna status atual do agente
 * @property {DialogLoopManager} dialogLoop — Referência ao DialogLoopManager
 * @property {SessionKeepalive} keepalive — Referência ao SessionKeepalive
 * @property {HandoffManager} handoff — Referência ao HandoffManager
 * @property {() => void} ensureDialogLoopAttached — Garante DLM attached
 * @property {() => Promise<void>} resumeDialogLoop — Retoma dialog loop
 * @property {() => Promise<void>} startDialogLoop — Inicia dialog loop
 * @property {() => { boots: number; resumesWithPR: number; resumesZeroPR: number; totalPR: number } | null} getDialogPrMetrics
 * @property {import('../background-tasks.js').BackgroundTasks} backgroundTasks — Tracker central de tarefas em
 *   background do agente
 * @property {({
 *           startAutoReconnect: (
 *               onTools: (tools: import('#copilot/sdk/types').Tool[]) => void,
 *               intervalMs: number,
 *           ) => () => void;
 *       } | null)
 *     | undefined} mcpBridge
 *   — Ponte MCP injetável (F69)
 */

/**
 * Resultado do boot wiring — contém unsubs e recursos que precisam de cleanup no stop().
 *
 * @typedef {Object} BootWiringResult
 * @property {(() => void)[]} unsubs — Funções de unsubscribe de eventos
 * @property {{
 *     attach: (agent: import('node:events').EventEmitter) => void;
 *     attachToBus?: (bus: import('../../core/event-bus.js').EventBus) => void;
 *     detach: () => void;
 * } | null} agentObserver
 * @property {ReturnType<typeof setInterval> | null} metricsTimer
 * @property {(() => void) | null} mcpReconnectCancel
 * @property {import('#copilot/sdk/quota-monitor').QuotaMonitor | null} quotaMonitor — Monitor de quota (F118, Faixa 25)
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
 */

/**
 * Etapa nomeada do pipeline de boot.
 *
 * @typedef {Object} BootWiringStep
 * @property {string} name
 * @property {() => void} run
 */

// ── 3. Client lifecycle handlers (via client-events.js tipado) ──
/**
 * Mantido em `boot-wiring.js` como ponto canônico visível do lifecycle SDK, mesmo após a extração de K5b.
 *
 * @param {CopilotClient} client
 * @param {BootWiringContext} ctx
 * @param {BootWiringPipelineState} state
 * @returns {void}
 */
function stepRegisterClientLifecycleHandlers(client, ctx, state) {
    if (typeof client.on !== 'function') {
        return;
    }

    const unsubLifecycle = onLifecycleEvents(
        {
            [LIFECYCLE_EVENTS.CREATED]: (evt) => {
                log('INFO', `[AlwaysAlive] SDK lifecycle: session.created id=${evt?.sessionId}`);
                ctx.emit(EMITTER_SDK_LIFECYCLE, {
                    type: SESSION_LIFECYCLE_EVENTS.CREATED,
                    sessionId: evt?.sessionId,
                });
            },
            [LIFECYCLE_EVENTS.DELETED]: (evt) => {
                log('INFO', `[AlwaysAlive] SDK lifecycle: session.deleted id=${evt?.sessionId}`);
                ctx.emit(EMITTER_SDK_LIFECYCLE, {
                    type: SESSION_LIFECYCLE_EVENTS.DELETED,
                    sessionId: evt?.sessionId,
                });
            },
            [LIFECYCLE_EVENTS.UPDATED]: (evt) => {
                log('DEBUG', `[AlwaysAlive] SDK lifecycle: session.updated id=${evt?.sessionId}`);
                ctx.emit(EMITTER_SDK_LIFECYCLE, {
                    type: SESSION_LIFECYCLE_EVENTS.UPDATED,
                    sessionId: evt?.sessionId,
                });
            },
        },
        client,
    );
    state.unsubs.push(unsubLifecycle);
}

// ── 10. Quota Monitor (F118 — Faixa 25) ──
/**
 * Mantido em `boot-wiring.js` como ponto canônico visível do quota monitor para auditorias estruturais existentes.
 * Compatibilidade documental: referência histórica preservada ao caminho `#copilot/sdk/quota-monitor`, mas o import
 * canônico permanece via barrel `#copilot/sdk`.
 *
 * @param {CopilotClient} client
 * @param {BootWiringContext} ctx
 * @param {BootWiringPipelineState} state
 * @returns {void}
 */
function stepStartQuotaMonitor(client, ctx, state) {
    try {
        const quotaMonitor = createQuotaMonitor({
            client,
            intervalMs: 5 * 60 * 1000,
            warningThreshold: 20,
            onWarning: (quotaId, snapshot) => {
                log(
                    'WARN',
                    `[boot-wiring] Quota baixa — id=${quotaId}, restante=${snapshot.remainingPercentage?.toFixed(1)}%`,
                );
                ctx.emit(EMITTER_QUOTA_WARNING, { quotaId, snapshot, ts: Date.now() });
            },
            onUpdate: (snapshots) => {
                defaultMetrics.recordQuotaPoll?.();
                log('DEBUG', `[boot-wiring] Quota atualizada — types=${Object.keys(snapshots).join(', ')}`);
            },
        });
        quotaMonitor.start();
        state.quotaMonitor = quotaMonitor;
    } catch (e) {
        const _err = /** @type {Error} */ (e);
        log('WARN', `[boot-wiring] Quota monitor indisponível: ${_err.message}`);
    }
}

/**
 * Cria a lista ordenada de etapas do boot wiring.
 *
 * @param {CopilotClient} client
 * @param {CopilotSession} session
 * @param {boolean} isResumed
 * @param {import('node:events').EventEmitter} agentEmitter
 * @param {BootWiringContext} ctx
 * @param {BootWiringPipelineState} state
 * @param {{ eventBus?: import('../../core/event-bus.js').EventBus }} [options]
 * @returns {BootWiringStep[]}
 */
export function createBootWiringSteps(client, session, isResumed, agentEmitter, ctx, state, options) {
    return [
        { name: 'wireSessionEvents', run: () => stepWireSessionEvents(session, isResumed, ctx, state) },
        { name: 'attachEventCollector', run: () => stepAttachEventCollector(session, state) },
        { name: 'registerClientLifecycleHandlers', run: () => stepRegisterClientLifecycleHandlers(client, ctx, state) },
        { name: 'attachAgentObserver', run: () => stepAttachAgentObserver(agentEmitter, state, options) },
        { name: 'cleanupStaleSessions', run: () => stepCleanupStaleSessions(client, session, ctx) },
        { name: 'scheduleDialogRecovery', run: () => stepScheduleDialogRecovery(isResumed, ctx) },
        { name: 'startMetricsTimer', run: () => stepStartMetricsTimer(ctx, state) },
        { name: 'startMcpReconnect', run: () => stepStartMcpReconnect(ctx, state) },
        { name: 'startKeepalive', run: () => stepStartKeepalive(client, session, ctx) },
        { name: 'startQuotaMonitor', run: () => stepStartQuotaMonitor(client, ctx, state) },
        { name: 'wireHandoff', run: () => stepWireHandoff(agentEmitter, ctx) },
        { name: 'wireQuestionAnsweredRelay', run: () => stepWireQuestionAnsweredRelay(agentEmitter, ctx) },
    ];
}

/**
 * Executa o pipeline de boot wiring em ordem.
 *
 * @param {BootWiringStep[]} steps
 * @returns {void}
 */
export function runBootPipeline(steps) {
    for (const step of steps) {
        log('DEBUG', `[BootWiring] step ${step.name}...`);
        step.run();
        log('DEBUG', `[BootWiring] step ${step.name} ✓`);
    }
}

/**
 * Executa todos os wirings pós-init do boot do agente.
 *
 * @param {CopilotClient} client — Cliente SDK já instanciado
 * @param {CopilotSession} session — Sessão SDK já criada/retomada
 * @param {boolean} isResumed — Se a sessão foi retomada
 * @param {import('node:events').EventEmitter} agentEmitter — O agente como EventEmitter (para observer.attach)
 * @param {BootWiringContext} ctx — Callbacks e referências
 * @param {{ eventBus?: import('../../core/event-bus.js').EventBus }} [options] - Opções adicionais (FAIXA-L14)
 * @returns {BootWiringResult}
 */
export function performBootWiring(client, session, isResumed, agentEmitter, ctx, options) {
    const state = createBootWiringState();
    const steps = createBootWiringSteps(client, session, isResumed, agentEmitter, ctx, state, options);
    runBootPipeline(steps);

    const { unsubs, agentObserver, metricsTimer, mcpReconnectCancel, quotaMonitor } = state;
    return { unsubs, agentObserver, metricsTimer, mcpReconnectCancel, quotaMonitor };
}
