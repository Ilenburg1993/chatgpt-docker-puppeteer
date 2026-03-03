// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { getCorrelationId, getMsgId, getPayload } from '#shared/nerv/envelope_reader';
import EventEmitter from 'node:events';

/* ===========================
   Estrutura de Registro de Observação
=========================== */

/**
 * Cria registro imutável de uma observação.
 * P9.5: Adiciona memoization de JSON serialization
 *
 * @param {object} params
 * @returns {object}
 */
function createObservationRecord({ msgId, correlationId, source, payload, originalTimestamp }) {
    let payloadSerialized;
    try {
        payloadSerialized = JSON.stringify(payload ?? null);
    } catch (_) {
        payloadSerialized = JSON.stringify({ error: 'payload_json_stringify_failed' });
    }

    return Object.freeze({
        msgId,
        correlationId,
        source,
        payload: Object.freeze(payload),
        payloadSerialized,
        originalTimestamp: originalTimestamp ?? null,
        ingestedAt: Date.now(),
    });
}

/* ===========================
   Fábrica do ObservationStore
=========================== */

/**
 * Store de observações do kernel com indexação por correlação, tempo e deduplicação.
 */
class ObservationStore extends EventEmitter {
    /**
     * @param {object} params
     * @param {object} params.telemetry
     * Canal de telemetria do Kernel.
     *
     * @param {number} [params.maxObservationsPerCorrelation]
     * Limite técnico opcional (default: sem limite).
     */
    constructor({ telemetry, maxObservationsPerCorrelation = null }) {
        super();

        if (!telemetry || typeof telemetry.emit !== 'function') {
            throw new Error('ObservationStore requer telemetria válida');
        }

        this.telemetry = telemetry;
        this.maxObservationsPerCorrelation = maxObservationsPerCorrelation;

        /**
         * Armazenamento primário:
         * correlation_id -> lista de observações (ordem de chegada)
         */
        this.byCorrelation = new Map();

        /**
         * Índice auxiliar para detecção de duplicação:
         * msg_id -> true
         */
        this.seenMsgIds = new Set();

        /**
         * Índice temporal:
         * Array de [timestamp, correlationId] para queries temporais
         */
        this.temporalIndex = [];
    }

    /* ===========================
     INGESTÃO DE EVENTs
  =========================== */

    /**
     * Ingere um EVENT como fato observado.
     *
     * @param {object} eventEnvelope
     * Envelope IPC do tipo EVENT.
     *
     * Regras:
     * - EVENT nunca é rejeitado por atraso
     * - EVENT nunca é rejeitado por duplicação
     * - EVENT nunca é interpretado
     *
     * @returns {object}
     * Registro criado.
     */
    ingestEvent(eventEnvelope) {
        if (!eventEnvelope || typeof eventEnvelope !== 'object') {
            throw new Error('ingestEvent requer envelope válido');
        }

        const msgId = getMsgId(eventEnvelope);
        const correlationId = getCorrelationId(eventEnvelope);
        if (!msgId || !correlationId) {
            throw new Error('EVENT inválido: msg_id/correlation_id ausentes');
        }

        const payload = getPayload(eventEnvelope);
        const source = eventEnvelope?.identity?.actor || eventEnvelope?.header?.source || 'unknown';
        const originalTimestamp = eventEnvelope?.protocol?.timestamp ?? eventEnvelope?.header?.timestamp ?? null;

        const isDuplicate = this.seenMsgIds.has(msgId);

        const record = createObservationRecord({
            msgId,
            correlationId,
            source,
            payload,
            originalTimestamp,
        });

        // Inicializa lista de observações se necessário
        if (!this.byCorrelation.has(correlationId)) {
            this.byCorrelation.set(correlationId, []);
        }

        const observations = this.byCorrelation.get(correlationId);

        // Verifica limite técnico (se configurado)
        if (this.maxObservationsPerCorrelation !== null && observations.length >= this.maxObservationsPerCorrelation) {
            this.telemetry.warning('observation_store_limit_exceeded', {
                correlationId,
                limit: this.maxObservationsPerCorrelation,
                at: Date.now(),
            });

            // Remove observação mais antiga (FIFO técnico)
            const discarded = observations.shift();

            this.telemetry.info('observation_store_observation_discarded', {
                correlationId,
                discardedMsgId: discarded.msgId,
                at: Date.now(),
            });
        }

        // Adiciona observação
        observations.push(record);
        this.seenMsgIds.add(msgId);

        // Atualiza índice temporal
        this.temporalIndex.push([record.ingestedAt, correlationId]);

        // Limpa índice temporal se muito grande (mantém últimas 10000 entradas)
        if (this.temporalIndex.length > 10000) {
            this.temporalIndex = this.temporalIndex.slice(-10000);
        }

        // Telemetria de ingestão
        this.telemetry.info('observation_store_event_ingested', {
            msgId,
            correlationId,
            source,
            duplicate: isDuplicate,
            at: record.ingestedAt,
        });

        if (isDuplicate) {
            this.telemetry.warning('observation_store_duplicate_detected', {
                msgId,
                correlationId,
                at: record.ingestedAt,
            });
        }

        // Emite evento para observadores
        this.emit('observation_ingested', {
            record,
            isDuplicate,
        });

        return record;
    }

    /* ===========================
     CONSULTAS (SOMENTE LEITURA)
  =========================== */

    /**
     * Retorna todas as observações de uma correlação.
     *
     * @param {string} correlationId
     * @returns {ReadonlyArray<object>}
     * Lista imutável de observações.
     */
    getByCorrelation(correlationId) {
        const list = this.byCorrelation.get(correlationId);
        if (!list) {
            return Object.freeze([]);
        }

        return Object.freeze([...list]);
    }

    /**
     * Retorna observações em intervalo temporal.
     *
     * @param {object} params
     * @param {number} params.startAt
     * @param {number} params.endAt
     * @returns {ReadonlyArray<object>}
     */
    getByTimeRange({ startAt, endAt }) {
        const results = [];

        for (const [timestamp, correlationId] of this.temporalIndex) {
            if (timestamp >= startAt && timestamp <= endAt) {
                const observations = this.getByCorrelation(correlationId);
                results.push(...observations.filter(obs => obs.ingestedAt >= startAt && obs.ingestedAt <= endAt));
            }
        }

        return Object.freeze(results);
    }

    /**
     * Retorna última observação de uma correlação.
     *
     * @param {string} correlationId
     * @returns {object|null}
     */
    getLastObservation(correlationId) {
        const list = this.byCorrelation.get(correlationId);
        if (!list || list.length === 0) {
            return null;
        }

        return list[list.length - 1];
    }

    /**
     * Verifica se correlação existe.
     *
     * @param {string} correlationId
     * @returns {boolean}
     */
    hasCorrelation(correlationId) {
        return this.byCorrelation.has(correlationId);
    }

    /**
     * Retorna contagem de observações por correlação.
     *
     * @param {string} correlationId
     * @returns {number}
     */
    countObservations(correlationId) {
        const list = this.byCorrelation.get(correlationId);
        return list ? list.length : 0;
    }

    /**
     * Lista todas as observações (uso em auditoria).
     *
     * @returns {ReadonlyArray<object>}
     */
    listAll() {
        const all = [];
        for (const list of this.byCorrelation.values()) {
            all.push(...list);
        }
        return Object.freeze(all);
    }

    /**
     * Lista todas as correlation_ids ativas.
     *
     * @returns {Array<string>}
     */
    listCorrelations() {
        return Array.from(this.byCorrelation.keys());
    }

    /**
     * Retorna estatísticas técnicas.
     *
     * @returns {object}
     */
    getStats() {
        let totalObservations = 0;
        let maxObservationsInCorrelation = 0;

        for (const list of this.byCorrelation.values()) {
            totalObservations += list.length;
            maxObservationsInCorrelation = Math.max(maxObservationsInCorrelation, list.length);
        }

        return Object.freeze({
            correlations: this.byCorrelation.size,
            observations: totalObservations,
            uniqueMsgIds: this.seenMsgIds.size,
            maxObservationsInCorrelation,
            temporalIndexSize: this.temporalIndex.length,
        });
    }

    /* ===========================
     LIMPEZA TÉCNICA (OPCIONAL)
  =========================== */

    /**
     * Remove correlação completa (uso técnico/diagnóstico).
     *
     * @param {string} correlationId
     */
    purgeCorrelation(correlationId) {
        const existed = this.byCorrelation.has(correlationId);

        if (existed) {
            this.byCorrelation.delete(correlationId);

            this.telemetry.info('observation_store_correlation_purged', {
                correlationId,
                at: Date.now(),
            });
        }
    }

    /**
     * Limpa observações antigas por critério temporal.
     *
     * @param {object} params
     * @param {number} params.olderThan
     * Timestamp limite.
     */
    purgeOlderThan({ olderThan }) {
        let purgedCount = 0;

        for (const [correlationId, observations] of this.byCorrelation.entries()) {
            const filtered = observations.filter(obs => obs.ingestedAt >= olderThan);

            purgedCount += observations.length - filtered.length;

            if (filtered.length === 0) {
                this.byCorrelation.delete(correlationId);
            } else if (filtered.length < observations.length) {
                this.byCorrelation.set(correlationId, filtered);
            }
        }

        this.telemetry.info('observation_store_purged_old', {
            purgedCount,
            olderThan,
            at: Date.now(),
        });
    }
}

export { ObservationStore };
