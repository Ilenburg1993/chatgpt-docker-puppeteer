// @ts-check
/**
 * src/copilot/agent/lifecycle/agent-lifecycle.js
 *
 * F36: Lógica de lifecycle do agente — start(), stop(), initSession().
 *
 * Funções extraídas de always-alive.js que operam sobre o AgentContext e o EventEmitter do agente. Reduz o tamanho do
 * always-alive.js em ~300L.
 *
 * @module copilot/agent/lifecycle/agent-lifecycle
 * @internal
 * @see EventBus
 */

import { EVENT_BUS, isShuttingDown, SessionError, toError } from '#copilot/core';
import {
    EMITTER_BEFORE_STOP,
    EMITTER_DIALOG_LOOP_CHANGED,
    EMITTER_ERROR,
    EMITTER_READY,
    EMITTER_STATUS,
    EMITTER_STOPPED,
} from '#copilot/events';
import { container } from '../../core/di-container.js';
import { logSwallowed } from '../../core/error-handlers.js';
import { defaultErrorTracker } from '../ports/error-tracking-port.js';
import { initEventCollector } from '../ports/event-observer-port.js';
import { log } from '../ports/logging-port.js';
import { defaultMetrics } from '../ports/metrics-port.js';
import { buildTelemetryConfig, startSpan } from '../ports/tracing-port.js';

import { getHubSessionId, setSharedSdkSessionId } from '#copilot/core';
import { SHUTDOWN_TIMEOUT_MS, STOP_BOOT_WAIT_MS } from '../../config/agent.js';
import {
    persistAgentRuntimeGracefulShutdownState,
    persistAgentRuntimePrConsumptionSnapshot,
    resetAgentRuntimeGracefulShutdownFlag,
    restoreAgentRuntimePersistentBootState,
    saveAgentRuntimeShutdownSnapshot,
} from '../facades/agent-runtime-state.js';
import {
    createAgentSdkClient,
    disconnectAgentSdkSession,
    ensureAgentSdkClientStarted,
    raceAgentSdkEvents,
    stopAgentSdkClient,
} from '../facades/agent-sdk-access.js';
import { tryReconnect } from '../lifecycle/reconnect-policy.js';
import {
    buildSessionHooks,
    buildSessionOptions,
    buildSessionTools,
    finalizeSessionInit,
} from '../lifecycle/session-setup.js';
import { resolveConversationStore } from '../ports/conversation-port.js';
import { unbindAgentSessionTools } from '../ports/tool-port.js';
import { performBootWiring } from '../session/boot-wiring.js';
import { syncSdkHistory } from '../session/history-sync.js';
import { initOrResumeSession } from '../session/initializer.js';
import {
    clearActiveSdkSessionOwnershipWithPolicy,
    syncActiveSessionOwnershipWithPolicy,
} from '../session/ownership.js';

/**
 * @typedef {import('../agent-context.js').AgentContext} AgentContext
 *
 * @typedef {import('#copilot/sdk/types').CopilotSession} CopilotSession
 *
 * @typedef {import('../types.js').AgentStatus} AgentStatus
 */

/** @typedef {import('../types.js').LifecycleHost} LifecycleHost */

/**
 * @typedef {import('../types.js').AgentStartPhaseResult} AgentStartPhaseResult
 *
 * @typedef {AgentStartPhaseResult['phase']} AgentStartPhase
 */

/**
 * Inicializa (ou reinicializa) a sessão SDK.
 *
 * @param {AgentContext} ctx
 * @param {import('#copilot/sdk/types').CopilotClient} client
 * @param {LifecycleHost} host
 * @returns {Promise<{ session: CopilotSession; isResumed: boolean }>}
 */
export async function initSession(ctx, client, host) {
    await ensureAgentSdkClientStarted(client);
    const { tools } = await buildSessionTools(ctx);
    const { busHooks } = buildSessionHooks(ctx, host);
    const options = buildSessionOptions(ctx, host, { tools, busHooks });

    const { session, isResumed, model, reasoningEffort } = await initOrResumeSession(client, options);

    ctx.setModel(model);
    ctx.setReasoningEffort(reasoningEffort);

    finalizeSessionInit(ctx, session, isResumed);
    return { session, isResumed };
}

/**
 * Finaliza o runtime governado por uma sessão SDK já criada/retomada.
 *
 * Este é o ponto canônico pós-`initSession`: boot inicial e reconexão precisam refazer os mesmos wirings para que
 * eventos SDK, observabilidade, quota, MCP, keepalive, dialog recovery e relays operacionais fiquem sempre coerentes.
 *
 * @param {AgentContext} ctx
 * @param {LifecycleHost & import('node:events').EventEmitter} host
 * @param {import('#copilot/sdk/types').CopilotClient} client
 * @param {CopilotSession} session
 * @param {boolean} isResumed
 * @param {{ ownershipLabel?: string; emitReady?: boolean; readyExtra?: Record<string, unknown> }} [options]
 * @returns {Promise<void>}
 */
async function wireAgentSessionRuntime(ctx, host, client, session, isResumed, options = {}) {
    const ownershipSync = await syncActiveSessionOwnershipWithPolicy(
        session.sessionId,
        {
            getHubSessionId,
            setSharedSdkSessionId,
            conversationStore: resolveConversationStore(container),
        },
        { label: options.ownershipLabel ?? 'agent.session.ownership.sync' },
    );
    if (!ownershipSync.ok) {
        log('WARN', `[AlwaysAlive] Ownership sync degradado: ${ownershipSync.error.message}`);
    }

    const previousAgentObserver = ctx.getAgentObserverSnapshot();
    if (previousAgentObserver) {
        previousAgentObserver.detach();
        ctx.clearAgentObserver();
    }

    const previousMetricsTimer = ctx.getMetricsTimerSnapshot();
    if (previousMetricsTimer) {
        clearInterval(previousMetricsTimer);
        ctx.clearMetricsTimer();
    }

    const previousMcpReconnectCancel = ctx.getMcpReconnectCancelSnapshot();
    if (previousMcpReconnectCancel) {
        previousMcpReconnectCancel();
        ctx.clearMcpReconnectCancel();
    }

    ctx.stopQuotaMonitor();

    const eventBus = container.resolve(EVENT_BUS) ?? undefined;
    const bootResult = await performBootWiring(
        client,
        session,
        isResumed,
        host,
        {
            emit: (event, payload) => host.emit(event, payload),
            getStatusSnapshot: () => host.getStatusSnapshot(),
            onCheckpointPath: (path) => {
                ctx.setLastCheckpointPath(path);
            },
            onContextState: (state) => {
                ctx.setContextState(state);
            },
            onPrInfo: (info) => {
                ctx.setLastPrInfo(info);
                void ctx.trackBackgroundTask(
                    persistAgentRuntimePrConsumptionSnapshot(info).then(() => undefined),
                    {
                        label: 'state.pr_consumed.persist',
                        description: 'Persist latest PR consumption snapshot',
                    },
                );
            },
            isProcessing: () => ctx.isProcessing(),
            dialogLoopActive: () => ctx.isDialogLoopActive(),
            getSessionId: () => host.sessionId,
            getStatus: () => ctx.getRuntimeStatus(),
            hasPendingQuestion: () => ctx.hasPendingQuestion(),
            hasPendingQuestionShadow: () => ctx.hasPendingQuestionShadow(),
            isPendingQuestionShadowExpired: () => ctx.isPendingQuestionShadowExpired(),
            clearPendingQuestionShadow: () => ctx.clearPendingQuestionShadow(),
            dialogLoop: ctx.getDialogLoopManagerSnapshot(),
            keepalive: ctx.getKeepaliveManagerSnapshot(),
            receiveHandoff: (event) => ctx.receiveHandoff(event),
            ensureDialogLoopAttached: () => host.ensureDialogLoopAttached(),
            resumeDialogLoop: () => host.resumeDialogLoop(),
            startDialogLoop: () => host.startDialogLoop(),
            startKeepalive: (keepaliveOptions) => ctx.startKeepalive(keepaliveOptions),
            getDialogPrMetrics: () => host.dialogPrMetrics,
            trackBackgroundTask: (task, meta) => ctx.trackBackgroundTask(task, meta),
            mcpBridge: ctx.getMcpBridgeSnapshot(),
            getMcpBridgeSnapshot: () => ctx.getMcpBridgeSnapshot(),
        },
        { eventBus },
    );
    ctx.setBootReport(bootResult.bootReport);
    ctx.setSessionEventUnsubscribers(bootResult.unsubs);
    if (bootResult.agentObserver) {
        ctx.setAgentObserver(bootResult.agentObserver);
    } else {
        ctx.clearAgentObserver();
    }
    if (bootResult.metricsTimer) {
        ctx.setMetricsTimer(bootResult.metricsTimer);
    } else {
        ctx.clearMetricsTimer();
    }
    if (bootResult.mcpReconnectCancel) {
        ctx.setMcpReconnectCancel(bootResult.mcpReconnectCancel);
    } else {
        ctx.clearMcpReconnectCancel();
    }
    if (bootResult.quotaMonitor) {
        ctx.setQuotaMonitor(bootResult.quotaMonitor);
    } else {
        ctx.clearQuotaMonitor();
    }
    if (bootResult.error) {
        throw bootResult.error;
    }

    ctx.setStatus('idle', host);
    await restoreAgentRuntimePersistentBootState(ctx);

    log('INFO', `[AlwaysAlive] Agente pronto. SessionId: ${session.sessionId} (${isResumed ? 'retomada' : 'nova'})`);

    if (isResumed) {
        const convStore = resolveConversationStore(container);
        if (convStore) {
            void ctx.trackBackgroundTask(
                syncSdkHistory(session, (event, payload) => host.emit(event, payload), {
                    getHubSessionId,
                    conversationStore: convStore,
                }),
                {
                    label: 'session.history.sync',
                    description: 'Sync resumed session history into conversation store',
                },
            );
        }
    }

    if (options.emitReady !== false) {
        host.emit(EMITTER_READY, { sessionId: session.sessionId, isResumed, ...(options.readyExtra ?? {}) });
    }
}

/**
 * Limpa recursos alocados por um `agentStart()` que falhou antes de publicar `ready`.
 *
 * A rotina é deliberadamente best-effort: preserva o erro original do boot e apenas registra falhas de rollback. Ela
 * cobre o caso crítico em que `initSession()` já finalizou uma sessão e `performBootWiring()` falhou em alguma etapa
 * posterior, deixando client/session/listeners/timers parcialmente vivos.
 *
 * @param {AgentContext} ctx
 * @param {LifecycleHost & import('node:events').EventEmitter} host
 * @param {Error} cause
 * @returns {Promise<void>}
 */
async function rollbackFailedAgentStart(ctx, host, cause) {
    log('WARN', `[AlwaysAlive] Rollback de start parcial iniciado: ${cause.message}`);

    if (ctx.getDialogLoopAttachedSnapshot()) {
        ctx.detachDialogLoopListeners();
    }
    if (ctx.isDialogLoopActive()) {
        ctx.forceDeactivateDialogLoop();
        host.emit(EMITTER_DIALOG_LOOP_CHANGED, { active: false, ts: Date.now(), reason: 'agent_start_failed' });
    }

    const metricsTimer = ctx.getMetricsTimerSnapshot();
    if (metricsTimer) {
        clearInterval(metricsTimer);
        ctx.clearMetricsTimer();
    }
    const mcpReconnectCancel = ctx.getMcpReconnectCancelSnapshot();
    if (mcpReconnectCancel) {
        mcpReconnectCancel();
        ctx.clearMcpReconnectCancel();
    }
    ctx.stopQuotaMonitor();
    ctx.stopKeepalive('agent_start_failed');
    defaultMetrics.stopPeriodicSnapshot();

    const drainedBackgroundTasks = await ctx.drainBackgroundTasks(1000);
    if (!drainedBackgroundTasks) {
        log('WARN', '[AlwaysAlive] Background tasks ainda pendentes após rollback de start parcial.');
    }

    const remainingTasks = ctx.drainMessageQueue(
        new SessionError('[AlwaysAlive] Agente falhou durante startup.', 'AGENT_START_FAILED'),
    );
    if (remainingTasks.length > 0) {
        log('WARN', `[AlwaysAlive] Rejeitando ${remainingTasks.length} tarefa(s) pendente(s) no rollback de start.`);
    }

    const agentObserver = ctx.getAgentObserverSnapshot();
    if (agentObserver) {
        agentObserver.detach();
        ctx.clearAgentObserver();
    }

    const sessionEventUnsubscribers = ctx.getSessionEventUnsubscribersSnapshot();
    for (const unsub of sessionEventUnsubscribers) unsub();
    ctx.clearSessionEventUnsubscribers();

    const session = ctx.getSessionSnapshot();
    if (session) {
        try {
            await disconnectAgentSdkSession(session);
        } catch (e) {
            log('WARN', `[AlwaysAlive] Erro ao desconectar sessão no rollback de start: ${toError(e).message}`);
        }
        ctx.clearSession();
        ctx.invalidateMessagesCache();
        unbindAgentSessionTools();
    }

    const client = ctx.getClientSnapshot();
    if (client) {
        try {
            const stopErrors = await stopAgentSdkClient(client);
            if (stopErrors.length > 0) {
                log(
                    'WARN',
                    `[AlwaysAlive] SDK client.stop() no rollback retornou erros: ${stopErrors
                        .map((e) => toError(e).message)
                        .join('; ')}`,
                );
            }
        } catch (e) {
            log('WARN', `[AlwaysAlive] Erro ao parar client SDK no rollback de start: ${toError(e).message}`);
        }
        ctx.clearClient();
    }

    const clearedOwnership = await clearActiveSdkSessionOwnershipWithPolicy(
        {
            getHubSessionId,
            setSharedSdkSessionId,
        },
        { label: 'agent.start.rollback.ownership.clear' },
    );
    if (!clearedOwnership.ok) {
        log('WARN', `[AlwaysAlive] Ownership clear degradado no rollback de start: ${clearedOwnership.error.message}`);
    }

    ctx.invalidateStatusSnapshot();
}

/**
 * Inicia o agente: conecta ao CLI e cria/retoma sessão.
 *
 * @param {AgentContext} ctx
 * @param {LifecycleHost & import('node:events').EventEmitter} host
 * @returns {Promise<void>}
 */
export async function agentStart(ctx, host) {
    if (!ctx.isStopped()) {
        log('WARN', `[AlwaysAlive] start() ignorado: agente já está em estado '${ctx.getRuntimeStatus()}'.`);
        return;
    }

    const startStartedAt = Date.now();
    /** @type {AgentStartPhaseResult[]} */
    const startPhases = [];
    ctx.setStatus('starting', host);
    log('INFO', '[AlwaysAlive] Iniciando agente...');

    try {
        await runAgentStartPhase(startPhases, 'graceful-shutdown-reset', 'preflight', async () => {
            const resetShutdown = await resetAgentRuntimeGracefulShutdownFlag();
            if (!resetShutdown.ok) {
                log(
                    'WARN',
                    `[AlwaysAlive] gracefulShutdown=false não persistido no startup: ${resetShutdown.error.message}`,
                );
            }
        });

        await runAgentStartPhase(startPhases, 'event-collector.init', 'preflight', async () => {
            initEventCollector({
                metrics: defaultMetrics,
                errorTracker: defaultErrorTracker,
                persist: true,
            });
        });

        // registerGlobalHandlers é chamado por entry.js (process.on handlers com logging)
        // para evitar duplicação, não registramos aqui.
        await runAgentStartPhase(startPhases, 'metrics.periodic.start', 'preflight', async () => {
            defaultMetrics.startPeriodicSnapshot();
        });

        const client = await runAgentStartPhase(startPhases, 'sdk.client.create', 'client', async () => {
            const otelConfig = buildTelemetryConfig();
            const nextClient = createAgentSdkClient(otelConfig ? { telemetry: otelConfig } : {});
            ctx.setClient(nextClient);
            return nextClient;
        });

        const { session, isResumed } = await runAgentStartPhase(startPhases, 'sdk.session.init', 'session', () =>
            startSpan('copilot.session.init', { model: ctx.getModelSnapshot() }, () => initSession(ctx, client, host)),
        );

        await runAgentStartPhase(startPhases, 'agent.session.runtime.wire', 'wiring', () =>
            wireAgentSessionRuntime(ctx, host, client, session, isResumed, {
                ownershipLabel: 'agent.start.ownership.sync',
            }),
        );

        ctx.setStartReport(buildAgentStartReport(startStartedAt, startPhases, true, null, null));
    } catch (e) {
        const error = toError(e);
        const failedPhase = findLastFailedAgentStartPhase(startPhases);
        await runAgentStartPhase(startPhases, 'agent.start.rollback', 'rollback', () =>
            rollbackFailedAgentStart(ctx, host, error),
        ).catch((rollbackError) => {
            log('WARN', `[AlwaysAlive] Rollback de start parcial falhou: ${toError(rollbackError).message}`);
        });
        ctx.setStartReport(buildAgentStartReport(startStartedAt, startPhases, false, failedPhase, error.message));
        ctx.setStatus('stopped', host);
        log('ERROR', `[AlwaysAlive] Falha ao iniciar: ${error.message}`);
        host.emit(EMITTER_ERROR, e);
        throw e;
    }
}

/**
 * @param {AgentStartPhaseResult[]} phases
 * @returns {string | null}
 */
function findLastFailedAgentStartPhase(phases) {
    for (let index = phases.length - 1; index >= 0; index--) {
        const phase = phases[index];
        if (phase?.status === 'failed') return phase.name;
    }
    return null;
}

/**
 * @template T
 * @param {AgentStartPhaseResult[]} phases
 * @param {string} name
 * @param {AgentStartPhase} phase
 * @param {() => T | Promise<T>} fn
 * @returns {Promise<T>}
 */
async function runAgentStartPhase(phases, name, phase, fn) {
    const startedAt = Date.now();
    try {
        const value = await Promise.resolve(fn());
        const completedAt = Date.now();
        phases.push({
            name,
            phase,
            status: 'ok',
            startedAt,
            completedAt,
            durationMs: completedAt - startedAt,
            error: null,
        });
        return value;
    } catch (error) {
        const completedAt = Date.now();
        phases.push({
            name,
            phase,
            status: 'failed',
            startedAt,
            completedAt,
            durationMs: completedAt - startedAt,
            error: toError(error).message,
        });
        throw error;
    }
}

/**
 * @param {number} startedAt
 * @param {AgentStartPhaseResult[]} phases
 * @param {boolean} ok
 * @param {string | null} failedPhase
 * @param {string | null} error
 * @returns {import('../types.js').AgentStartReport}
 */
function buildAgentStartReport(startedAt, phases, ok, failedPhase, error) {
    const completedAt = Date.now();
    return {
        startedAt,
        completedAt,
        durationMs: completedAt - startedAt,
        ok,
        failedPhase,
        error,
        phaseCount: phases.length,
        failedCount: phases.filter((phase) => phase.status === 'failed').length,
        phases: phases.map((phase) => ({ ...phase })),
    };
}

/**
 * Para o agente graciosamente.
 *
 * @param {AgentContext} ctx
 * @param {LifecycleHost & import('node:events').EventEmitter} host
 * @param {{ shutdownTimeoutMs?: number; preserveDialogLoopIntent?: boolean }} [opts]
 * @returns {Promise<void>}
 */
export async function agentStop(
    ctx,
    host,
    { shutdownTimeoutMs = SHUTDOWN_TIMEOUT_MS, preserveDialogLoopIntent = false } = {},
) {
    if (ctx.isStopped()) return;

    return startSpan('copilot.agent.stop', { sessionId: host.sessionId ?? '', actor: 'agent' }, async () => {
        log('INFO', '[AlwaysAlive] Parando agente...');

        const restoreDialogLoopOnNextBoot =
            preserveDialogLoopIntent &&
            !ctx.isDialogLoopPaused() &&
            (ctx.isDialogLoopActive() || ctx.hasPendingQuestion() || ctx.hasPendingQuestionShadow());

        host.emit(EMITTER_BEFORE_STOP);
        host.removeAllListeners('before-stop');

        if (ctx.isStarting()) {
            log('INFO', '[AlwaysAlive] stop() durante boot — aguardando conclusão (máx 15s)...');
            await raceAgentSdkEvents(host, ['ready', 'error'], { timeoutMs: STOP_BOOT_WAIT_MS }).catch((e) =>
                logSwallowed(e, 'agent.lifecycle.stopBootWait'),
            );
        }

        if (ctx.isProcessing() || ctx.isWaitingForInput()) {
            log('INFO', `[AlwaysAlive] Aguardando tarefa atual terminar (até ${shutdownTimeoutMs}ms)...`);
            /** @type {ReturnType<typeof setTimeout> | null} */
            let shutdownTimeoutHandle = null;
            try {
                await Promise.race([
                    new Promise((resolve) => {
                        const onIdle = () => {
                            if (!ctx.isProcessing() && !ctx.isWaitingForInput()) {
                                host.off(EMITTER_STATUS, onIdle);
                                resolve(undefined);
                            }
                        };
                        host.on(EMITTER_STATUS, onIdle);
                    }),
                    new Promise((resolve) => {
                        shutdownTimeoutHandle = setTimeout(resolve, shutdownTimeoutMs);
                    }),
                ]);
            } finally {
                if (shutdownTimeoutHandle !== null) {
                    clearTimeout(shutdownTimeoutHandle);
                }
            }
        }

        if (ctx.getDialogLoopAttachedSnapshot()) {
            ctx.detachDialogLoopListeners();
        }
        if (ctx.isDialogLoopActive()) {
            ctx.forceDeactivateDialogLoop();
            host.emit(EMITTER_DIALOG_LOOP_CHANGED, { active: false, ts: Date.now() });
        }

        try {
            await saveAgentRuntimeShutdownSnapshot(ctx, {
                sessionId: host.sessionId ?? null,
                dialogLoopActive: restoreDialogLoopOnNextBoot,
                dialogPrMetrics: host.dialogPrMetrics,
                reason: 'auto-shutdown',
            });
        } catch (e) {
            log('WARN', `[AlwaysAlive] Auto-save snapshot falhou: ${toError(e).message}`);
        }

        const persistedShutdown = await persistAgentRuntimeGracefulShutdownState(ctx, {
            dialogLoopActive: restoreDialogLoopOnNextBoot,
        });
        if (!persistedShutdown.ok) {
            log('WARN', `[AlwaysAlive] writeState sendCount falhou: ${persistedShutdown.error.message}`);
        }

        const metricsTimer = ctx.getMetricsTimerSnapshot();
        if (metricsTimer) {
            clearInterval(metricsTimer);
            ctx.clearMetricsTimer();
        }
        const mcpReconnectCancel = ctx.getMcpReconnectCancelSnapshot();
        if (mcpReconnectCancel) {
            mcpReconnectCancel();
            ctx.clearMcpReconnectCancel();
        }
        ctx.stopQuotaMonitor();
        ctx.stopKeepalive('agent_shutdown');
        defaultMetrics.stopPeriodicSnapshot();

        const drainedBackgroundTasks = await ctx.drainBackgroundTasks(5000);
        if (!drainedBackgroundTasks) {
            log('WARN', '[AlwaysAlive] Background tasks ainda pendentes após drain(5000ms).');
        }

        ctx.setStatus('stopped', host);

        const remainingTasks = ctx.drainMessageQueue(
            new SessionError('[AlwaysAlive] Agente parado durante shutdown gracioso.', 'AGENT_STOPPED'),
        );
        ctx.invalidateStatusSnapshot();
        if (remainingTasks.length > 0) {
            log('WARN', `[AlwaysAlive] Rejeitando ${remainingTasks.length} tarefa(s) pendente(s) no shutdown.`);
        }

        const agentObserver = ctx.getAgentObserverSnapshot();
        if (agentObserver) {
            agentObserver.detach();
            ctx.clearAgentObserver();
        }

        const sessionEventUnsubscribers = ctx.getSessionEventUnsubscribersSnapshot();
        for (const unsub of sessionEventUnsubscribers) unsub();
        ctx.clearSessionEventUnsubscribers();

        const session = ctx.getSessionSnapshot();
        if (session) {
            try {
                await disconnectAgentSdkSession(session);
            } catch (e) {
                log('WARN', `[AlwaysAlive] Erro ao desconectar sessão: ${toError(e).message}`);
            }
            ctx.clearSession();
            ctx.invalidateMessagesCache();
            unbindAgentSessionTools();
        }

        const client = ctx.getClientSnapshot();
        if (client) {
            try {
                const stopErrors = await stopAgentSdkClient(client);
                if (stopErrors.length > 0) {
                    log(
                        'WARN',
                        `[AlwaysAlive] SDK client.stop() erros: ${stopErrors.map((e) => toError(e).message).join('; ')}`,
                    );
                }
            } catch (e) {
                log('WARN', `[AlwaysAlive] Erro ao parar client SDK: ${toError(e).message}`);
            }
            ctx.clearClient();
        }

        const clearedOwnership = await clearActiveSdkSessionOwnershipWithPolicy(
            {
                getHubSessionId,
                setSharedSdkSessionId,
            },
            { label: 'agent.stop.ownership.clear' },
        );
        if (!clearedOwnership.ok) {
            log('WARN', `[AlwaysAlive] Ownership clear degradado no shutdown: ${clearedOwnership.error.message}`);
        }

        host.emit(EMITTER_STOPPED);
    }); // startSpan copilot.agent.stop
}

/**
 * Tenta reconectar à sessão SDK com backoff exponencial + jitter.
 *
 * @param {AgentContext} ctx
 * @param {LifecycleHost & import('node:events').EventEmitter} host
 * @param {Error} originalError
 * @param {{ maxAttempts?: number; baseDelayMs?: number }} [opts]
 * @returns {Promise<boolean>}
 */
export async function agentTryReconnect(ctx, host, originalError, opts = {}) {
    if (isShuttingDown()) {
        log('INFO', '[AlwaysAlive] Reconexão ignorada: processo em shutdown.');
        return false;
    }
    ctx.setReconnectState(true);
    try {
        return await tryReconnect(
            originalError,
            /** @type {import('#copilot/sdk/types').CopilotClient} */ (ctx.getClientSnapshot()),
            ctx.getRuntimeStatus(),
            {
                emit: (event, payload) => host.emit(event, payload),
                initSession: (client) => initSession(ctx, client, host),
                dialogLoop: ctx.getDialogLoopManagerSnapshot(),
                clearSessionEventUnsubs: () => {
                    const sessionEventUnsubscribers = ctx.getSessionEventUnsubscribersSnapshot();
                    for (const unsub of sessionEventUnsubscribers) unsub();
                    ctx.clearSessionEventUnsubscribers();
                },
                createClient: () => {
                    const _otelConfig = buildTelemetryConfig();
                    return createAgentSdkClient(_otelConfig ? { telemetry: _otelConfig } : {});
                },
                updateClient: (newClient) => {
                    ctx.setClient(newClient);
                },
                onSessionReady: (activeClient, session, isResumed) =>
                    wireAgentSessionRuntime(ctx, host, activeClient, session, isResumed, {
                        ownershipLabel: 'agent.reconnect.ownership.sync',
                        emitReady: false,
                    }),
            },
            { ...opts, shouldAbort: isShuttingDown },
        );
    } finally {
        ctx.setReconnectState(false);
    }
}
