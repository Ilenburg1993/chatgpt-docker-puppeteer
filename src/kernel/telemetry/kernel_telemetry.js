/* ==========================================================================
   src/kernel/telemetry/kernel_telemetry.js
   Subsistema: KERNEL — Núcleo Soberano de Decisão
   Módulo: telemetry/
   Arquivo: kernel_telemetry.js

   Papel:
   - Tornar observável o estado interno do Kernel
   - Registrar eventos estruturais via NERV (desacoplado)
   - Garantir não-silêncio epistemológico
   - Alimentar dashboards e auditorias

   IMPORTANTE:
   - NÃO decide
   - NÃO executa ações
   - NÃO interpreta o mundo
   - NÃO fecha causalidade
   - NÃO corrige estados
   - USA NERV para emitir (não EventEmitter interno)

   A telemetria é:
   - Transversal
   - Estrutural
   - Obrigatória
   - Passiva
   - Desacoplada (via NERV)

   Linguagem: JavaScript (Node.js)
========================================================================== */

const { ActorRole, MessageType, ActionCode } = require('@shared/nerv/constants');

// ONDA 2.5: Removido EventEmitter, usa NERV para comunicação

/* ===========================
   Severidades Canônicas
=========================== */

const TelemetrySeverity = Object.freeze({
    INFO: 'INFO',
    WARNING: 'WARNING',
    CRITICAL: 'CRITICAL'
});

/* ===========================
   Fábrica da Telemetria do Kernel
=========================== */

class KernelTelemetry {
    /**
     * @param {Object} config
     * @param {Object} config.nerv
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
    constructor({ nerv = null, source = 'kernel', retention = 5000, enabled = true } = {}) {
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
        this.buffer = [];

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
     * @param {Object} [payload]
     * Dados observáveis.
     *
     * @param {string} [severity]
     * Severidade (INFO, WARNING, CRITICAL).
     *
     * @returns {Object}
     * Evento criado.
     */
    emitEvent(type, payload = {}, severity = TelemetrySeverity.INFO) {
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
            payload: Object.freeze(payload)
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
                this.nerv.emit({
                    actor: ActorRole.KERNEL,
                    messageType: MessageType.EVENT,
                    actionCode: ActionCode.TELEMETRY_DISCARDED,
                    payload: {
                        discardedAt: Date.now(),
                        discardedEventType: discarded.type
                    }
                });
            }
        }

        // ONDA 2.5: Emissão via NERV (desacoplado)
        this.nerv.emit({
            actor: ActorRole.KERNEL,
            messageType: MessageType.EVENT,
            actionCode: ActionCode.KERNEL_TELEMETRY,
            payload: event
        });

        return event;
    }

    /* ===========================
     MÉTODOS DE CONVENIÊNCIA
  =========================== */

    /**
     * Emite evento informativo.
     */
    info(type, payload = {}) {
        return this.emitEvent(type, payload, TelemetrySeverity.INFO);
    }

    /**
     * Emite alerta.
     */
    warning(type, payload = {}) {
        return this.emitEvent(type, payload, TelemetrySeverity.WARNING);
    }

    /**
     * Emite evento crítico.
     */
    critical(type, payload = {}) {
        return this.emitEvent(type, payload, TelemetrySeverity.CRITICAL);
    }

    /**
     * Emite evento genérico (compatibilidade com NERV).
     * ONDA 2.5: Delega para NERV, não usa EventEmitter interno.
     */
    emit(type, payload = {}) {
        return this.emitEvent(type, payload, TelemetrySeverity.INFO);
    }

    /* ===========================
     MÉTRICAS INTERNAS
  =========================== */

    /**
     * Incrementa contador técnico.
     */
    _incrementCounter(name, value = 1) {
        this.counters[name] = (this.counters[name] || 0) + value;
    }

    /**
     * Define gauge técnico.
     */
    _setGauge(name, value) {
        this.gauges[name] = value;
    }

    /**
     * Registra timestamp técnico.
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
            timestamps: Object.freeze({ ...this.timestamps })
        });
    }

    /**
     * Retorna eventos por tipo.
     */
    getEventsByType(type) {
        return Object.freeze(this.buffer.filter(e => e.type === type));
    }

    /**
     * Retorna eventos por severidade.
     */
    getEventsBySeverity(severity) {
        return Object.freeze(this.buffer.filter(e => e.severity === severity));
    }

    /**
     * Retorna eventos em intervalo temporal.
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
            at: Date.now()
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
            at: Date.now()
        });
    }

    /* ===========================
     SUBSCRIÇÃO DE OBSERVADORES (VIA NERV)
  =========================== */

    /**
     * Registra observador de telemetria via NERV.
     * ONDA 2.5: Usa NERV.onEvent() ao invés de EventEmitter interno.
     *
     * @param {Function} handler
     * Função chamada para cada evento de telemetria do Kernel.
     *
     * @returns {Function}
     * Função de unsubscribe.
     */
    onEvent(handler) {
        if (typeof handler !== 'function') {
            throw new Error('onEvent requer função');
        }

        // ONDA 2.5: Delega para NERV, filtra apenas eventos KERNEL_TELEMETRY
        return this.nerv.onEvent('KERNEL_TELEMETRY', envelope => {
            if (envelope.actor === ActorRole.KERNEL) {
                handler(envelope.payload);
            }
        });
    }

    /**
     * Registra observador para tipo específico de telemetria.
     * ONDA 2.5: Usa NERV com filtro de tipo.
     */
    onEventType(type, handler) {
        if (typeof handler !== 'function') {
            throw new Error('onEventType requer função');
        }

        return this.nerv.onEvent('KERNEL_TELEMETRY', envelope => {
            if (envelope.actor === ActorRole.KERNEL && envelope.payload.type === type) {
                handler(envelope.payload);
            }
        });
    }

    /**
     * Registra observador para severidade específica.
     * ONDA 2.5: Usa NERV com filtro de severidade.
     */
    onEventSeverity(severity, handler) {
        if (typeof handler !== 'function') {
            throw new Error('onEventSeverity requer função');
        }

        return this.nerv.onEvent('KERNEL_TELEMETRY', envelope => {
            if (envelope.actor === ActorRole.KERNEL && envelope.payload.severity === severity) {
                handler(envelope.payload);
            }
        });
    }
}

module.exports = {
    KernelTelemetry,
    TelemetrySeverity
};
