FILE_ORIGINAL: D:\chatgpt-docker-puppeteer\src\kernel\telemetry\kernel_telemetry.js
PASTA_BASE: kernel
DATA_DA_EXTRACAO: 2026-01-18 22:18:44
--------------------------------------------------------------------------------

/* ==========================================================================
   src/kernel/telemetry/kernel_telemetry.js
   Subsistema: KERNEL — Núcleo Soberano de Decisão
   Módulo: telemetry/
   Arquivo: kernel_telemetry.js
   
   Papel:
   - Tornar observável o estado interno do Kernel
   - Registrar eventos estruturais
   - Garantir não-silêncio epistemológico
   - Alimentar dashboards e auditorias
   
   IMPORTANTE:
   - NÃO decide
   - NÃO executa ações
   - NÃO interpreta o mundo
   - NÃO fecha causalidade
   - NÃO corrige estados
   
   A telemetria é:
   - Transversal
   - Estrutural
   - Obrigatória
   - Passiva
   
   Linguagem: JavaScript (Node.js)
========================================================================== */

const EventEmitter = require('events');

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

class KernelTelemetry extends EventEmitter {
  /**
   * @param {Object} config
   * @param {string} [config.source]
   * Identificador da origem dos eventos (ex.: 'kernel', 'task_runtime').
   * 
   * @param {number|null} [config.retention]
   * Política de retenção em memória (null = sem retenção interna).
   * 
   * @param {boolean} [config.enabled]
   * Habilita/desabilita telemetria (default: true).
   */
  constructor({
    source = 'kernel',
    retention = null,
    enabled = true
  } = {}) {
    super();

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
    if (!this.enabled) return null;

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
        super.emit('telemetry_discarded', {
          discardedAt: Date.now(),
          discardedEventType: discarded.type
        });
      }
    }

    // Emissão padrão via EventEmitter
    super.emit('telemetry_event', event);

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
   */
  emit(type, payload = {}) {
    // Se for chamado via EventEmitter.emit, repassa
    if (arguments.length > 2) {
      return super.emit(...arguments);
    }

    // Caso contrário, emite como telemetria
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
    return Object.freeze(
      this.buffer.filter(e => e.type === type)
    );
  }

  /**
   * Retorna eventos por severidade.
   */
  getEventsBySeverity(severity) {
    return Object.freeze(
      this.buffer.filter(e => e.severity === severity)
    );
  }

  /**
   * Retorna eventos em intervalo temporal.
   */
  getEventsByTimeRange({ startAt, endAt }) {
    return Object.freeze(
      this.buffer.filter(e => e.at >= startAt && e.at <= endAt)
    );
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
     SUBSCRIÇÂO DE OBSERVADORES
  =========================== */

  /**
   * Registra observador de telemetria.
   * 
   * @param {Function} handler
   * Função chamada para cada evento.
   * 
   * @returns {Function}
   * Função de unsubscribe.
   */
  onEvent(handler) {
    if (typeof handler !== 'function') {
      throw new Error('onEvent requer função');
    }

    this.on('telemetry_event', handler);

    return () => {
      this.removeListener('telemetry_event', handler);
    };
  }

  /**
   * Registra observador para tipo específico.
   */
  onEventType(type, handler) {
    if (typeof handler !== 'function') {
      throw new Error('onEventType requer função');
    }

    const wrappedHandler = (event) => {
      if (event.type === type) {
        handler(event);
      }
    };

    this.on('telemetry_event', wrappedHandler);

    return () => {
      this.removeListener('telemetry_event', wrappedHandler);
    };
  }

  /**
   * Registra observador para severidade específica.
   */
  onEventSeverity(severity, handler) {
    if (typeof handler !== 'function') {
      throw new Error('onEventSeverity requer função');
    }

    const wrappedHandler = (event) => {
      if (event.severity === severity) {
        handler(event);
      }
    };

    this.on('telemetry_event', wrappedHandler);

    return () => {
      this.removeListener('telemetry_event', wrappedHandler);
    };
  }
}

module.exports = {
  KernelTelemetry,
  TelemetrySeverity
};