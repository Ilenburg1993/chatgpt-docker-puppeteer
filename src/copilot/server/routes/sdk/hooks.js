// @ts-check
/**
 * src/copilot/routes/hooks.js
 *
 * Rotas de introspecção e streaming em tempo real do sistema de hooks SDK.
 *
 * Montadas em /api/sdk/* via sdk-api.js.
 *
 * Endpoints:
 *
 * - GET /hooks/registry — Lista todos os hooks registrados com schema e metadados
 * - GET /hooks/events — SSE stream de todos os eventos de hooks em tempo real
 *
 * @module copilot/routes/hooks
 * @see EventBus
 */

import { defaultMetrics } from '#copilot/observability';
import { Router } from 'express';
import { SseClientPool } from '../../../infra/sse/stream-hub.js';
import { createSseWriter, SseConnectionTracker, standardizeSsePayload } from '../../../infra/sse/utils.js';
import { resolveSdkRouteSharedDeps } from './deps.js';
import { withErrorHandler as _withErrorHandler } from './middleware.js';

/** GAP-EVARCH-01 (fix): tracker centralizado para /hooks/events. */
const _hooksTracker = new SseConnectionTracker('hooks/events');

/**
 * @typedef {{
 *     runtimeId: string;
 *     bus: ReturnType<typeof resolveSdkRouteSharedDeps>['sdkHooks']['bus'];
 *     pool: SseClientPool;
 *     listener: (ev: unknown) => void;
 * }} HookRuntimeState
 */

/** @type {Map<string, HookRuntimeState>} */
const _hookRuntimeStates = new Map();

/**
 * @param {ReturnType<typeof resolveSdkRouteSharedDeps>} routeDeps
 * @returns {HookRuntimeState}
 */
function ensureHookRuntimeState(routeDeps) {
    const runtimeKey = routeDeps.runtimeId || 'default';
    const existing = _hookRuntimeStates.get(runtimeKey);
    if (existing && existing.bus === routeDeps.sdkHooks.bus) return existing;

    if (existing) {
        existing.pool.closeAll();
        existing.bus.off('*', existing.listener);
        _hookRuntimeStates.delete(runtimeKey);
    }

    const pool = new SseClientPool(undefined, {
        name: `sdk.hooks.events.${runtimeKey}`,
        metrics: defaultMetrics,
    });

    const listener = (/** @type {unknown} */ ev) => {
        const payload = standardizeSsePayload(/** @type {object} */ (ev ?? {}));
        pool.broadcast('hook', payload, { replayEvent: 'hook', filterEvent: 'hook' });
    };

    routeDeps.sdkHooks.bus.on('*', listener);

    const state = { runtimeId: runtimeKey, bus: routeDeps.sdkHooks.bus, pool, listener };
    _hookRuntimeStates.set(runtimeKey, state);
    return state;
}

/**
 * @param {ReturnType<typeof resolveSdkRouteSharedDeps>} routeDeps
 * @param {HookRuntimeState} state
 * @returns {void}
 */
function maybeDisposeHookRuntimeState(/** @type {ReturnType<typeof resolveSdkRouteSharedDeps>} */ routeDeps, state) {
    if (state.pool.size > 0) return;
    state.bus.off('*', state.listener);
    _hookRuntimeStates.delete(state.runtimeId);
    routeDeps.sdkHooks.log('INFO', `[sdk-api] SSE hooks/events encerrado: runtime ${state.runtimeId}`);
}

/**
 * @typedef {import('express').Request} Req
 *
 * @typedef {import('express').Response} Res
 */

const router = Router();

/**
 * Wrapper com prefixo de log para as rotas de hooks.
 *
 * @param {Req} req
 * @param {Res} res
 * @param {() => Promise<unknown>} fn
 * @returns {Promise<void>}
 */
const withErrorHandler = _withErrorHandler.bind(null, 'sdk-api/hooks');

// ─────────────────────────────────────────────────────────────────────────────
// GET /hooks/registry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lista todos os hooks registrados no SDK_HOOKS registry com schema e metadados.
 *
 * Resposta inclui os 8 hooks pré-registrados (6 SDK + permissionRequest + userInputRequest) com suas respectivas
 * descrições de input/output.
 *
 * @example
 *     fetch('/api/sdk/hooks/registry')
 *         .then((r) => r.json())
 *         .then(({ hooks }) => hooks.forEach((h) => console.log(h.name)));
 */
router.get('/hooks/registry', (_req, res) => {
    const hooks = resolveSdkRouteSharedDeps(/** @type {Req} */ (_req)).sdkHooks.registry.list();
    res.json({ ok: true, count: hooks.length, hooks });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /hooks/events  (SSE)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Abre um stream SSE de todos os eventos de hooks em tempo real via HookBus.
 *
 * Eventos entregues:
 *
 * - `hook` — { hookName, sessionId, timestamp, input, output } de qualquer hook invocado
 * - `heartbeat` — keepalive a cada 30s
 * - `connected` — enviado imediatamente ao conectar
 *
 * @example
 *     const es = new EventSource('/api/sdk/hooks/events');
 *     es.addEventListener('hook', (e) => console.log(JSON.parse(e.data)));
 *     es.addEventListener('heartbeat', (e) => console.log('alive', JSON.parse(e.data).ts));
 */
router.get('/hooks/events', (req, res) => {
    void withErrorHandler(req, res, async () => {
        if (!_hooksTracker.accept()) {
            res.status(429).json({ ok: false, error: 'Limite de clientes SSE atingido' });
            return;
        }
        const routeDeps = resolveSdkRouteSharedDeps(req);
        const runtimeState = ensureHookRuntimeState(routeDeps);

        // GAP-EVARCH-01 (fix): usar createSseWriter para setup padronizado
        // FASE-11.1/11.4: replay buffer + max lifetime
        const sse = createSseWriter(req, res, {
            heartbeatMs: 30_000,
            tracker: _hooksTracker,
            replayBuffer: runtimeState.pool.replayBuffer,
            maxLifetimeMs: 24 * 60 * 60 * 1000,
        });

        sse.send(
            'connected',
            { timestamp: Date.now(), message: 'hooks/events stream iniciado' },
            {
                skipBuffer: true,
            },
        );

        const client = runtimeState.pool.addClient(sse);

        req.on('close', () => {
            runtimeState.pool.removeClient(client);
            maybeDisposeHookRuntimeState(routeDeps, runtimeState);
        });
    });
});

export default router;
