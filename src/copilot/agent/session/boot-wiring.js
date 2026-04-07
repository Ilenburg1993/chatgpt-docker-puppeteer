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
 */

import {
    createAgentEventObserver,
    defaultErrorTracker,
    defaultEventCollector,
    defaultMetrics,
} from '#copilot/observability';
import { log } from '#copilot/observability/logger';
import { startMcpAutoReconnect } from '../../bridges/mcp-tool-bridge.js';
import { BOOT_RECOVERY_DELAY_MS, MCP_RECONNECT_MS, METRICS_INTERVAL_MS } from '../config.js';
import { readState, writeStateAsync } from '../lifecycle/state-io.js';
import { cleanupStaleSessions } from './cleanup.js';
import { wireSessionEvents } from './event-wirer.js';

/**
 * @typedef {import('@github/copilot-sdk').CopilotClient} CopilotClient
 *
 * @typedef {import('@github/copilot-sdk').CopilotSession} CopilotSession
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
 * @property {() => import('../always-alive.js').AgentStatusSnapshot} getStatusSnapshot
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
 */

/**
 * Resultado do boot wiring — contém unsubs e recursos que precisam de cleanup no stop().
 *
 * @typedef {Object} BootWiringResult
 * @property {(() => void)[]} unsubs — Funções de unsubscribe de eventos
 * @property {{ attach: (agent: import('node:events').EventEmitter) => void; detach: () => void } | null} agentObserver
 * @property {ReturnType<typeof setInterval> | null} metricsTimer
 * @property {(() => void) | null} mcpReconnectCancel
 */

/**
 * Executa todos os wirings pós-init do boot do agente.
 *
 * @param {CopilotClient} client — Cliente SDK já instanciado
 * @param {CopilotSession} session — Sessão SDK já criada/retomada
 * @param {boolean} isResumed — Se a sessão foi retomada
 * @param {import('node:events').EventEmitter} agentEmitter — O agente como EventEmitter (para observer.attach)
 * @param {BootWiringContext} ctx — Callbacks e referências
 * @returns {BootWiringResult}
 */
export function performBootWiring(client, session, isResumed, agentEmitter, ctx) {
    /** @type {(() => void)[]} */
    const unsubs = [];

    // ── 1. Wire session events ──
    const sessionUnsubs = wireSessionEvents(session, isResumed, {
        emit: ctx.emit,
        getStatusSnapshot: ctx.getStatusSnapshot,
        onCheckpointPath: ctx.onCheckpointPath,
        onContextState: ctx.onContextState,
        onPrInfo: ctx.onPrInfo,
        isProcessing: ctx.isProcessing,
        dialogLoopActive: ctx.dialogLoopActive,
    });
    unsubs.push(...sessionUnsubs);

    // ── 2. Event-collector de observabilidade ──
    const collectorUnsubs = defaultEventCollector.attach(session, session.sessionId ?? 'unknown');
    unsubs.push(...collectorUnsubs);

    // ── 3. Client lifecycle handlers ──
    if (typeof client.on === 'function') {
        const unsubCreated = client.on('session.created', (/** @type {any} */ evt) => {
            log('INFO', `[AlwaysAlive] SDK lifecycle: session.created id=${evt?.sessionId}`);
            ctx.emit('sdk.lifecycle', { type: 'session.created', sessionId: evt?.sessionId });
        });
        const unsubDeleted = client.on('session.deleted', (/** @type {any} */ evt) => {
            log('INFO', `[AlwaysAlive] SDK lifecycle: session.deleted id=${evt?.sessionId}`);
            ctx.emit('sdk.lifecycle', { type: 'session.deleted', sessionId: evt?.sessionId });
        });
        const unsubUpdated = client.on('session.updated', (/** @type {any} */ evt) => {
            log('DEBUG', `[AlwaysAlive] SDK lifecycle: session.updated id=${evt?.sessionId}`);
            ctx.emit('sdk.lifecycle', { type: 'session.updated', sessionId: evt?.sessionId });
        });
        unsubs.push(unsubCreated, unsubDeleted, unsubUpdated);
    }

    // ── 4. Agent-event-observer ──
    const agentObserver = createAgentEventObserver({
        metrics: defaultMetrics,
        errorTracker: defaultErrorTracker,
    });
    agentObserver.attach(agentEmitter);

    // ── 5. Limpeza assíncrona de sessões stale ──
    void cleanupStaleSessions(client, { currentSessionId: session.sessionId })
        .then((result) => {
            if (result.deleted > 0) {
                for (let i = 0; i < result.deleted; i++) defaultMetrics.recordSessionCleanup();
                ctx.emit('session.cleanup', result);
            }
        })
        .catch(() => {});

    // ── 6. Dialog loop resume após boot recovery ──
    if (isResumed) {
        const savedState = readState();
        if (savedState?.dialogLoopActive && !savedState?.dialogPaused) {
            scheduleDialogBootRecovery(ctx);
        }
    }

    // ── 7. Timer de métricas periódicas ──
    /** @type {ReturnType<typeof setInterval> | null} */
    let metricsTimer = null;
    if (METRICS_INTERVAL_MS > 0) {
        metricsTimer = setInterval(() => {
            ctx.emit('agent.metrics', ctx.getStatusSnapshot());
        }, METRICS_INTERVAL_MS);
        metricsTimer.unref();
    }

    // ── 8. Auto-reconnect MCP ──
    const mcpReconnectCancel = startMcpAutoReconnect((tools) => {
        ctx.emit('mcp.reconnected', { toolCount: tools.length, ts: Date.now() });
    }, MCP_RECONNECT_MS);

    // ── 9. Keepalive de sessão ──
    ctx.keepalive.start({
        getSession: () => session,
        getClient: () => client,
        isIdle: () => ctx.getStatus() === 'idle',
        isDialogLoopActive: ctx.dialogLoopActive,
        onKeepalive: (/** @type {number} */ ts) => {
            defaultMetrics.recordKeepalivePing();
            ctx.emit('session.keepalive', { ts });
        },
    });

    // ── 10. Wiring de handoff ──
    agentEmitter.on(
        'session.handoff',
        (
            /**
             * @type {{
             *     fromAgent: string;
             *     toAgent: string;
             *     reason?: string;
             *     context?: Record<string, unknown>;
             * }}
             */ data,
        ) => {
            ctx.handoff.receive(data);
            defaultMetrics.recordHandoff();
        },
    );

    return { unsubs, agentObserver, metricsTimer, mcpReconnectCancel };
}

/**
 * Agenda o boot recovery do dialog loop após resume com delay.
 *
 * @param {BootWiringContext} ctx
 * @returns {void}
 */
function scheduleDialogBootRecovery(ctx) {
    log('INFO', '[AlwaysAlive] F53/F42.1: Re-ativando dialog loop após resume — tentando zero-PR primeiro.');
    setTimeout(async () => {
        if (ctx.getStatus() === 'stopped') return;
        try {
            ctx.ensureDialogLoopAttached();
            await writeStateAsync({ dialogPaused: true });
            await ctx.resumeDialogLoop();
            log('INFO', '[AlwaysAlive] F53: Dialog loop retomado após boot recovery.');
            ctx.emit('dialog.boot_recovery', { zeroPR: !ctx.dialogLoop.active, ts: Date.now() });
        } catch (/** @type {any} */ e) {
            log('WARN', `[AlwaysAlive] F53: Boot recovery falhou (${e.message}) — fallback para startDialogLoop.`);
            try {
                await ctx.startDialogLoop();
            } catch (/** @type {any} */ e2) {
                log('WARN', `[AlwaysAlive] F53: Fallback startDialogLoop também falhou: ${e2.message}`);
            }
        }
    }, BOOT_RECOVERY_DELAY_MS);
}
