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
 */

import { defaultBus } from '#copilot/hooks/bus';
import { SDK_HOOKS } from '#copilot/hooks/registry';
import { log } from '#copilot/observability/logger';
import { Router } from 'express';
import { createSseWriter, SseConnectionTracker } from '../api/sse-utils.js';
import { withErrorHandler as _withErrorHandler } from './middleware.js';

/** GAP-EVARCH-01 (fix): tracker centralizado para /hooks/events. */
const _hooksTracker = new SseConnectionTracker('hooks/events');

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
    const hooks = SDK_HOOKS.list();
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

        // GAP-EVARCH-01 (fix): usar createSseWriter para setup padronizado
        const sse = createSseWriter(req, res, {
            heartbeatMs: 30_000,
            tracker: _hooksTracker,
        });

        sse.send('connected', { timestamp: Date.now(), message: 'hooks/events stream iniciado' });

        /** @param {import('#copilot/hooks/bus').HookBusEvent} ev */
        const onAnyHook = (ev) => {
            sse.send('hook', ev);
        };

        // Observar todos os eventos via wildcard '*'
        defaultBus.on('*', onAnyHook);

        req.on('close', () => {
            defaultBus.off('*', onAnyHook);
            log('INFO', '[sdk-api] SSE hooks/events encerrado');
        });
    });
});

export default router;
