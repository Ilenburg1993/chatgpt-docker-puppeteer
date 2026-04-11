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
 */

import { SessionError } from '#copilot/core';
import {
    buildTelemetryConfig,
    defaultErrorTracker,
    defaultMetrics,
    initEventCollector,
    log,
    startSpan,
} from '#copilot/observability';
import { CopilotClient, raceEvents } from '#copilot/sdk';
import { logSwallowed } from '../../core/error-handlers.js';

import { conversationStore } from '../../conversation-hub/store.js';
import { getHubSessionId } from '../../core/shared-state.js';
import { SHUTDOWN_TIMEOUT_MS, STOP_BOOT_WAIT_MS } from '../config.js';
import { setSessionRpc } from '../infra/tools-bootstrap.js';
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
    if (ctx.status !== 'stopped') {
        log('WARN', '[AlwaysAlive] start() chamado com agente já ativo.');
        return;
    }

    ctx.setStatus('starting', host);
    log('INFO', '[AlwaysAlive] Iniciando agente...');

    void writeStateAsync({ gracefulShutdown: false });

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
        ctx.client = client;

        const { session, isResumed } = await startSpan('copilot.session.init', { model: ctx.model }, () =>
            initSession(ctx, client, host),
        );

        if (ctx.agentObserver) ctx.agentObserver.detach();
        const bootResult = performBootWiring(client, session, isResumed, host, {
            emit: (event, payload) => host.emit(event, payload),
            getStatusSnapshot: () => host.getStatusSnapshot(),
            onCheckpointPath: (path) => {
                ctx.lastCheckpointPath = path;
            },
            onContextState: (state) => {
                ctx.contextState = state;
            },
            onPrInfo: (info) => {
                ctx.lastPrInfo = info;
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
            mcpBridge: ctx.mcpBridge ?? null,
        });
        ctx.sessionEventUnsubscribers = bootResult.unsubs;
        ctx.agentObserver = bootResult.agentObserver;
        ctx.metricsTimer = bootResult.metricsTimer;
        ctx.mcpReconnectCancel = bootResult.mcpReconnectCancel;
        ctx.quotaMonitor = bootResult.quotaMonitor ?? null;

        ctx.setStatus('idle', host);
        ctx.sendCount = (await readStateAsync())?.sendCount ?? 0;

        log(
            'INFO',
            `[AlwaysAlive] Agente pronto. SessionId: ${session.sessionId} (${isResumed ? 'retomada' : 'nova'})`,
        );

        if (isResumed) {
            void syncSdkHistory(session, (event, payload) => host.emit(event, payload), {
                getHubSessionId,
                conversationStore,
            });
        }

        host.emit('ready', { sessionId: session.sessionId, isResumed });
    } catch (/** @type {any} */ e) {
        ctx.setStatus('stopped', host);
        log('ERROR', `[AlwaysAlive] Falha ao iniciar: ${e.message}`);
        host.emit('error', e);
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
    if (ctx.status === 'stopped') return;

    return startSpan('copilot.agent.stop', { sessionId: host.sessionId ?? '', actor: 'agent' }, async () => {
        log('INFO', '[AlwaysAlive] Parando agente...');

        host.emit('before-stop');
        host.removeAllListeners('before-stop');

        if (ctx.status === 'starting') {
            log('INFO', '[AlwaysAlive] stop() durante boot — aguardando conclusão (máx 15s)...');
            await raceEvents(host, ['ready', 'error'], { timeoutMs: STOP_BOOT_WAIT_MS }).catch((/** @type {any} */ e) =>
                logSwallowed(e, 'agent.lifecycle.stopBootWait'),
            );
        }

        if (ctx.status === 'processing' || ctx.status === 'waiting_for_input') {
            log('INFO', `[AlwaysAlive] Aguardando tarefa atual terminar (até ${shutdownTimeoutMs}ms)...`);
            await Promise.race([
                new Promise((resolve) => {
                    const onIdle = () => {
                        if (ctx.status !== 'processing' && ctx.status !== 'waiting_for_input') {
                            host.off('status', onIdle);
                            resolve(undefined);
                        }
                    };
                    host.on('status', onIdle);
                }),
                new Promise((resolve) => setTimeout(resolve, shutdownTimeoutMs)),
            ]);
        }

        if (ctx.dialogLoopAttached) {
            ctx.dialogLoop.removeAllListeners();
            ctx.dialogLoopAttached = false;
        }
        if (ctx.dialogLoop.active) {
            ctx.dialogLoop.forceDeactivate();
            host.emit('dialog.loop.changed', { active: false, ts: Date.now() });
        }

        try {
            const snap = createSnapshot({
                sessionId: host.sessionId ?? null,
                model: ctx.model,
                status: ctx.status,
                sendCount: ctx.sendCount,
                dialogLoopActive: false,
                dialogPaused: ctx.dialogLoop.paused,
                pendingQuestion: ctx.pendingQuestion?.question ?? null,
                prMetrics: host.dialogPrMetrics,
                reason: 'auto-shutdown',
            });
            await saveSnapshotAsync(snap);
        } catch (/** @type {any} */ e) {
            log('WARN', `[AlwaysAlive] Auto-save snapshot falhou: ${e.message}`);
        }

        await writeStateAsync({ sendCount: ctx.sendCount, gracefulShutdown: true }).catch((/** @type {any} */ e) =>
            log('WARN', `[AlwaysAlive] writeState sendCount falhou: ${e.message}`),
        );

        if (ctx.metricsTimer) {
            clearInterval(ctx.metricsTimer);
            ctx.metricsTimer = null;
        }
        if (ctx.mcpReconnectCancel) {
            ctx.mcpReconnectCancel();
            ctx.mcpReconnectCancel = null;
        }
        if (ctx.quotaMonitor) {
            ctx.quotaMonitor.stop();
            ctx.quotaMonitor = null;
        }
        ctx.keepalive.stop();
        defaultMetrics.stopPeriodicSnapshot();

        ctx.setStatus('stopped', host);

        const remainingTasks = ctx.messageQueue.drain(
            new SessionError('[AlwaysAlive] Agente parado durante shutdown gracioso.', 'AGENT_STOPPED'),
        );
        ctx.statusSnapshotCache = null;
        if (remainingTasks.length > 0) {
            log('WARN', `[AlwaysAlive] Rejeitando ${remainingTasks.length} tarefa(s) pendente(s) no shutdown.`);
        }

        if (ctx.agentObserver) {
            ctx.agentObserver.detach();
            ctx.agentObserver = null;
        }

        for (const unsub of ctx.sessionEventUnsubscribers) unsub();
        ctx.sessionEventUnsubscribers = [];

        if (ctx.session) {
            try {
                await ctx.session.disconnect();
            } catch (/** @type {any} */ e) {
                log('WARN', `[AlwaysAlive] Erro ao desconectar sessão: ${e.message}`);
            }
            ctx.session = null;
            ctx.messagesCache.invalidate();
            setSessionRpc(null);
        }

        if (ctx.client) {
            try {
                const stopErrors = await ctx.client.stop();
                if (stopErrors.length > 0) {
                    log(
                        'WARN',
                        `[AlwaysAlive] SDK client.stop() erros: ${stopErrors.map((e) => e.message).join('; ')}`,
                    );
                }
            } catch (/** @type {any} */ e) {
                log('WARN', `[AlwaysAlive] Erro ao parar client SDK: ${e.message}`);
            }
            ctx.client = null;
        }

        host.emit('stopped');
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
    ctx.isReconnecting = true;
    try {
        return await tryReconnect(
            originalError,
            /** @type {import('#copilot/sdk/types').CopilotClient} */ (ctx.client),
            ctx.status,
            {
                emit: (event, payload) => host.emit(event, payload),
                initSession: (client) => initSession(ctx, client, host),
                dialogLoop: ctx.dialogLoop,
                clearSessionEventUnsubs: () => {
                    for (const unsub of ctx.sessionEventUnsubscribers) unsub();
                    ctx.sessionEventUnsubscribers = [];
                },
                createClient: () => {
                    const _otelConfig = buildTelemetryConfig();
                    return new CopilotClient(...(_otelConfig ? [{ telemetry: _otelConfig }] : []));
                },
                updateClient: (newClient) => {
                    ctx.client = newClient;
                },
            },
            opts,
        );
    } finally {
        ctx.isReconnecting = false;
    }
}
