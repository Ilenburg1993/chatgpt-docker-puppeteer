// @ts-check
/**
 * src/copilot/server/routes/sse.js
 *
 * Router canônico do endpoint SSE do servidor copilot.
 *
 * Onda 4.0 — L64.1: substitui o modelo raw de `terminal/dialog/sse.js` (clientes http.ServerResponse) pelo padrão
 * `createSseWriter` de `infra/sse/utils.js` (clientes Express, sem set global).
 *
 * Rotas expostas: GET /events — stream SSE global de todos os eventos do terminal (padrão §12 / §15.8) GET
 * /events/critical — stream SSE filtrado: somente eventos críticos (CRITICAL_EVENTS)
 *
 * Compatibilidade com clientes existentes:
 *
 * - `channel/inject.js` conecta em `GET /events` via `subscribeSse('/events', port, onEvent)`
 * - Dashboard Vue (futuro): consumed como `EventSource('/events')`
 *
 * @module copilot/server/routes/sse
 */

import { MAX_SSE_CLIENTS, MAX_SSE_CONTENT_CHARS, MAX_SSE_LIFETIME_MS } from '#copilot/config';
import { Router } from 'express';
import { eventFanout } from '../../infra/sse/fanout.js';
import { SseReplayBuffer } from '../../infra/sse/replay-buffer.js';
import { getTerminalReplayBuffer } from '../../infra/sse/state.js';
import {
    createEventFilter,
    createSseWriter,
    sanitizeSseEvent,
    SseConnectionTracker,
    standardizeSsePayload,
} from '../../infra/sse/utils.js';
import { CRITICAL_EVENTS } from '../../terminal/dialog/sse.js';

/**
 * @typedef {import('express').Request} Req
 *
 * @typedef {import('express').Response} Res
 */

// ─── Singletons por tipo de stream ───────────────────────────────────────────

/** Replay buffer compartilhado com o buffer do terminal (re-usa instância existente). */
const _sharedReplayBuffer = getTerminalReplayBuffer();

/** Tracker de conexões para o stream global `/events`. */
const _globalTracker = new SseConnectionTracker('server-sse-global', MAX_SSE_CLIENTS);

/** Tracker de conexões para o stream crítico `/events/critical`. */
const _criticalTracker = new SseConnectionTracker('server-sse-critical', MAX_SSE_CLIENTS);

/** Buffer dedicado para replay do stream crítico (menor, eventos de alta relevância). */
const _criticalReplayBuffer = new SseReplayBuffer(64);

// ─── Listener central no fanout ──────────────────────────────────────────────

/**
 * @typedef {{
 *     res: Res;
 *     sse: import('../../infra/sse/utils.js').SseWriter;
 *     level: 'all' | 'critical';
 *     filter: ((evt: string) => boolean) | null;
 * }} ClientEntry
 */

/** @type {Set<ClientEntry>} */
const _clients = new Set();

/**
 * Listener registrado uma única vez no eventFanout. Roteia eventos SSE formatados para todos os clientes conectados.
 *
 * @param {import('../../infra/sse/fanout.js').FanoutEvent} fEvt
 * @returns {void}
 */
function _onFanoutEvent(fEvt) {
    if (_clients.size === 0) return;

    const { event, data } = fEvt;
    const safeEvent = sanitizeSseEvent(event);
    const isCritical = CRITICAL_EVENTS.has(safeEvent);

    /** @type {object} */
    const rawPayload = standardizeSsePayload(data);
    // Truncar campo `content` se exceder limite (mesmo comportamento de createSseWriter)
    /** @type {object} */
    let payload = rawPayload;
    if (typeof (/** @type {Record<string, unknown>} */ (rawPayload)['content']) === 'string') {
        const content = /** @type {{ content: string }} */ (rawPayload).content;
        if (content.length > MAX_SSE_CONTENT_CHARS) {
            payload = { ...rawPayload, content: content.slice(0, MAX_SSE_CONTENT_CHARS) + '\u2026[truncado]' };
        }
    }

    for (const entry of _clients) {
        // Clientes /events recebem tudo (com filtro configurável via ?events=...)
        // Clientes /events/critical recebem somente eventos CRITICAL_EVENTS
        if (entry.level === 'critical' && !isCritical) continue;
        if (entry.filter && !entry.filter(safeEvent)) continue;

        entry.sse.send(safeEvent, payload);
    }
}

eventFanout.subscribe('terminal', _onFanoutEvent);

// ─── Router factory ───────────────────────────────────────────────────────────

/**
 * Cria o router SSE canônico para `GET /events` e `GET /events/critical`.
 *
 * @returns {import('express').Router}
 */
export function createSseRouter() {
    const router = Router();

    // ── GET /events ───────────────────────────────────────────────────────────

    /**
     * Stream SSE global: todos os eventos publicados no eventFanout (canal 'terminal').
     *
     * Query params:
     *
     * - `?events=event1,event2,wildcard.*` — filtra eventos por nome/wildcard (opcional)
     * - `?level=critical` — alias para GET /events/critical
     *
     * Headers gerenciados pelo createSseWriter: Content-Type: text/event-stream Cache-Control: no-cache Connection:
     * keep-alive
     *
     * Suporte a replay via Last-Event-ID (reconexão automática EventSource).
     */
    router.get('/events', (/** @type {Req} */ req, /** @type {Res} */ res) => {
        // Alias para level=critical
        if (req.query?.['level'] === 'critical') {
            return _serveCriticalStream(req, res);
        }

        if (!_globalTracker.accept()) {
            res.status(429).json({ ok: false, error: 'Limite de clientes SSE atingido' });
            return;
        }

        // G2-API-10: filtro opcional por query param ?events=...
        const eventsParam = typeof req.query?.['events'] === 'string' ? req.query['events'] : undefined;
        const filter = createEventFilter(eventsParam);

        const sse = createSseWriter(req, res, {
            heartbeatMs: 15_000,
            maxLifetimeMs: MAX_SSE_LIFETIME_MS,
            replayBuffer: _sharedReplayBuffer,
            tracker: _globalTracker,
            maxContentChars: MAX_SSE_CONTENT_CHARS,
            compress: true,
        });

        // Snapshot inicial — conectado com sucesso
        sse.send('connected', { timestamp: Date.now(), channel: 'terminal' });

        /** @type {ClientEntry} */
        const entry = { res, sse, level: 'all', filter };
        _clients.add(entry);

        req.on('close', () => {
            _clients.delete(entry);
        });
    });

    // ── GET /events/critical ──────────────────────────────────────────────────

    /**
     * Stream SSE filtrado: somente eventos do set CRITICAL_EVENTS (`dialog.stalled`, `fatal`, `system`).
     *
     * Indicado para monitoramento de alertas e dashboards de saúde.
     */
    router.get('/events/critical', _serveCriticalStream);

    return router;
}

// ─── Helper: critical stream ──────────────────────────────────────────────────

/**
 * Aceita uma conexão SSE restrita a eventos críticos.
 *
 * @param {Req} req
 * @param {Res} res
 * @returns {void}
 */
function _serveCriticalStream(req, res) {
    if (!_criticalTracker.accept()) {
        res.status(429).json({ ok: false, error: 'Limite de clientes SSE críticos atingido' });
        return;
    }

    const sse = createSseWriter(req, res, {
        heartbeatMs: 30_000,
        maxLifetimeMs: MAX_SSE_LIFETIME_MS,
        replayBuffer: _criticalReplayBuffer,
        tracker: _criticalTracker,
        maxContentChars: MAX_SSE_CONTENT_CHARS,
    });

    sse.send('connected', { timestamp: Date.now(), channel: 'critical' });

    /** @type {ClientEntry} */
    const entry = { res, sse, level: 'critical', filter: null };
    _clients.add(entry);

    req.on('close', () => {
        _clients.delete(entry);
    });
}
