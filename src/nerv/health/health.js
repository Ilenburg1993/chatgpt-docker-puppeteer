// @ts-check
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
 * @param {*} obj
 */
function clone(obj) {
    return structuredClone(obj);
}

/* ===========================
   Fábrica do módulo health
=========================== */

/**
 * @typedef {object} CreateHealthDeps
 * @property {object} telemetry
 */
/**
 * @typedef {object} CreateHealthOptions
 * @property {*} [telemetry]
 * @property {*} [thresholds]
 */
/**
 * Cria o módulo de saúde técnica do NERV.
 *
 * **Side-effects:** Mantém estado observável, emite telemetria de health.
 * **Semântica:** Agregador de sinais técnicos de saúde operacional.
 * **Unidades:** Thresholds como inteiros (tamanhos de buffer), timestamp em ms.
 *
 * @param {CreateHealthDeps} deps - Dependências do módulo
 * @param {object} deps
 * @param {object} deps.thresholds
 * @param {number} [deps.thresholds.maxOutboundBuffer] - Limite outbound buffer
 * @param {number} [deps.thresholds.maxInboundBuffer] - Limite inbound buffer
 * @returns {object} Módulo health com métodos updateTransport, updateBuffers, getSnapshot
 * @throws {Error} Se telemetry não for fornecida
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
            lastError: null,
        },

        buffers: {
            inbound: 0,
            outbound: 0,
        },

        activity: {
            lastEmission: null,
            lastReception: null,
        },
    };

    const listeners = new Set();
    const MAX_HEALTH_LISTENERS = 50;
    let overflowWarningEmitted = false; // Latch to emit overflow warning only once

    /* =========================================================
     Operações internas
  ========================================================= */

    function update(partial) {
        Object.assign(state, partial);
        state.timestamp = now();

        telemetry.emit('nerv:health:update', {
            snapshot: state,
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
                limit: thresholds.maxOutboundBuffer,
            });
        }

        if (typeof thresholds.maxInboundBuffer === 'number' && state.buffers.inbound >= thresholds.maxInboundBuffer) {
            telemetry.emit('nerv:health:anomaly', {
                type: 'inbound_buffer_pressure',
                value: state.buffers.inbound,
                limit: thresholds.maxInboundBuffer,
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
     * @param {object} data
     */
    function report(type, data = {}) {
        switch (type) {
            case 'transport:connected':
                update({
                    transport: {
                        ...state.transport,
                        connected: true,
                        lastError: null,
                    },
                });
                break;

            case 'transport:disconnected':
                update({
                    transport: {
                        ...state.transport,
                        connected: false,
                    },
                });
                break;

            case 'transport:error':
                update({
                    transport: {
                        ...state.transport,
                        lastError: data.message || 'erro físico',
                    },
                });
                break;

            case 'buffer:update':
                update({
                    buffers: {
                        inbound: typeof data.inbound === 'number' ? data.inbound : state.buffers.inbound,
                        outbound: typeof data.outbound === 'number' ? data.outbound : state.buffers.outbound,
                    },
                });
                checkThresholds();
                break;

            case 'emission':
                update({
                    activity: {
                        ...state.activity,
                        lastEmission: now(),
                    },
                });
                break;

            case 'reception':
                update({
                    activity: {
                        ...state.activity,
                        lastReception: now(),
                    },
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

        if (listeners.size >= MAX_HEALTH_LISTENERS) {
            if (!overflowWarningEmitted) {
                telemetry.emit('nerv:health:listener_overflow', {
                    count: listeners.size,
                    limit: MAX_HEALTH_LISTENERS,
                });
                overflowWarningEmitted = true;
            }
            // Refuse to add new listeners above the limit to prevent memory issues
            return () => {}; // Return no-op unsubscribe function
        }

        listeners.add(handler);

        return () => {
            listeners.delete(handler);
            // Reset latch if we're back below the limit
            if (listeners.size < MAX_HEALTH_LISTENERS && overflowWarningEmitted) {
                overflowWarningEmitted = false;
            }
        };
    }

    /**
     * Shutdown: limpa listeners registrados.
     */
    function shutdown() {
        listeners.clear();
    }

    /* =========================================================
     Exportação canônica
  ========================================================= */

    return Object.freeze({
        report,
        getStatus,
        onChange,
        shutdown,
    });
}

export default createHealth;
