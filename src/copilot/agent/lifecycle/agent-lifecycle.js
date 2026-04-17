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

import { CONVERSATION_STORE } from '#copilot/conversation-hub';
import { EVENT_BUS, SessionError, toError } from '#copilot/core';
import {
    EMITTER_BEFORE_STOP,
    EMITTER_DIALOG_LOOP_CHANGED,
    EMITTER_ERROR,
    EMITTER_READY,
    EMITTER_STATUS,
    EMITTER_STOPPED,
} from '#copilot/events';
import {
    buildTelemetryConfig,
    defaultErrorTracker,
    defaultMetrics,
    initEventCollector,
    log,
    startSpan,
} from '#copilot/observability';
import { CopilotClient, raceEvents } from '#copilot/sdk';
import { container } from '../../core/di-container.js';
import { logSwallowed } from '../../core/error-handlers.js';

import { getHubSessionId, setSharedSdkSessionId } from '#copilot/core';
import { SHUTDOWN_TIMEOUT_MS, STOP_BOOT_WAIT_MS } from '../../config/agent.js';
import { setExperimentalSession, setSessionRpc } from '../../tools/bootstrap.js';
import { tryReconnect } from '../lifecycle/reconnect-policy.js';
import {
    buildSessionHooks,
    buildSessionOptions,
    buildSessionTools,
    finalizeSessionInit,
} from '../lifecycle/session-setup.js';
import { readStateAsync, writeStateAsync } from '../lifecycle/state-io.js';
import { performBootWiring } from '../session/boot-wiring.js';
import { syncSdkHistory } from '../session/history-sync.js';
import { initOrResumeSession } from '../session/initializer.js';
import { clearActiveSdkSessionOwnership, syncActiveSessionOwnership } from '../session/ownership.js';
import { createSnapshot, saveSnapshotAsync } from '../session/snapshot.js';

/**
 * @typedef {import('../agent-context.js').AgentContext} AgentContext
 *
 * @typedef {import('#copilot/sdk/types').CopilotSession} CopilotSession
 *
 * @typedef {import('../types.js').AgentStatus} AgentStatus
 */

/** @typedef {import('../types.js').LifecycleHost} LifecycleHost */

/**
 * Inicializa (ou reinicializa) a sessão SDK.
 *
 * @param {AgentContext} ctx
 * @param {import('#copilot/sdk/types').CopilotClient} client
 * @param {LifecycleHost} host
 * @returns {Promise<{ session: CopilotSession; isResumed: boolean }>}
 */
export async function initSession(ctx, client, host) {
    const { tools } = await buildSessionTools(ctx);
    const { busHooks } = buildSessionHooks(ctx, host);
    const options = buildSessionOptions(ctx, host, { tools, busHooks });

    const { session, isResumed } = await initOrResumeSession(client, options);

    finalizeSessionInit(ctx, session, isResumed);
    return { session, isResumed };
}

/**
 * Inicia o agente: conecta ao CLI e cria/retoma sessão.
 *
 * @param {AgentContext} ctx
 * @param {LifecycleHost & import('node:events').EventEmitter} host
 * @returns {Promise<void>}
 */
export async function agentStart(ctx, host) {
    const sessionState = ctx.sessionState ?? ctx;
    const configState = ctx.configState ?? ctx;
    const metricsState = ctx.metricsState ?? ctx;
    const runtimeState = ctx.runtimeState ?? ctx;
    const ioState = ctx.ioState ?? ctx;

    if (ctx.status !== 'stopped') {
        log('WARN', '[AlwaysAlive] start() chamado com agente já ativo.');
        return;
    }

    ctx.setStatus('starting', host);
    log('INFO', '[AlwaysAlive] Iniciando agente...');

    void ctx.backgroundTasks.track(writeStateAsync({ gracefulShutdown: false }), {
        label: 'state.gracefulShutdown.reset',
        description: 'Persist gracefulShutdown=false at startup',
    });

    initEventCollector({
        metrics: defaultMetrics,
        errorTracker: defaultErrorTracker,
        persist: true,
    });

    // registerGlobalHandlers é chamado por entry.js (process.on handlers com logging)
    // para evitar duplicação, não registramos aqui.

    defaultMetrics.startPeriodicSnapshot();

    try {
        const _otelConfig = buildTelemetryConfig();
        const client = new CopilotClient(...(_otelConfig ? [{ telemetry: _otelConfig }] : []));
        ioState.client = client;

        const { session, isResumed } = await startSpan(
            'copilot.session.init',
            { model: configState.model ?? ctx.model },
            () => initSession(ctx, client, host),
        );

        syncActiveSessionOwnership(session.sessionId, {
            getHubSessionId,
            setSharedSdkSessionId,
            conversationStore: container.resolve(CONVERSATION_STORE) ?? null,
        });

        if (runtimeState.agentObserver) runtimeState.agentObserver.detach();
        const eventBus = container.resolve(EVENT_BUS) ?? undefined;
        const bootResult = performBootWiring(
            client,
            session,
            isResumed,
            host,
            {
                emit: (event, payload) => host.emit(event, payload),
                getStatusSnapshot: () => host.getStatusSnapshot(),
                onCheckpointPath: (path) => {
                    sessionState.lastCheckpointPath = path;
                },
                onContextState: (state) => {
                    sessionState.contextState = state;
                },
                onPrInfo: (info) => {
                    metricsState.lastPrInfo = info;
                    void ctx.backgroundTasks.track(
                        writeStateAsync({
                            pendingTurnConsumedPR: true,
                            lastPrConsumedAt: info.ts,
                            lastPrModel: info.model ?? '',
                            lastPrCost: info.cost ?? 0,
                            lastQuotaSnapshots: info.quotaSnapshots ?? null,
                        }),
                        {
                            label: 'state.pr_consumed.persist',
                            description: 'Persist latest PR consumption snapshot',
                        },
                    );
                },
                isProcessing: () => ctx.status === 'processing',
                dialogLoopActive: () => ctx.dialogLoop?.active ?? false,
                getSessionId: () => host.sessionId,
                getStatus: () => ctx.status,
                dialogLoop: ctx.dialogLoop,
                keepalive: ctx.keepalive,
                handoff: ctx.handoff,
                ensureDialogLoopAttached: () => host.ensureDialogLoopAttached(),
                resumeDialogLoop: () => host.resumeDialogLoop(),
                startDialogLoop: () => host.startDialogLoop(),
                getDialogPrMetrics: () => host.dialogPrMetrics,
                backgroundTasks: ctx.backgroundTasks,
                mcpBridge: configState.mcpBridge ?? ctx.mcpBridge ?? null,
            },
            { eventBus },
        );
        sessionState.sessionEventUnsubscribers = bootResult.unsubs;
        runtimeState.agentObserver = bootResult.agentObserver;
        runtimeState.metricsTimer = bootResult.metricsTimer;
        runtimeState.mcpReconnectCancel = bootResult.mcpReconnectCancel;
        ctx.quotaMonitor = bootResult.quotaMonitor ?? null;

        ctx.setStatus('idle', host);
        metricsState.sendCount = (await readStateAsync())?.sendCount ?? 0;

        log(
            'INFO',
            `[AlwaysAlive] Agente pronto. SessionId: ${session.sessionId} (${isResumed ? 'retomada' : 'nova'})`,
        );

        if (isResumed) {
            /** @type {import('../../conversation-hub/store.js').ConversationStore | null} */
            const convStore = container.resolve(CONVERSATION_STORE) ?? null;
            if (convStore) {
                void ctx.backgroundTasks.track(
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

        host.emit(EMITTER_READY, { sessionId: session.sessionId, isResumed });
    } catch (e) {
        ctx.setStatus('stopped', host);
        log('ERROR', `[AlwaysAlive] Falha ao iniciar: ${toError(e).message}`);
        host.emit(EMITTER_ERROR, e);
        throw e;
    }
}

/**
 * Para o agente graciosamente.
 *
 * @param {AgentContext} ctx
 * @param {LifecycleHost & import('node:events').EventEmitter} host
 * @param {{ shutdownTimeoutMs?: number }} [opts]
 * @returns {Promise<void>}
 */
export async function agentStop(ctx, host, { shutdownTimeoutMs = SHUTDOWN_TIMEOUT_MS } = {}) {
    const sessionState = ctx.sessionState ?? ctx;
    const dialogState = ctx.dialogState ?? ctx;
    const configState = ctx.configState ?? ctx;
    const metricsState = ctx.metricsState ?? ctx;
    const runtimeState = ctx.runtimeState ?? ctx;
    const ioState = ctx.ioState ?? ctx;

    if (ctx.status === 'stopped') return;

    return startSpan('copilot.agent.stop', { sessionId: host.sessionId ?? '', actor: 'agent' }, async () => {
        log('INFO', '[AlwaysAlive] Parando agente...');

        host.emit(EMITTER_BEFORE_STOP);
        host.removeAllListeners('before-stop');

        if (ctx.status === 'starting') {
            log('INFO', '[AlwaysAlive] stop() durante boot — aguardando conclusão (máx 15s)...');
            await raceEvents(host, ['ready', 'error'], { timeoutMs: STOP_BOOT_WAIT_MS }).catch((e) =>
                logSwallowed(e, 'agent.lifecycle.stopBootWait'),
            );
        }

        if (ctx.status === 'processing' || ctx.status === 'waiting_for_input') {
            log('INFO', `[AlwaysAlive] Aguardando tarefa atual terminar (até ${shutdownTimeoutMs}ms)...`);
            await Promise.race([
                new Promise((resolve) => {
                    const onIdle = () => {
                        if (ctx.status !== 'processing' && ctx.status !== 'waiting_for_input') {
                            host.off(EMITTER_STATUS, onIdle);
                            resolve(undefined);
                        }
                    };
                    host.on(EMITTER_STATUS, onIdle);
                }),
                new Promise((resolve) => setTimeout(resolve, shutdownTimeoutMs)),
            ]);
        }

        if (dialogState.dialogLoopAttached) {
            ctx.dialogLoop.removeAllListeners();
            dialogState.dialogLoopAttached = false;
        }
        if (ctx.dialogLoop.active) {
            ctx.dialogLoop.forceDeactivate();
            host.emit(EMITTER_DIALOG_LOOP_CHANGED, { active: false, ts: Date.now() });
        }

        try {
            const snap = createSnapshot({
                sessionId: host.sessionId ?? null,
                model: configState.model ?? ctx.model,
                status: runtimeState.status ?? ctx.status,
                sendCount: metricsState.sendCount ?? ctx.sendCount,
                dialogLoopActive: false,
                dialogPaused: ctx.dialogLoop.paused,
                pendingQuestion: dialogState.pendingQuestion?.question ?? ctx.pendingQuestion?.question ?? null,
                prMetrics: host.dialogPrMetrics,
                reason: 'auto-shutdown',
            });
            await saveSnapshotAsync(snap);
        } catch (e) {
            log('WARN', `[AlwaysAlive] Auto-save snapshot falhou: ${toError(e).message}`);
        }

        await writeStateAsync({ sendCount: metricsState.sendCount ?? ctx.sendCount, gracefulShutdown: true }).catch(
            (e) => log('WARN', `[AlwaysAlive] writeState sendCount falhou: ${toError(e).message}`),
        );

        if (runtimeState.metricsTimer) {
            clearInterval(runtimeState.metricsTimer);
            runtimeState.metricsTimer = null;
        }
        if (runtimeState.mcpReconnectCancel) {
            runtimeState.mcpReconnectCancel();
            runtimeState.mcpReconnectCancel = null;
        }
        if (ctx.quotaMonitor) {
            ctx.quotaMonitor.stop();
            ctx.quotaMonitor = null;
        }
        ctx.keepalive.stop();
        defaultMetrics.stopPeriodicSnapshot();

        const drainedBackgroundTasks = await ctx.backgroundTasks.drain(5000);
        if (!drainedBackgroundTasks) {
            log('WARN', '[AlwaysAlive] Background tasks ainda pendentes após drain(5000ms).');
        }

        ctx.setStatus('stopped', host);

        const remainingTasks = ctx.messageQueue.drain(
            new SessionError('[AlwaysAlive] Agente parado durante shutdown gracioso.', 'AGENT_STOPPED'),
        );
        metricsState.statusSnapshotCache = null;
        if (remainingTasks.length > 0) {
            log('WARN', `[AlwaysAlive] Rejeitando ${remainingTasks.length} tarefa(s) pendente(s) no shutdown.`);
        }

        if (runtimeState.agentObserver) {
            runtimeState.agentObserver.detach();
            runtimeState.agentObserver = null;
        }

        for (const unsub of sessionState.sessionEventUnsubscribers ?? []) unsub();
        sessionState.sessionEventUnsubscribers = [];

        if (sessionState.session) {
            try {
                await sessionState.session.disconnect();
            } catch (e) {
                log('WARN', `[AlwaysAlive] Erro ao desconectar sessão: ${toError(e).message}`);
            }
            sessionState.session = null;
            ctx.messagesCache.invalidate();
            setSessionRpc(null);
            setExperimentalSession(null);
        }

        if (ioState.client) {
            try {
                const stopErrors = await ioState.client.stop();
                if (stopErrors.length > 0) {
                    log(
                        'WARN',
                        `[AlwaysAlive] SDK client.stop() erros: ${stopErrors.map((e) => toError(e).message).join('; ')}`,
                    );
                }
            } catch (e) {
                log('WARN', `[AlwaysAlive] Erro ao parar client SDK: ${toError(e).message}`);
            }
            ioState.client = null;
        }

        clearActiveSdkSessionOwnership({
            getHubSessionId,
            setSharedSdkSessionId,
        });

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
    const sessionState = ctx.sessionState ?? ctx;
    const runtimeState = ctx.runtimeState ?? ctx;
    const ioState = ctx.ioState ?? ctx;

    sessionState.isReconnecting = true;
    try {
        return await tryReconnect(
            originalError,
            /** @type {import('#copilot/sdk/types').CopilotClient} */ (ioState.client ?? ctx.client),
            runtimeState.status ?? ctx.status,
            {
                emit: (event, payload) => host.emit(event, payload),
                initSession: (client) => initSession(ctx, client, host),
                dialogLoop: ctx.dialogLoop,
                clearSessionEventUnsubs: () => {
                    for (const unsub of sessionState.sessionEventUnsubscribers ?? []) unsub();
                    sessionState.sessionEventUnsubscribers = [];
                },
                createClient: () => {
                    const _otelConfig = buildTelemetryConfig();
                    return new CopilotClient(...(_otelConfig ? [{ telemetry: _otelConfig }] : []));
                },
                updateClient: (newClient) => {
                    ioState.client = newClient;
                },
            },
            opts,
        );
    } finally {
        sessionState.isReconnecting = false;
    }
}
