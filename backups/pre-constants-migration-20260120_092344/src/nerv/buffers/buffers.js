/* ==========================================================================
   src/nerv/buffers/buffers.js
   Subsistema: NERV — Neural Event Relay Vector
   Módulo: buffers/
   Arquivo: buffers.js

   Papel:
   - Compor as filas técnicas inbound e outbound
   - Centralizar configuração de limites técnicos
   - Expor interface mínima e neutra para uso pelo NERV
   - Conectar buffers à telemetria e backpressure

   IMPORTANTE:
   - NÃO decide prioridade
   - NÃO interpreta envelopes
   - NÃO conhece Kernel, Driver ou Server
   - NÃO interfere no fluxo lógico
   - Atua apenas como infraestrutura técnica

   Linguagem: JavaScript (Node.js)
========================================================================== */

const createOutboundQueue = require('./outbound_queue');
const createInboundQueue = require('./inbound_queue');
const createBackpressure = require('./backpressure');

/* ===========================
   Fábrica do subsistema buffers
=========================== */

/**
 * Cria o subsistema de buffers do NERV.
 *
 * @param {Object} deps
 * @param {Object} deps.telemetry
 * Interface de telemetria do NERV.
 *
 * @param {Object} [deps.limits]
 * Limites técnicos opcionais:
 * - outbound
 * - inbound
 */
function createBuffers({ telemetry, limits = {} }) {
    if (!telemetry || typeof telemetry.emit !== 'function') {
        throw new Error('buffers requer telemetry válida');
    }

    const backpressure = createBackpressure({ telemetry });

    const outbound = createOutboundQueue({
        telemetry,
        maxSize: limits.outbound ?? null
    });

    const inbound = createInboundQueue({
        telemetry,
        maxSize: limits.inbound ?? null
    });

    /* ===========================
     API pública do módulo
  =========================== */

    return Object.freeze({
        /* Outbound */

        enqueueOutbound(item) {
            const ok = outbound.enqueue(item);
            if (!ok) {
                backpressure.signal({
                    buffer: 'outbound',
                    size: outbound.size(),
                    limit: limits.outbound ?? null
                });
            }
            return ok;
        },

        dequeueOutbound() {
            return outbound.dequeue();
        },

        outboundSize() {
            return outbound.size();
        },

        /* Inbound */

        enqueueInbound(item) {
            const ok = inbound.enqueue(item);
            if (!ok) {
                backpressure.signal({
                    buffer: 'inbound',
                    size: inbound.size(),
                    limit: limits.inbound ?? null
                });
            }
            return ok;
        },

        dequeueInbound() {
            return inbound.dequeue();
        },

        inboundSize() {
            return inbound.size();
        },

        /* Estado técnico */

        isIdle() {
            return outbound.size() === 0 && inbound.size() === 0;
        },

        clear() {
            outbound.clear();
            inbound.clear();
        }
    });
}

module.exports = createBuffers;
