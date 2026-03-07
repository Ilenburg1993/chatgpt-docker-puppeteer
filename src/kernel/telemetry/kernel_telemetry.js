// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { ActorRole, ActionCode } from '#shared/nerv/constants';
import * as HighLevelNERV from '#nerv/adapters/high_level_adapter';

// ONDA 2.5: Removido EventEmitter, usa NERV para comunicação

/* ===========================
   Severidades Canônicas
=========================== */

/** Constante/valor exportado: TelemetrySeverity. */
const TelemetrySeverity = Object.freeze({
    INFO: 'INFO',
    WARNING: 'WARNING',
    CRITICAL: 'CRITICAL',
});

/* ===========================
   Fábrica da Telemetria do Kernel
=========================== */

/** Classe exportada: KernelTelemetry. */
class KernelTelemetry {
    /**
     * @param {object} [config]
     * @param {any} [config.nerv]
     * Instância do NERV para emissão de eventos (OBRIGATÓRIO após ONDA 2).
     *
     * @param {string} [config.source]
     * Identificador da origem dos eventos (ex.: 'kernel', 'task_runtime').
     *
     * @param {number|null} [config.retention]
     * Política de retenção em memória (null = sem retenção interna).
     * [P3.3 FIX] Padrão aumentado de 1000 para 5000 para melhor análise pós-mortem.
     *
     * @param {boolean} [config.enabled]
     * Habilita/desabilita telemetria (default: true).
     */
    constructor(config = {}) {
        const { nerv = null, source = 'kernel', retention = 5000, enabled = true } = config;
        // ONDA 2.5: NERV obrigatório para desacoplamento
        if (!nerv) {
            throw new Error('KernelTelemetry requer instância do NERV (config.nerv)');
        }

        this.nerv = nerv;
        this.source = source;
        this.retention = retention;
        this.enabled = enabled;

        /**
         * Buffer interno para auditoria/retenção.
         */
        this.buffer = /** @type {any[]} */ ([]);

        /**
         * Contadores e gauges técnicos.
         */
        this.counters = Object.create(null);
        this.gauges = Object.create(null);
        this.timestamps = Object.create(null);

        if (this.retention !== null && typeof this.retention !== 'number') {
            throw new Error('retention deve ser número ou null');
        }
    }

    /* ===========================
     EMISSÃO DE EVENTOS
  =========================== */

    /**
     * Emite evento de telemetria estruturado.
     *
     * @param {string} type
     * Tipo canônico do evento (ex.: 'task_created').
     *
     * @param {object} [payload]
     * Dados observáveis.
     *
     * @param {string} [severity]
     * Severidade (INFO, WARNING, CRITICAL).
     *
     * @returns {Promise<any>}
     * Evento criado.
     */
    async emitEvent(type, payload = {}, severity = TelemetrySeverity.INFO) {
        if (!this.enabled) {
            return null;
        }

        if (!type) {
            throw new Error('Evento de telemetria requer um tipo');
        }

        const event = Object.freeze({
            type,
            at: Date.now(),
            source: this.source,
            severity,
            payload: Object.freeze(payload),
        });

        // Atualiza métricas internas
        this._incrementCounter(`event:${type}`);
        this._mark(`last:${type}`);

        // Retenção interna (se configurada)
        if (this.retention !== null) {
            this.buffer.push(event);

            if (this.buffer.length > this.retention) {
                const discarded = this.buffer.shift();
                // ONDA 2.5: Emitir via NERV (não mais EventEmitter interno)
                try {
                    await HighLevelNERV.sendEvent(this.nerv, ActorRole.KERNEL, ActionCode.TELEMETRY_DISCARDED, {
                        discardedAt: Date.now(),
                        discardedEventType: discarded.type,
                    });
                } catch (/** @type {any} */ _) {
                    // Best-effort: don't crash telemetry on emit failures
                }
            }
        }

        // ONDA 2.5: Emissão via NERV (desacoplado)
        try {
            await HighLevelNERV.sendEvent(this.nerv, ActorRole.KERNEL, ActionCode.KERNEL_TELEMETRY, event);
        } catch (/** @type {any} */ _) {
            // Best-effort: avoid failing kernel telemetry on emission errors
        }

        return event;
    }

    /* ===========================
     MÉTODOS DE CONVENIÊNCIA
  =========================== */

    /**
     * Emite evento informativo.
     * @param {any} type
     * @param {object} [payload]
     */
    info(type, payload = {}) {
        return this.emitEvent(type, payload, TelemetrySeverity.INFO);
    }

    /**
     * Emite alerta.
     * @param {any} type
     * @param {object} [payload]
     */
    warning(type, payload = {}) {
        return this.emitEvent(type, payload, TelemetrySeverity.WARNING);
    }

    /**
     * Emite evento crítico.
     * @param {any} type
     * @param {object} [payload]
     */
    critical(type, payload = {}) {
        return this.emitEvent(type, payload, TelemetrySeverity.CRITICAL);
    }

    /**
     * Emite evento genérico (compatibilidade com NERV).
     * ONDA 2.5: Delega para NERV, não usa EventEmitter interno.
     * @param {any} type
     * @param {object} [payload]
     */
    emit(type, payload = {}) {
        return this.emitEvent(type, payload, TelemetrySeverity.INFO);
    }

    /* ===========================
     MÉTRICAS INTERNAS
  =========================== */

    /**
     * Incrementa contador técnico.
     * @param {any} name
     * @param {number} [value]
     */
    _incrementCounter(name, value = 1) {
        this.counters[name] = (this.counters[name] || 0) + value;
    }

    /**
     * Define gauge técnico.
     * @param {any} name
     * @param {any} value
     */
    _setGauge(name, value) {
        this.gauges[name] = value;
    }

    /**
     * Registra timestamp técnico.
     * @param {any} name
     */
    _mark(name) {
        this.timestamps[name] = Date.now();
    }

    /* ===========================
     CONSULTAS (SOMENTE LEITURA)
  =========================== */

    /**
     * Retorna snapshot do buffer interno.
     */
    getBufferSnapshot() {
        return Object.freeze([...this.buffer]);
    }

    /**
     * Retorna estatísticas técnicas.
     */
    getStats() {
        return Object.freeze({
            source: this.source,
            enabled: this.enabled,
            retainedEvents: this.buffer.length,
            retentionLimit: this.retention,
            counters: Object.freeze({ ...this.counters }),
            gauges: Object.freeze({ ...this.gauges }),
            timestamps: Object.freeze({ ...this.timestamps }),
        });
    }

    /**
     * Retorna eventos por tipo.
     * @param {any} type
     */
    getEventsByType(type) {
        return Object.freeze(this.buffer.filter(e => e.type === type));
    }

    /**
     * Retorna eventos por severidade.
     * @param {any} severity
     */
    getEventsBySeverity(severity) {
        return Object.freeze(this.buffer.filter(e => e.severity === severity));
    }

    /**
     * Retorna eventos em intervalo temporal.
     * @param {object} params
     * @param {number} params.startAt
     * @param {number} params.endAt
     */
    getEventsByTimeRange({ startAt, endAt }) {
        return Object.freeze(this.buffer.filter(e => e.at >= startAt && e.at <= endAt));
    }

    /* ===========================
     CONTROLE DE LIFECYCLE
  =========================== */

    /**
     * Habilita telemetria.
     */
    enable() {
        this.enabled = true;
        this.info('telemetry_enabled', { at: Date.now() });
    }

    /**
     * Desabilita telemetria.
     */
    disable() {
        this.enabled = false;
    }

    /**
     * Limpa buffer interno.
     */
    clearBuffer() {
        const count = this.buffer.length;
        this.buffer = [];

        this.info('telemetry_buffer_cleared', {
            clearedCount: count,
            at: Date.now(),
        });
    }

    /**
     * Reseta métricas internas (uso em testes).
     */
    resetMetrics() {
        this.counters = Object.create(null);
        this.gauges = Object.create(null);
        this.timestamps = Object.create(null);

        this.info('telemetry_metrics_reset', {
            at: Date.now(),
        });
    }

    /* ===========================
     SUBSCRIÇÃO DE OBSERVADORES (VIA NERV)
  =========================== */

    /**
     * Registra observador de telemetria via NERV.
     * ONDA 2.5: Usa NERV.onEvent() ao invés de EventEmitter interno.
     *
     * @param {function} handler
     * Função chamada para cada evento de telemetria do Kernel.
     *
     * @returns {function}
     * Função de unsubscribe.
     */
    onEvent(handler) {
        if (typeof handler !== 'function') {
            throw new Error('onEvent requer função');
        }

        // ONDA 2.5: Delega para NERV, filtra apenas eventos KERNEL_TELEMETRY
        return this.nerv.onEvent('KERNEL_TELEMETRY', (/** @type {any} */ envelope) => {
            const env = /** @type {any} */ (envelope);
            const actor = env?.identity?.actor || env?.actor || env?.header?.source || null;
            if (actor === ActorRole.KERNEL) {
                handler(env.payload);
            }
        });
    }

    /**
     * Registra observador para tipo específico de telemetria.
     * ONDA 2.5: Usa NERV com filtro de tipo.
     * @param {any} type
     * @param {function} handler
     */
    onEventType(type, handler) {
        if (typeof handler !== 'function') {
            throw new Error('onEventType requer função');
        }

        return this.nerv.onEvent('KERNEL_TELEMETRY', (/** @type {any} */ envelope) => {
            const env = /** @type {any} */ (envelope);
            const actor = env?.identity?.actor || env?.actor || env?.header?.source || null;
            if (actor === ActorRole.KERNEL && env.payload.type === type) {
                handler(env.payload);
            }
        });
    }

    /**
     * Registra observador para severidade específica.
     * ONDA 2.5: Usa NERV com filtro de severidade.
     * @param {any} severity
     * @param {function} handler
     */
    onEventSeverity(severity, handler) {
        if (typeof handler !== 'function') {
            throw new Error('onEventSeverity requer função');
        }

        return this.nerv.onEvent('KERNEL_TELEMETRY', (/** @type {any} */ envelope) => {
            const env = /** @type {any} */ (envelope);
            const actor = env?.identity?.actor || env?.actor || env?.header?.source || null;
            if (actor === ActorRole.KERNEL && env.payload.severity === severity) {
                handler(env.payload);
            }
        });
    }
}

export { KernelTelemetry, TelemetrySeverity };
