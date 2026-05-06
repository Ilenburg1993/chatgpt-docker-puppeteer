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
import { AGENT_EVENTS } from '#copilot/events';
import { defaultMetrics } from '#copilot/observability';
import { eventFanout } from '../../../infra/sse/fanout.js';
import { SseReplayBuffer } from '../../../infra/sse/replay-buffer.js';
import { SseClientPool } from '../../../infra/sse/stream-hub.js';
import {
    createEventFilter,
    createSseWriter,
    SseConnectionTracker,
    standardizeSsePayload,
} from '../../../infra/sse/utils.js';
import { buildRuntimeRouteMetaPayload } from '../../../presentation/runtime-meta.js';
import { resolveCopilotApiRouteBinding } from '../../../presentation/runtime-request.js';
import { buildAgentConnectedSsePayloadFromRoute } from '../../../presentation/runtime-status.js';
import {
    deleteCopilotApiStreamState,
    getCopilotApiStreamState,
    setCopilotApiStreamState,
} from '../../runtime-state/copilot-api-stream.js';

/**
 * @typedef {import('express').Request} Req
 *
 * @typedef {import('express').Response} Res
 *
 * @typedef {import('express').Router} BridgeRouter
 *
 * @typedef {import('../../../presentation/runtime-route-deps.js').CopilotApiRouteDeps} RuntimeRouteDeps
 *
 * @typedef {import('../../../presentation/runtime-request.js').CopilotApiRouteBinding} RuntimeRouteBinding
 *
 * @typedef {import('#copilot/core').AgentEventName} AgentEventName
 */

/**
 * Registra a rota SSE GET /stream no router fornecido.
 *
 * @param {BridgeRouter} bridge - Express Router onde a rota será registrada
 * @param {RuntimeRouteBinding} binding - Runtime fixo legado ou resolver por requisição
 * @returns {void}
 */
export function registerStreamRoutes(bridge, binding) {
    /**
     * @param {RuntimeRouteDeps} deps
     * @param {Res} res
     * @returns {boolean}
     */
    function ensureStreamRuntimeTarget(deps, res) {
        if (deps.requestedRuntimeId && deps.runtimeFound === false) {
            res.status(404).json({
                ok: false,
                ...buildRuntimeRouteMetaPayload(deps),
                error: `Runtime '${deps.requestedRuntimeId}' não encontrado para stream operacional.`,
            });
            return false;
        }
        return true;
    }

    /** @type {ReadonlyArray<AgentEventName>} */
    const TASK_EVENTS = /** @type {AgentEventName[]} */ ([
        'task.started',
        'task.completed',
        'task.error',
        'task.delta',
        'task.queued',
        'task.reasoning',
    ]);

    /**
     * @typedef {{
     *     runtimeId: string;
     *     agent: RuntimeRouteDeps['agent'];
     *     streamPool: SseClientPool;
     *     taskPool: SseClientPool;
     *     subscriptions: Map<AgentEventName, (data: unknown) => void>;
     *     taskSubscriptions: Map<AgentEventName, (data: unknown) => void>;
     * }} RuntimeSseState
     */

    /**
     * @param {RuntimeRouteDeps} deps
     * @returns {RuntimeSseState}
     */
    function ensureRuntimeState(deps) {
        const runtimeKey = deps.runtimeId;
        const existing = getCopilotApiStreamState(runtimeKey);
        if (existing && existing.agent === deps.agent) return existing;
        if (existing) {
            detachRuntimeState(existing);
        }

        const state = {
            runtimeId: runtimeKey,
            agent: deps.agent,
            streamPool: new SseClientPool(new SseReplayBuffer(), {
                name: `copilot_api.stream.${runtimeKey}`,
                metrics: defaultMetrics,
            }),
            taskPool: new SseClientPool(new SseReplayBuffer(64), {
                name: `copilot_api.stream.tasks.${runtimeKey}`,
                metrics: defaultMetrics,
            }),
            subscriptions: new Map(),
            taskSubscriptions: new Map(),
        };

        wireRuntimeState(state);
        setCopilotApiStreamState(runtimeKey, state);
        return state;
    }

    /**
     * @param {RuntimeSseState} state
     * @returns {void}
     */
    function wireRuntimeState(state) {
        const { agent } = state;
        const maxListenersTarget = AGENT_EVENTS.length + TASK_EVENTS.length + 20;
        if (typeof agent.getMaxListeners === 'function' && typeof agent.setMaxListeners === 'function') {
            const current = agent.getMaxListeners();
            if (current < maxListenersTarget) {
                agent.setMaxListeners(maxListenersTarget);
            }
        }

        /** @type {(eventName: AgentEventName, data: unknown) => void} */
        const broadcastStreamEvent = (eventName, data) => {
            const payload = standardizeSsePayload({
                .../** @type {object} */ (data ?? {}),
                runtimeId: state.runtimeId,
                sourceRuntime: state.runtimeId,
            });
            state.streamPool.broadcast(eventName, payload, { replayEvent: eventName, filterEvent: eventName });
            // FASE-15.2: publicar no barramento de fanout para propagação inter-processo
            eventFanout.publish('bridge', eventName, /** @type {object} */ (payload));
        };

        /** @type {(eventName: AgentEventName, data: unknown) => void} */
        const broadcastTaskEvent = (eventName, data) => {
            const payload = standardizeSsePayload({
                .../** @type {object} */ (data ?? {}),
                runtimeId: state.runtimeId,
                sourceRuntime: state.runtimeId,
            });
            state.taskPool.broadcast(eventName, payload, { replayEvent: eventName, filterEvent: eventName });
        };

        for (const evt of AGENT_EVENTS) {
            const handler = /** @type {(data: unknown) => void} */ (broadcastStreamEvent.bind(null, evt));
            state.subscriptions.set(evt, handler);
            agent.on(evt, handler);
        }

        for (const evt of TASK_EVENTS) {
            const handler = /** @type {(data: unknown) => void} */ (broadcastTaskEvent.bind(null, evt));
            state.taskSubscriptions.set(evt, handler);
            agent.on(evt, handler);
        }
    }

    /**
     * @param {RuntimeSseState} state
     * @returns {void}
     */
    function detachRuntimeState(state) {
        state.subscriptions.forEach((handler, evt) => state.agent.off(evt, handler));
        state.taskSubscriptions.forEach((handler, evt) => state.agent.off(evt, handler));
        state.subscriptions.clear();
        state.taskSubscriptions.clear();
    }

    /**
     * @param {RuntimeSseState} state
     * @returns {void}
     */
    function maybeDisposeRuntimeState(state) {
        if (state.streamPool.size > 0 || state.taskPool.size > 0) return;
        detachRuntimeState(state);
        deleteCopilotApiStreamState(state.runtimeId);
    }

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
        const deps = resolveCopilotApiRouteBinding(binding, req);
        if (!ensureStreamRuntimeTarget(deps, res)) {
            return;
        }
        const state = ensureRuntimeState(deps);
        // BUG-EVDUP-03 (fix): verificar limite de conexões SSE antes de aceitar
        if (!tracker.accept()) {
            res.status(429).json({
                ok: false,
                ...buildRuntimeRouteMetaPayload(deps),
                error: 'Limite de clientes SSE atingido',
            });
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
            replayBuffer: state.streamPool.replayBuffer,
            tracker,
            compress: true,
        });

        // Evento inicial com snapshot do estado atual
        sse.send('connected', buildAgentConnectedSsePayloadFromRoute(deps), { skipBuffer: true });

        const client = state.streamPool.addClient(sse, { filter: eventFilter });

        req.on('close', () => {
            state.streamPool.removeClient(client);
            maybeDisposeRuntimeState(state);
        });
    });

    // ── F36.4: SSE channel dedicado para task streaming ──────────────────────

    const taskTracker = new SseConnectionTracker('copilot-api-stream-tasks', MAX_SSE_CLIENTS);

    bridge.get('/stream/tasks', (/** @type {Req} */ req, /** @type {Res} */ res) => {
        const deps = resolveCopilotApiRouteBinding(binding, req);
        if (!ensureStreamRuntimeTarget(deps, res)) {
            return;
        }
        const state = ensureRuntimeState(deps);
        if (!taskTracker.accept()) {
            res.status(429).json({
                ok: false,
                ...buildRuntimeRouteMetaPayload(deps),
                error: 'Limite de clientes SSE task atingido',
            });
            return;
        }

        const sse = createSseWriter(req, res, {
            heartbeatMs: 30_000,
            replayBuffer: state.taskPool.replayBuffer,
            tracker: taskTracker,
        });

        sse.send(
            'connected',
            { timestamp: Date.now(), channel: 'tasks', ...buildRuntimeRouteMetaPayload(deps) },
            { skipBuffer: true },
        );

        const client = state.taskPool.addClient(sse);

        req.on('close', () => {
            state.taskPool.removeClient(client);
            maybeDisposeRuntimeState(state);
        });
    });
}
