// @ts-check
import createOutboundQueue from './outbound_queue.js';
import createInboundQueue from './inbound_queue.js';
import createBackpressure from './backpressure.js';

/* ===========================
   Fábrica do subsistema buffers
=========================== */

/**
 * @typedef {object} CreateBuffersDeps
 * @property {any} telemetry
 * @property {*} [limits]
 */
/**
 * @typedef {object} CreateBuffersOptions
 * @property {*} [telemetry]
 * @property {*} [limits]
 */
/**
 * Cria o subsistema de buffers do NERV.
 *
 * @param {CreateBuffersDeps} deps
 * Interface de telemetria do NERV.
 *
 * Limites técnicos opcionais:
 * - outbound: Limite de fila outbound
 * - inbound: Limite de fila inbound
 * - blockOnPressure: Se true, bloqueia quando buffer cheio (default: false)
 * @returns {any}
 */
function createBuffers({ telemetry, limits = {} }) {
    if (!telemetry || typeof telemetry.emit !== 'function') {
        throw new Error('buffers requer telemetry válida');
    }

    const blockOnPressure = limits.blockOnPressure === true;

    const backpressure = /** @type {any} */ (createBackpressure({ telemetry }));

    const outbound = /** @type {any} */ (
        createOutboundQueue({
            telemetry,
            maxSize: limits.outbound ?? null,
        })
    );

    const inbound = /** @type {any} */ (
        createInboundQueue({
            telemetry,
            maxSize: limits.inbound ?? null,
        })
    );

    /* ===========================
     API pública do módulo
  =========================== */

    return Object.freeze({
        /* Outbound */

        /**
         * @param {any} item
         */
        async enqueueOutbound(item) {
            // P9.3: Hard limit de 10000 items para prevenir buffer overflow
            if (outbound.size() > 10000) {
                telemetry.emit('nerv:buffer:overflow', {
                    buffer: 'outbound',
                    size: outbound.size(),
                    limit: 10000,
                });
                throw new Error('BUFFER_OVERFLOW: Outbound buffer exceeded 10000 items');
            }

            const ok = outbound.enqueue(item);
            if (!ok) {
                backpressure.signal({
                    buffer: 'outbound',
                    size: outbound.size(),
                    limit: limits.outbound ?? null,
                });

                // Blocking option: rejeita se backpressure ativo
                if (blockOnPressure) {
                    throw new Error(`Outbound buffer full (${outbound.size()}/${limits.outbound ?? 'unlimited'})`);
                }
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

        /**
         * @param {any} item
         */
        async enqueueInbound(item) {
            const ok = inbound.enqueue(item);
            if (!ok) {
                backpressure.signal({
                    buffer: 'inbound',
                    size: inbound.size(),
                    limit: limits.inbound ?? null,
                });

                // Blocking option: rejeita se backpressure ativo
                if (blockOnPressure) {
                    throw new Error(`Inbound buffer full (${inbound.size()}/${limits.inbound ?? 'unlimited'})`);
                }
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
        },
    });
}

export default createBuffers;
