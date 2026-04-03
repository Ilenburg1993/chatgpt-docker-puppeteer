// @ts-check
/**
 * @module copilot/api/sse-utils
 * @file Utilitários compartilhados para endpoints SSE (Server-Sent Events).
 *
 *   GAP-EVARCH-01 (STREAMING-EVENTS-AUDIT §12): extrai lógica comum de headers, heartbeat, sanitização de eventos,
 *   contagem de clientes e cleanup em um módulo reutilizável.
 */

import { MAX_SSE_CLIENTS } from '#copilot/core';

/** @typedef {import('./sse-replay-buffer.js').SseReplayBuffer} SseReplayBuffer */

/**
 * @typedef {import('express').Request} Req
 *
 * @typedef {import('express').Response} Res
 */

/**
 * @typedef {object} SseWriterOptions
 * @property {number} [heartbeatMs=15000] - Intervalo de heartbeat em ms (0 desabilita). Default is `15000`
 * @property {number} [maxLifetimeMs=0] - Tempo máximo de vida da conexão (0 = sem limite). Default is `0`
 * @property {SseReplayBuffer | null} [replayBuffer=null] - Buffer de replay (null = sem replay). Default is `null`
 * @property {SseConnectionTracker | null} [tracker=null] - Tracker de conexões (null = sem limite). Default is `null`
 */

/**
 * @typedef {object} SseWriter
 * @property {(event: string, data: unknown, opts?: { skipBuffer?: boolean }) => void} send
 * @property {() => void} close
 */

/**
 * Sanitiza nome de evento SSE removendo \r\n para prevenir injeção de protocolo (SEC-VULN-02).
 *
 * @param {string} event
 * @returns {string}
 */
export function sanitizeSseEvent(event) {
    return String(event).replace(/[\r\n]/g, '_');
}

/**
 * Configura uma conexão SSE padrão sobre um par req/res Express.
 *
 * Responsabilidades:
 *
 * - Headers SSE (Content-Type, Cache-Control, Connection, X-Accel-Buffering)
 * - Heartbeat periódico com intervalo configurável
 * - Sanitização de nomes de eventos (SEC-VULN-02)
 * - Replay de eventos perdidos via Last-Event-ID (se `replayBuffer` fornecido)
 * - Max lifetime com auto-close (se `maxLifetimeMs > 0`)
 * - Cleanup de timers e listeners no close/error/finish
 * - Contagem de clientes via `SseConnectionTracker` (se fornecido)
 *
 * @param {Req} req
 * @param {Res} res
 * @param {SseWriterOptions} [opts]
 * @returns {SseWriter}
 */
export function createSseWriter(req, res, opts = {}) {
    const { heartbeatMs = 15_000, maxLifetimeMs = 0, replayBuffer = null, tracker = null } = opts;

    // Registrar no tracker (caller já verificou accept() antes de chamar)
    tracker?.increment();

    // --- Headers padrão SSE ---
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    /**
     * Envia um evento SSE formatado.
     *
     * @param {string} event
     * @param {unknown} data
     * @param {{ skipBuffer?: boolean }} [sendOpts]
     */
    const send = (event, data, sendOpts) => {
        if (res.writableEnded) return;
        const safeEvent = sanitizeSseEvent(event);
        const id = replayBuffer && !sendOpts?.skipBuffer ? replayBuffer.push(safeEvent, data) : undefined;
        const idLine = id != null ? `id: ${id}\n` : '';
        res.write(`${idLine}event: ${safeEvent}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // --- Replay de eventos perdidos via Last-Event-ID ---
    if (replayBuffer) {
        const lastEventId = Number(req.headers?.['last-event-id']) || 0;
        if (lastEventId > 0) {
            const missed = replayBuffer.getAfter(lastEventId);
            for (const evt of missed) {
                if (res.writableEnded) break;
                res.write(
                    `id: ${evt.id}\nevent: ${sanitizeSseEvent(evt.event)}\ndata: ${JSON.stringify(evt.data)}\n\n`,
                );
            }
        }
    }

    // --- Heartbeat ---
    /** @type {ReturnType<typeof setInterval> | null} */
    let heartbeatTimer = null;
    if (heartbeatMs > 0) {
        heartbeatTimer = setInterval(() => send('heartbeat', { ts: Date.now() }, { skipBuffer: true }), heartbeatMs);
    }

    // --- Max lifetime ---
    /** @type {ReturnType<typeof setTimeout> | null} */
    let lifetimeTimer = null;
    if (maxLifetimeMs > 0) {
        lifetimeTimer = setTimeout(() => {
            if (!res.writableEnded) {
                send('reconnect', { reason: 'max_lifetime', ts: Date.now() });
                res.end();
            }
        }, maxLifetimeMs);
    }

    // --- Cleanup ---

    /** @type {(() => void)[]} */
    const cleanupCallbacks = [];

    let _cleaned = false;
    const cleanup = () => {
        if (_cleaned) return;
        _cleaned = true;
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (lifetimeTimer) clearTimeout(lifetimeTimer);
        tracker?.decrement();
        for (const cb of cleanupCallbacks) cb();
    };

    req.on('close', cleanup);
    res.on('error', cleanup);
    res.on('finish', cleanup);

    return {
        send,
        close: () => {
            cleanup();
            if (!res.writableEnded) res.end();
        },
    };
}

/**
 * Tracker centralizado de conexões SSE ativas para um endpoint específico.
 *
 * Previne underflow do contador e fornece `accept()` idempotente.
 */
export class SseConnectionTracker {
    /** @type {string} */
    #name;
    /** @type {number} */
    #max;
    /** @type {number} */
    #count = 0;

    /**
     * @param {string} name - Nome do endpoint (para logging)
     * @param {number} [max] - Limite máximo de conexões simultâneas
     */
    constructor(name, max = MAX_SSE_CLIENTS) {
        this.#name = name;
        this.#max = max;
    }

    /** Verifica se pode aceitar uma nova conexão. */
    accept() {
        return this.#count < this.#max;
    }

    /** Incrementa o contador. */
    increment() {
        this.#count++;
    }

    /** Decrementa o contador (com proteção contra underflow). */
    decrement() {
        if (this.#count > 0) this.#count--;
    }

    /** Retorna o número de conexões ativas. */
    get count() {
        return this.#count;
    }

    /** Nome do endpoint. */
    get name() {
        return this.#name;
    }
}

/**
 * Cria um filtro de eventos a partir de query param `?events=task.*,dialog.*`.
 *
 * Suporta wildcard simples (`task.*` → matcha `task.started`, `task.delta`, etc.) e nomes exatos (`ready`, `status`).
 *
 * @param {string | undefined} eventsParam - Valor do query param `?events=`
 * @returns {((evt: string) => boolean) | null} - Filtro ou null se nenhum filtro aplicado
 */
export function createEventFilter(eventsParam) {
    const raw = typeof eventsParam === 'string' ? eventsParam.trim() : '';
    if (!raw) return null;

    const patterns = raw
        .split(',')
        .map((e) => e.trim())
        .filter(Boolean);
    const exact = new Set(patterns.filter((p) => !p.includes('*')));
    const prefixes = patterns.filter((p) => p.endsWith('.*')).map((p) => p.slice(0, -1)); // 'task.*' → 'task.'

    return (evt) => exact.has(evt) || prefixes.some((pfx) => evt.startsWith(pfx));
}
