// @ts-check
/**
 * src/copilot/agent/session/boot/boot-wiring.js
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

import { toError } from '#copilot/core';
import { EMITTER_QUOTA_WARNING, EMITTER_SDK_LIFECYCLE } from '#copilot/events';
import { withAgentErrorPolicy } from '../../error-policy.js';
import { attachAgentSdkBootLifecycleBridge, startAgentSdkBootQuotaBridge } from '../../facades/agent-sdk-access.js';
import { log } from '../../ports/logging-port.js';
import { defaultMetrics } from '../../ports/metrics-port.js';
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
 * @typedef {import('../lifecycle/keepalive.js').SessionKeepalive} SessionKeepalive
 *
 * @typedef {import('../../dialog/orchestrators/loop-manager.js').DialogLoopManager} DialogLoopManager
 *
 * @typedef {import('../../ports/mcp-port.js').AgentMcpCapability} AgentMcpCapability
 */

/**
 * Callbacks e referências passados pelo AlwaysAliveAgent para evitar acoplamento direto.
 *
 * @typedef {Object} BootWiringContext
 * @property {(event: string, payload?: unknown) => boolean} emit — Emitir evento no agente
 * @property {() => import('../../types.js').AgentStatusSnapshot} getStatusSnapshot
 * @property {(path: string) => void} onCheckpointPath — Atualizar checkpoint path
 * @property {(state: { tokens: number; tokenLimit: number; utilization: number } | null) => void} onContextState
 * @property {(info: {
 *     model?: string;
 *     configuredModel?: string;
 *     modelMismatch?: boolean;
 *     sessionId?: string | null;
 *     cost?: number;
 *     quotaSnapshots?: Record<string, unknown>;
 *     ts: number;
 * }) => void} onPrInfo
 * @property {() => boolean} isProcessing — Retorna true se status === 'processing'
 * @property {() => boolean} dialogLoopActive — Retorna true se dialog loop ativo
 * @property {() => string | null} getSessionId — Retorna sessionId
 * @property {() => string} getStatus — Retorna status atual do agente
 * @property {() => boolean} hasPendingQuestion — Indica se há pergunta viva do SDK
 * @property {() => boolean} hasPendingQuestionShadow — Indica se há shadow persistida restaurada
 * @property {() => boolean} isPendingQuestionShadowExpired — Indica se a shadow persistida já expirou
 * @property {() => void} clearPendingQuestionShadow — Limpa a shadow persistida restaurada do disco
 * @property {DialogLoopManager} dialogLoop — Referência ao DialogLoopManager
 * @property {SessionKeepalive} keepalive — Referência ao SessionKeepalive
 * @property {(event: {
 *     fromAgent: string;
 *     toAgent: string;
 *     reason?: string;
 *     context?: Record<string, unknown>;
 * }) => void} receiveHandoff
 * @property {() => void} ensureDialogLoopAttached — Garante DLM attached
 * @property {() => Promise<void>} resumeDialogLoop — Retoma dialog loop
 * @property {() => Promise<void>} startDialogLoop — Inicia dialog loop
 * @property {(options?: {
 *     isIdle?: () => boolean;
 *     onKeepalive?: (info: { ts: number; strategy: 'client.ping' | 'session.send' }) => void;
 * }) => boolean} startKeepalive
 *   — Inicia o keepalive usando o contexto semântico atual do runtime
 * @property {() => { boots: number; resumesWithPR: number; resumesZeroPR: number; totalPR: number } | null} getDialogPrMetrics
 * @property {(task: Promise<unknown>, meta?: { label?: string; description?: string }) => Promise<void>} trackBackgroundTask
 *   — Tracker central de tarefas em background do agente
 * @property {() => AgentMcpCapability | null} [getMcpBridgeSnapshot]
 * @property {AgentMcpCapability | null | undefined} mcpBridge — Ponte MCP injetável (F69)
 */

/**
 * Resultado do boot wiring — contém unsubs e recursos que precisam de cleanup no stop().
 *
 * @typedef {Object} BootWiringResult
 * @property {(() => void)[]} unsubs — Funções de unsubscribe de eventos
 * @property {{
 *     attach: (agent: import('node:events').EventEmitter) => void;
 *     attachToBus?: (bus: import('../../../core/event-bus.js').EventBus) => void;
 *     detach: () => void;
 * } | null} agentObserver
 * @property {ReturnType<typeof setInterval> | null} metricsTimer
 * @property {(() => void) | null} mcpReconnectCancel
 * @property {import('#copilot/sdk/quota-monitor').QuotaMonitor | null} quotaMonitor — Monitor de quota (F118, Faixa 25)
 * @property {import('../../types.js').AgentBootReport} bootReport - Relatório consolidado do pipeline de boot
 * @property {Error | null} [error] - Erro capturado durante a execução de alguma etapa
 */

/**
 * Estado mutável interno do pipeline de boot wiring.
 *
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
 * Etapa nomeada do pipeline de boot.
 *
 * @typedef {Object} BootWiringStep
 * @property {string} name
 * @property {'session'
 *     | 'observability'
 *     | 'lifecycle'
 *     | 'dialog'
 *     | 'mcp'
 *     | 'keepalive'
 *     | 'quota'
 *     | 'handoff'
 *     | 'hooks'
 *     | 'other'} phase
 * @property {boolean} required
 * @property {() => void | Promise<void>} run
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

    const unsubLifecycle = attachAgentSdkBootLifecycleBridge(client, (event) => {
        const level = event.type === 'session.updated' ? 'DEBUG' : 'INFO';
        log(level, `[AlwaysAlive] SDK lifecycle: ${event.type} id=${event.sessionId}`);
        ctx.emit(EMITTER_SDK_LIFECYCLE, event);
    });
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
        const quotaMonitor = startAgentSdkBootQuotaBridge({
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
 * @param {{ eventBus?: import('../../../core/event-bus.js').EventBus }} [options]
 * @returns {BootWiringStep[]}
 */
export function createBootWiringSteps(client, session, isResumed, agentEmitter, ctx, state, options) {
    return [
        {
            name: 'wireSessionEvents',
            phase: 'session',
            required: true,
            run: () => stepWireSessionEvents(session, isResumed, ctx, state),
        },
        {
            name: 'attachEventCollector',
            phase: 'observability',
            required: false,
            run: () => stepAttachEventCollector(session, state),
        },
        {
            name: 'registerClientLifecycleHandlers',
            phase: 'lifecycle',
            required: false,
            run: () => stepRegisterClientLifecycleHandlers(client, ctx, state),
        },
        {
            name: 'attachAgentObserver',
            phase: 'observability',
            required: false,
            run: () => stepAttachAgentObserver(agentEmitter, state, options),
        },
        {
            name: 'cleanupStaleSessions',
            phase: 'session',
            required: false,
            run: () => stepCleanupStaleSessions(client, session, ctx),
        },
        {
            name: 'scheduleDialogRecovery',
            phase: 'dialog',
            required: false,
            run: () => stepScheduleDialogRecovery(isResumed, ctx, state),
        },
        {
            name: 'startMetricsTimer',
            phase: 'observability',
            required: false,
            run: () => stepStartMetricsTimer(ctx, state),
        },
        {
            name: 'startMcpReconnect',
            phase: 'mcp',
            required: false,
            run: () => stepStartMcpReconnect(ctx, state),
        },
        {
            name: 'startKeepalive',
            phase: 'keepalive',
            required: false,
            run: () => stepStartKeepalive(ctx),
        },
        {
            name: 'startQuotaMonitor',
            phase: 'quota',
            required: false,
            run: () => stepStartQuotaMonitor(client, ctx, state),
        },
        {
            name: 'wireHandoff',
            phase: 'handoff',
            required: false,
            run: () => stepWireHandoff(agentEmitter, ctx, state),
        },
        {
            name: 'wireQuestionAnsweredRelay',
            phase: 'hooks',
            required: false,
            run: () => stepWireQuestionAnsweredRelay(agentEmitter, ctx, state),
        },
    ];
}

/**
 * Executa uma única etapa do pipeline de boot sob a policy canônica do agent.
 *
 * @param {BootWiringStep} step
 * @param {BootWiringPipelineState} state
 * @returns {Promise<void>}
 */
async function runBootStepWithPolicy(step, state) {
    const startedAt = Date.now();
    log('DEBUG', `[BootWiring] step ${step.name}...`);

    const result = await withAgentErrorPolicy(() => step.run(), {
        label: `boot.${step.name}`,
        phase: step.phase,
    });
    if (result.ok) {
        state.stepReports.push({
            name: step.name,
            phase: step.phase,
            status: 'ok',
            durationMs: Date.now() - startedAt,
            ts: Date.now(),
        });
        log('DEBUG', `[BootWiring] step ${step.name} ✓`);
        return;
    }

    const status = result.disposition === 'ignore' ? 'skipped' : !step.required ? 'degraded' : 'failed';
    const level = status === 'failed' ? 'ERROR' : status === 'degraded' ? 'WARN' : 'DEBUG';

    state.stepReports.push({
        name: step.name,
        phase: step.phase,
        status,
        durationMs: Date.now() - startedAt,
        ts: Date.now(),
        error: result.error.message,
    });
    log(level, `[BootWiring] step ${step.name} ${status} (${result.disposition}): ${result.error.message}`);

    if (status === 'failed') {
        throw result.error;
    }
}

/**
 * Executa o pipeline de boot wiring em ordem.
 *
 * @param {BootWiringStep[]} steps
 * @param {BootWiringPipelineState} state
 * @returns {Promise<void>}
 */
export async function runBootPipeline(steps, state) {
    for (const step of steps) {
        await runBootStepWithPolicy(step, state);
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
 * @param {{ eventBus?: import('../../../core/event-bus.js').EventBus }} [options] - Opções adicionais (FAIXA-L14)
 * @returns {Promise<BootWiringResult>}
 */
export async function performBootWiring(client, session, isResumed, agentEmitter, ctx, options) {
    const state = createBootWiringState();
    const steps = createBootWiringSteps(client, session, isResumed, agentEmitter, ctx, state, options);
    /** @type {Error | null} */
    let error = null;
    try {
        await runBootPipeline(steps, state);
    } catch (caught) {
        error = toError(caught);
    }

    const { unsubs, agentObserver, metricsTimer, mcpReconnectCancel, quotaMonitor, stepReports, bootStartedAt } = state;
    const failedCount = stepReports.filter((step) => step.status === 'failed').length;
    const degradedCount = stepReports.filter((step) => step.status === 'degraded').length;
    const bootReport = {
        startedAt: bootStartedAt,
        completedAt: Date.now(),
        ok: failedCount === 0,
        stepCount: stepReports.length,
        degradedCount,
        failedCount,
        steps: stepReports,
    };

    return {
        unsubs,
        agentObserver,
        metricsTimer,
        mcpReconnectCancel,
        quotaMonitor,
        bootReport,
        ...(error ? { error } : {}),
    };
}
