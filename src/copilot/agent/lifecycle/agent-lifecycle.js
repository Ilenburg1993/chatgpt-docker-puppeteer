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

import { SessionError } from '#copilot/core/errors';
import {
    buildTelemetryConfig,
    defaultErrorTracker,
    defaultMetrics,
    initEventCollector,
    startSpan,
} from '#copilot/observability';
import { log } from '#copilot/observability/logger';
import { raceEvents } from '#copilot/sdk/event-helpers';
import { createRegistry } from '#copilot/sdk/index';
import { CopilotClient } from '@github/copilot-sdk';
import { buildMcpTools } from '../../bridges/mcp-tool-bridge.js';
import { buildMcpConfig } from '../../config/mcp-servers.js';

import { attachBus } from '#copilot/hooks/bus';
import { createHooks } from '#copilot/hooks/factory';
import { createSessionHooks } from '#copilot/hooks/session-lifecycle';
import { SHUTDOWN_TIMEOUT_MS, STOP_BOOT_WAIT_MS } from '../config.js';
import { handleUserInputRequest } from '../dialog/user-input-handler.js';
import { bootstrapTools, setSessionRpc } from '../infra/tools-bootstrap.js';
import { tryReconnect } from '../lifecycle/reconnect-policy.js';
import { persistState, readState, writeStateAsync } from '../lifecycle/state-io.js';
import { performBootWiring } from '../session/boot-wiring.js';
import { syncSdkHistory } from '../session/history-sync.js';
import { initOrResumeSession } from '../session/initializer.js';
import { createSnapshot, saveSnapshot } from '../session/snapshot.js';

/**
 * @typedef {import('../agent-context.js').AgentContext} AgentContext
 *
 * @typedef {import('@github/copilot-sdk').CopilotSession} CopilotSession
 *
 * @typedef {import('../types.js').AgentStatus} AgentStatus
 */

/** @typedef {import('../types.js').LifecycleHost} LifecycleHost */

/**
 * Inicializa (ou reinicializa) a sessão SDK.
 *
 * @param {AgentContext} ctx
 * @param {import('@github/copilot-sdk').CopilotClient} client
 * @param {LifecycleHost} host
 * @returns {Promise<{ session: CopilotSession; isResumed: boolean }>}
 */
export async function initSession(ctx, client, host) {
    ctx.messagesCache.invalidate();
    const mcpTools = await buildMcpTools();
    if (mcpTools.length > 0) {
        log('INFO', `[AlwaysAlive] ${mcpTools.length} MCP tools carregadas via bridge.`);
    }
    ctx.toolsRegistry = createRegistry();
    const tools = bootstrapTools(ctx.toolsRegistry, mcpTools);
    log('INFO', `[AlwaysAlive] ${tools.length} tools registradas (registry + introspection).`);

    const lifecycleHooks = createSessionHooks({
        emitWebhook: (event, payload) => ctx.webhooks.emit(event, payload),
        getModel: () => ctx.model,
        scheduleFallback: (model) => ctx.dialogLoop.scheduleFallback(model),
        emit: (event, payload) => host.emit(event, payload),
    });

    const hooks = createHooks({
        auditLog: true,
        onSessionStart: lifecycleHooks.onSessionStart,
        onSessionEnd: lifecycleHooks.onSessionEnd,
        onErrorOccurred: lifecycleHooks.onErrorOccurred,
    });

    const busHooks = attachBus(hooks);

    const { session, isResumed } = await initOrResumeSession(client, {
        model: ctx.model,
        onPermissionRequest: ctx.permissions.handler,
        onUserInputRequest: (/** @type {{ question: string; choices?: string[]; allowFreeform: boolean }} */ input) =>
            handleUserInputRequest(input, {
                isDialogLoopActive: () => ctx.dialogLoop.active,
                handleProtocolInput: (q) => ctx.dialogLoop.handleProtocolInput(q),
                setStatus: (s) =>
                    ctx.setStatus(s, /** @type {import('node:events').EventEmitter} */ (/** @type {unknown} */ (host))),
                setPendingQuestion: (pq) => {
                    ctx.pendingQuestion = pq;
                },
                emit: (event, payload) => host.emit(event, payload),
            }),
        hooks: busHooks,
        tools,
        mcpServers: buildMcpConfig(),
        reasoningEffort: ctx.reasoningEffort,
        injectHookContext: true,
    });

    ctx.session = session;
    ctx.isResumed = isResumed;
    setSessionRpc(session.rpc);
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

    persistState({ gracefulShutdown: false }, '[AlwaysAlive] gracefulShutdown=false');

    initEventCollector({
        metrics: defaultMetrics,
        errorTracker: defaultErrorTracker,
        persist: true,
    });

    if (process.env['NODE_ENV'] !== 'test') {
        defaultErrorTracker.registerGlobalHandlers();
    }

    defaultMetrics.startPeriodicSnapshot();

    try {
        const _otelConfig = buildTelemetryConfig();
        const client = new CopilotClient(...(_otelConfig ? [{ telemetry: _otelConfig }] : []));
        ctx.client = client;

        const { session, isResumed } = await startSpan('session.boot', { model: ctx.model }, () =>
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
        });
        ctx.sessionEventUnsubscribers = bootResult.unsubs;
        ctx.agentObserver = bootResult.agentObserver;
        ctx.metricsTimer = bootResult.metricsTimer;
        ctx.mcpReconnectCancel = bootResult.mcpReconnectCancel;

        ctx.setStatus('idle', host);
        ctx.sendCount = readState()?.sendCount ?? 0;

        log(
            'INFO',
            `[AlwaysAlive] Agente pronto. SessionId: ${session.sessionId} (${isResumed ? 'retomada' : 'nova'})`,
        );

        if (isResumed) {
            void syncSdkHistory(session, (event, payload) => host.emit(event, payload));
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

    log('INFO', '[AlwaysAlive] Parando agente...');

    host.emit('before-stop');
    host.removeAllListeners('before-stop');

    if (ctx.status === 'starting') {
        log('INFO', '[AlwaysAlive] stop() durante boot — aguardando conclusão (máx 15s)...');
        await raceEvents(host, ['ready', 'error'], { timeoutMs: STOP_BOOT_WAIT_MS }).catch(() => {});
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
        saveSnapshot(snap);
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
                log('WARN', `[AlwaysAlive] SDK client.stop() erros: ${stopErrors.map((e) => e.message).join('; ')}`);
            }
        } catch (/** @type {any} */ e) {
            log('WARN', `[AlwaysAlive] Erro ao parar client SDK: ${e.message}`);
        }
        ctx.client = null;
    }

    host.emit('stopped');
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
            /** @type {import('@github/copilot-sdk').CopilotClient} */ (ctx.client),
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
