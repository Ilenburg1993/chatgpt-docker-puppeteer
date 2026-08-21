// @ts-check
/**
 * @module copilot/presentation/realtime/sse/replay-buffer
 * @file Buffer circular para replay de eventos SSE após reconexão via Last-Event-ID.
 *
 *   UPG-SE-004 (STREAMING-EVENTS-AUDIT Fase 5): Quando clientes SSE reconectam (timeout de 24h, perda de conexão), o
 *   header Last-Event-ID permite replay dos eventos perdidos.
 * @see EventBus
 */

import { SSE_REPLAY_BUFFER_SIZE } from '#copilot/config';
import { utf8ByteLength } from '#copilot/infra/public/platform/buffer';

/** Tamanho padrão do buffer circular (configurável via SSE_REPLAY_BUFFER_SIZE). */
const DEFAULT_BUFFER_SIZE = SSE_REPLAY_BUFFER_SIZE;
const DEFAULT_MAX_PAYLOAD_BYTES = Number(process.env['SSE_REPLAY_MAX_PAYLOAD_BYTES'] ?? 64 * 1024);

/**
 * @typedef {{ id: number; event: string; data: unknown }} SseBufferedEvent
 */

/**
 * Buffer circular que armazena os últimos N eventos SSE para replay.
 */
export class SseReplayBuffer {
    /** @type {SseBufferedEvent[]} */
    #buffer;
    /** @type {number} */
    #maxSize;
    /** @type {number} */
    #nextId = 1;
    /** @type {number} */
    #maxPayloadBytes;

    /**
     * @param {number} [maxSize]
     */
    constructor(maxSize = DEFAULT_BUFFER_SIZE) {
        this.#maxSize = maxSize;
        this.#buffer = [];
        this.#maxPayloadBytes =
            Number.isFinite(DEFAULT_MAX_PAYLOAD_BYTES) && DEFAULT_MAX_PAYLOAD_BYTES > 0
                ? Math.floor(DEFAULT_MAX_PAYLOAD_BYTES)
                : 64 * 1024;
    }

    /**
     * @param {unknown} data
     * @returns {unknown}
     */
    #normalizePayload(data) {
        try {
            const serialized = JSON.stringify(data);
            if (serialized === undefined) {
                return { _serialized: false, _type: typeof data };
            }
            const serializedBytes = utf8ByteLength(serialized, 'sse replay payload');
            if (serializedBytes <= this.#maxPayloadBytes) {
                return data;
            }
            return {
                _truncated: true,
                _originalSizeBytes: serializedBytes,
                _maxPayloadBytes: this.#maxPayloadBytes,
            };
        } catch {
            return { _serialized: false, _error: 'non-serializable-payload' };
        }
    }

    /**
     * Adiciona um evento ao buffer e retorna o ID atribuído.
     *
     * @param {string} event
     * @param {unknown} data
     * @returns {number} ID do evento
     */
    push(event, data) {
        const id = this.#nextId++;
        this.#buffer.push({ id, event, data: this.#normalizePayload(data) });
        if (this.#buffer.length > this.#maxSize) {
            this.#buffer.shift();
        }
        return id;
    }

    /**
     * Retorna todos os eventos com ID > afterId (para replay).
     *
     * @param {number} afterId
     * @returns {SseBufferedEvent[]}
     */
    getAfter(afterId) {
        return this.#buffer.filter((e) => e.id > afterId);
    }

    /** Retorna o ID do último evento, ou 0 se vazio. */
    get lastId() {
        const last = this.#buffer[this.#buffer.length - 1];
        return last ? last.id : 0;
    }
}
