// @ts-check
/**
 * @module copilot/presentation/realtime/sse/stream-hub
 * @file Primitivas de fanout SSE com replay compartilhado por grupo de clientes.
 */

import { SseReplayBuffer } from './replay-buffer.js';

/** @typedef {import('./utils.js').SseWriter} SseWriter */
/** @typedef {import('#copilot/observability/metrics.js').MetricsStore} MetricsStore */

/**
 * @typedef {{ sse: SseWriter; filter: ((evt: string) => boolean) | null }} SseClientEntry
 */

/**
 * @typedef {{
 *     filter?: ((evt: string) => boolean) | null;
 * }} AddClientOptions
 */

/**
 * @typedef {{
 *     replayEvent?: string;
 *     filterEvent?: string;
 *     skipReplay?: boolean;
 *     eventId?: number;
 * }} BroadcastOptions
 */

/**
 * @typedef {{
 *     name?: string;
 *     metrics?: MetricsStore | null;
 * }} SseClientPoolOptions
 */

/**
 * Grupo de clientes SSE com replay único por evento.
 *
 * Benefícios:
 *
 * - evita duplicação do mesmo evento no replay buffer quando há múltiplos clientes;
 * - aplica filtro por cliente de forma centralizada;
 * - envia o mesmo `eventId` para todos os clientes do grupo.
 */
export class SseClientPool {
    /** @type {SseReplayBuffer} */
    #replayBuffer;

    /** @type {Set<SseClientEntry>} */
    #clients = new Set();

    /** @type {string} */
    #name;

    /** @type {MetricsStore | null} */
    #metrics;

    /**
     * @param {SseReplayBuffer} [replayBuffer]
     * @param {SseClientPoolOptions} [opts]
     */
    constructor(replayBuffer = new SseReplayBuffer(), opts = {}) {
        this.#replayBuffer = replayBuffer;
        this.#name = String(opts.name ?? 'default').replace(/[^a-zA-Z0-9_.-]/g, '_');
        this.#metrics = opts.metrics ?? null;
    }

    /**
     * @param {string} key
     * @param {number} [delta=1] Default is `1`
     * @returns {void}
     */
    #count(key, delta = 1) {
        this.#metrics?.recordCounter(`sse.pool.${this.#name}.${key}`, delta);
    }

    /**
     * @returns {void}
     */
    #updateGauge() {
        this.#metrics?.recordGauge(`sse.pool.${this.#name}.clients`, this.#clients.size);
    }

    /**
     * @returns {SseReplayBuffer}
     */
    get replayBuffer() {
        return this.#replayBuffer;
    }

    /**
     * @returns {number}
     */
    get size() {
        return this.#clients.size;
    }

    /**
     * @param {SseWriter} sse
     * @param {AddClientOptions} [opts]
     * @returns {SseClientEntry}
     */
    addClient(sse, opts = {}) {
        const entry = { sse, filter: opts.filter ?? null };
        this.#clients.add(entry);
        this.#count('client_added');
        this.#updateGauge();
        return entry;
    }

    /**
     * @param {SseClientEntry} entry
     * @returns {boolean}
     */
    removeClient(entry) {
        const removed = this.#clients.delete(entry);
        if (removed) {
            this.#count('client_removed');
            this.#updateGauge();
        }
        return removed;
    }

    /**
     * Fecha todas as conexões SSE do pool e limpa o conjunto de clientes. Útil quando a fonte de eventos é rotacionada
     * (ex: troca de client/session/bus).
     *
     * @returns {number} Quantidade de clientes fechados
     */
    closeAll() {
        let closed = 0;
        for (const entry of this.#clients) {
            try {
                entry.sse.close();
            } catch {
                // noop: objetivo é best-effort cleanup
            }
            closed++;
        }
        this.#clients.clear();
        if (closed > 0) {
            this.#count('client_force_closed', closed);
            this.#updateGauge();
        }
        return closed;
    }

    /**
     * Envia um evento para o grupo inteiro, registrando replay apenas uma vez.
     *
     * @param {string} event
     * @param {unknown} payload
     * @param {BroadcastOptions} [opts]
     * @returns {number | undefined}
     */
    broadcast(event, payload, opts = {}) {
        const replayEvent = opts.replayEvent ?? event;
        const filterEvent = opts.filterEvent ?? replayEvent;
        const explicitEventId = Number.isFinite(opts.eventId) ? Number(opts.eventId) : undefined;
        const eventId =
            explicitEventId ?? (opts.skipReplay ? undefined : this.#replayBuffer.push(replayEvent, payload));

        this.#count('broadcast');
        if (opts.skipReplay) this.#count('broadcast_skip_replay');
        if (explicitEventId != null) this.#count('broadcast_external_event_id');

        let delivered = 0;
        let filteredOut = 0;
        /** @type {SseClientEntry[]} */
        const toRemove = [];

        for (const entry of this.#clients) {
            if (entry.filter && !entry.filter(filterEvent)) {
                filteredOut++;
                continue;
            }
            try {
                entry.sse.send(event, payload, {
                    skipBuffer: true,
                    ...(eventId != null ? { eventId } : {}),
                });
                delivered++;
            } catch {
                toRemove.push(entry);
                this.#count('send_error');
            }
        }

        for (const entry of toRemove) {
            if (this.removeClient(entry)) {
                this.#count('client_removed_on_error');
            }
        }

        this.#count('delivered', delivered);
        if (filteredOut > 0) this.#count('filtered_out', filteredOut);

        return eventId;
    }
}
