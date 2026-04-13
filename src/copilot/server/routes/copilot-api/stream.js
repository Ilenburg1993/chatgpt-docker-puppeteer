// @ts-check
/**
 * src/copilot/server/routes/copilot-api/stream.js
 *
 * Rota SSE (Server-Sent Events) do AlwaysAliveAgent — push de eventos em tempo real.
 *
 * Onda 4.8 — migrado de `api/bridge/stream.js` para `server/routes/copilot-api/`.
 *
 * @module copilot/server/routes/copilot-api/stream
 */

import { MAX_SSE_CLIENTS, MAX_SSE_LIFETIME_MS } from '#copilot/config';
import { AGENT_EVENTS } from '#copilot/core';
import { eventFanout } from '../../sse/fanout.js';
import { SseReplayBuffer } from '../../sse/replay-buffer.js';
import { createEventFilter, createSseWriter, SseConnectionTracker, standardizeSsePayload } from '../../sse/utils.js';

/**
 * @typedef {import('express').Request} Req
 *
 * @typedef {import('express').Response} Res
 *
 * @typedef {import('express').Router} BridgeRouter
 *
 * @typedef {import('./control.js').AlwaysAliveAgentLike} AlwaysAliveAgentLike
 *
 * @typedef {import('#copilot/core').AgentEventName} AgentEventName
 */

/**
 * Registra a rota SSE GET /stream no router fornecido.
 *
 * @param {BridgeRouter} bridge - Express Router onde a rota será registrada
 * @param {AlwaysAliveAgentLike} agent - Instância do AlwaysAliveAgent
 * @returns {void}
 */
export function registerStreamRoutes(bridge, agent) {
    // ARCH-05 (fix): cada conexão SSE adiciona N listeners ao agent (um por AGENT_EVENT).
    // G2-ARCH-21: limite bounded em vez de ilimitado (0) para que o warning ainda apareça
    // caso haja leak real de connections.
    // INC-CORE-001 (fix): usar MAX_SSE_CLIENTS de core/constants.js (padrão 50 via env MAX_SSE_CLIENTS)
    agent.setMaxListeners?.(MAX_SSE_CLIENTS * (AGENT_EVENTS.length + 2)); // +2 para heartbeat + reconnect

    // UPG-SE-004: buffer de replay para reconexão SSE via Last-Event-ID
    const replayBuffer = new SseReplayBuffer();

    // BUG-EVDUP-03 (fix): tracker centralizado para limitar conexões SSE no bridge-stream
    const tracker = new SseConnectionTracker('copilot-api-stream', MAX_SSE_CLIENTS);

    // ─── GET /stream ──────────────────────────────────────────────────────────

    /**
     * SSE global do AlwaysAliveAgent — push de eventos em tempo real para o cliente.
     *
     * Eventos emitidos:
     *
     * - `connected` — estado inicial do agente ao conectar
     * - `task.queued` / `task.started` / `task.completed` / `task.error` / `task.delta`
     * - `question.pending` / `question.answered`
     * - `status` / `stopped` / `ready`
     * - `session.compaction_start` / `session.compaction_complete`
     * - `dialog.ready` / `dialog.reply` / `dialog.stopped` — eventos do Dialog Loop §15.8
     * - `tool.execution_start` / `tool.execution_complete` — auditoria de tool calls (Fase U/Q)
     * - `task.reasoning` / `session.usage` / `session.mode_changed` — eventos SDK (Fase U)
     * - `heartbeat` — sinal a cada 15 s para manter conexão viva
     *
     * Uso: `GET /api/copilot/stream` com `Accept: text/event-stream`
     */
    bridge.get('/stream', (/** @type {Req} */ req, /** @type {Res} */ res) => {
        // BUG-EVDUP-03 (fix): verificar limite de conexões SSE antes de aceitar
        if (!tracker.accept()) {
            res.status(429).json({ ok: false, error: 'Limite de clientes SSE atingido' });
            return;
        }

        // G2-API-10: filtro de eventos por query param ?events=task.*,dialog.* (opcional)
        // GAP-API-002: suporte a wildcard simples (ex: "task.*" matcha "task.started", "task.delta", etc.)
        const eventFilter = createEventFilter(
            typeof req.query?.['events'] === 'string' ? req.query['events'] : undefined,
        );

        // GAP-EVARCH-01 (fix): usar createSseWriter para setup padronizado de headers,
        // heartbeat, replay, sanitização e cleanup.
        // G2-SEC-08: limite de vida por conexão SSE (default 24h)
        const sse = createSseWriter(req, res, {
            heartbeatMs: 15_000,
            maxLifetimeMs: MAX_SSE_LIFETIME_MS,
            replayBuffer,
            tracker,
            compress: true,
        });

        // Evento inicial com snapshot do estado atual
        sse.send('connected', { ...agent.getStatusSnapshot(), timestamp: Date.now() });

        // G2-PERF-05: handler genérico com bind leve por evento AGENT_EVENTS
        /**
         * @param {AgentEventName} eventName
         * @param {unknown} data
         */
        const sseHandler = (eventName, data) => {
            const payload = standardizeSsePayload(data ?? {});
            sse.send(eventName, payload);
            // FASE-15.2: publicar no barramento de fanout para propagação inter-processo
            eventFanout.publish('bridge', eventName, /** @type {object} */ (payload));
        };

        /** @type {Map<AgentEventName, (data: unknown) => void>} */
        const handlers = new Map(
            AGENT_EVENTS.filter((evt) => !eventFilter || eventFilter(evt)).map((evt) => [
                evt,
                /** @type {(data: unknown) => void} */ (sseHandler.bind(null, evt)),
            ]),
        );

        handlers.forEach((handler, evt) => agent.on(evt, handler));

        req.on('close', () => {
            handlers.forEach((handler, evt) => agent.off(evt, handler));
        });
    });

    // ── F36.4: SSE channel dedicado para task streaming ──────────────────────

    const taskReplayBuffer = new SseReplayBuffer(64);
    const taskTracker = new SseConnectionTracker('copilot-api-stream-tasks', MAX_SSE_CLIENTS);

    /** @type {ReadonlyArray<AgentEventName>} */
    const TASK_EVENTS = /** @type {AgentEventName[]} */ ([
        'task.started',
        'task.completed',
        'task.error',
        'task.delta',
        'task.queued',
        'task.reasoning',
    ]);

    bridge.get('/stream/tasks', (/** @type {Req} */ req, /** @type {Res} */ res) => {
        if (!taskTracker.accept()) {
            res.status(429).json({ ok: false, error: 'Limite de clientes SSE task atingido' });
            return;
        }

        const sse = createSseWriter(req, res, {
            heartbeatMs: 30_000,
            replayBuffer: taskReplayBuffer,
            tracker: taskTracker,
        });

        sse.send('connected', { timestamp: Date.now(), channel: 'tasks' });

        /** @type {Map<AgentEventName, (data: unknown) => void>} */
        const handlers = new Map(
            TASK_EVENTS.map((evt) => [
                evt,
                /** @type {(data: unknown) => void} */
                (
                    (data) => {
                        sse.send(evt, standardizeSsePayload(data ?? {}));
                    }
                ),
            ]),
        );

        handlers.forEach((handler, evt) => agent.on(evt, handler));
        req.on('close', () => {
            handlers.forEach((handler, evt) => agent.off(evt, handler));
        });
    });
}
