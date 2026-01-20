/* ==========================================================================
   src/nerv/health/health.js
   Subsistema: NERV — Neural Event Relay Vector
   Módulo: health/
   Arquivo: health.js

   Papel:
   - Agregar sinais técnicos de saúde do NERV
   - Manter snapshot observável do estado operacional
   - Expor métricas brutas e estados derivados NÃO decisórios

   IMPORTANTE:
   - NÃO decide ações
   - NÃO aciona correções
   - NÃO interfere no fluxo
   - NÃO conhece Kernel, Driver ou política
   - Atua apenas como observador técnico

   Linguagem: JavaScript (Node.js)
========================================================================== */

/* ===========================
   Utilitários internos
=========================== */

/**
 * Retorna timestamp atual.
 */
function now() {
  return Date.now();
}

/**
 * Clona objeto simples (snapshot defensivo).
 */
function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/* ===========================
   Fábrica do módulo health
=========================== */

/**
 * Cria o módulo de saúde técnica do NERV.
 *
 * @param {Object} deps
 * @param {Object} deps.telemetry
 * Interface de telemetria do NERV.
 *
 * @param {Object} [deps.thresholds]
 * Limiares técnicos opcionais (observacionais):
 * - maxOutboundBuffer
 * - maxInboundBuffer
 */
function createHealth({ telemetry, thresholds = {} }) {
  if (!telemetry || typeof telemetry.emit !== 'function') {
    throw new Error('health requer telemetry válida');
  }

  /* =========================================================
     Estado interno observável
  ========================================================= */

  const state = {
    timestamp: now(),

    transport: {
      connected: null,
      reconnecting: false,
      lastError: null
    },

    buffers: {
      inbound: 0,
      outbound: 0
    },

    activity: {
      lastEmission: null,
      lastReception: null
    }
  };

  const listeners = new Set();

  /* =========================================================
     Operações internas
  ========================================================= */

  function update(partial) {
    Object.assign(state, partial);
    state.timestamp = now();

    telemetry.emit('nerv:health:update', {
      snapshot: state
    });

    for (const handler of listeners) {
      try {
        handler(clone(state));
      } catch (_) {
        // health nunca propaga falhas
      }
    }
  }

  function checkThresholds() {
    if (
      typeof thresholds.maxOutboundBuffer === 'number' &&
      state.buffers.outbound >= thresholds.maxOutboundBuffer
    ) {
      telemetry.emit('nerv:health:anomaly', {
        type: 'outbound_buffer_pressure',
        value: state.buffers.outbound,
        limit: thresholds.maxOutboundBuffer
      });
    }

    if (
      typeof thresholds.maxInboundBuffer === 'number' &&
      state.buffers.inbound >= thresholds.maxInboundBuffer
    ) {
      telemetry.emit('nerv:health:anomaly', {
        type: 'inbound_buffer_pressure',
        value: state.buffers.inbound,
        limit: thresholds.maxInboundBuffer
      });
    }
  }

  /* =========================================================
     API pública (observacional)
  ========================================================= */

  /**
   * Ingestão genérica de eventos técnicos.
   * Não interpreta, apenas atualiza estado.
   *
   * @param {string} type
   * @param {Object} data
   */
  function report(type, data = {}) {
    switch (type) {
      case 'transport:connected':
        update({
          transport: {
            ...state.transport,
            connected: true,
            lastError: null
          }
        });
        break;

      case 'transport:disconnected':
        update({
          transport: {
            ...state.transport,
            connected: false
          }
        });
        break;

      case 'transport:error':
        update({
          transport: {
            ...state.transport,
            lastError: data.message || 'erro físico'
          }
        });
        break;

      case 'buffer:update':
        update({
          buffers: {
            inbound:
              typeof data.inbound === 'number'
                ? data.inbound
                : state.buffers.inbound,
            outbound:
              typeof data.outbound === 'number'
                ? data.outbound
                : state.buffers.outbound
          }
        });
        checkThresholds();
        break;

      case 'emission':
        update({
          activity: {
            ...state.activity,
            lastEmission: now()
          }
        });
        break;

      case 'reception':
        update({
          activity: {
            ...state.activity,
            lastReception: now()
          }
        });
        break;

      default:
        // eventos desconhecidos são ignorados
        break;
    }
  }

  /**
   * Retorna snapshot atual de saúde.
   */
  function getStatus() {
    telemetry.emit('nerv:health:snapshot');
    return clone(state);
  }

  /**
   * Registra handler observacional de mudanças.
   */
  function onChange(handler) {
    if (typeof handler !== 'function') {
      throw new Error('onChange requer função');
    }

    listeners.add(handler);

    return () => {
      listeners.delete(handler);
    };
  }

  /* =========================================================
     Exportação canônica
  ========================================================= */

  return Object.freeze({
    report,
    getStatus,
    onChange
  });
}

module.exports = createHealth;
