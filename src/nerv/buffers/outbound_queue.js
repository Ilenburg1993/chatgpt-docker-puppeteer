// @ts-check
/* ==========================================================================
   src/nerv/buffers/outbound_queue.js
   Subsistema: NERV — Neural Event Relay Vector
   Módulo: buffers/
   Arquivo: outbound_queue.js

   Papel:
   - Gerenciar fila técnica FIFO de saída (outbound)
   - Aplicar backpressure físico por limites de tamanho
   - Sinalizar disponibilidade de itens para envio
   - Emitir telemetria técnica sobre pressão e escoamento

   IMPORTANTE:
   - NÃO interpreta envelopes
   - NÃO prioriza mensagens
   - NÃO decide descarte lógico
   - NÃO conhece Kernel, Driver ou Server
   - Ordem de chegada é sempre preservada

   Linguagem: JavaScript (Node.js)
========================================================================== */

/* ===========================
   Utilitários internos
=========================== */

/**
 * Cria um array vazio isolado.
 */
function createQueue() {
    return [];
}

/* ===========================
   Fábrica da fila outbound
=========================== */

/**
 * @typedef {object} CreateOutboundQueueDeps
 * @property {any} telemetry
 * @property {number|null} maxSize
 */
/**
 * @typedef {object} CreateOutboundQueueOptions
 * @property {*} [telemetry]
 * @property {*} [maxSize]
 */
/**
 * Cria a fila técnica de saída.
 *
 * @param {CreateOutboundQueueDeps} deps
 * Interface de telemetria do NERV (observação técnica).
 *
 * Limite máximo técnico da fila (opcional).
  * @returns {object}
 */
function createOutboundQueue({ telemetry, maxSize = null }) {
    if (!telemetry || typeof telemetry.emit !== 'function') {
        throw new Error('outbound_queue requer telemetry válida');
    }

    const queue = /** @type {any[]} */ (createQueue());

    /* ===========================
     Operações internas
  =========================== */

    /**
     * Verifica se a fila atingiu limite técnico.
     */
    function isFull() {
        return typeof maxSize === 'number' && queue.length >= maxSize;
    }

    /* ===========================
     API pública do módulo
  =========================== */

    /**
     * Enfileira item na fila outbound.
     *
     * @param {object} item
     * Item opaco (frame, bytes ou estrutura técnica)
     * @returns {boolean} true se aceito, false se recusado por pressão
     */
    function enqueue(item) {
        if (isFull()) {
            telemetry.emit('nerv:buffer:outbound:pressure', {
                size: queue.length,
                limit: maxSize,
            });
            return false;
        }

        queue.push(item);

        telemetry.emit('nerv:buffer:outbound:enqueue', {
            size: queue.length,
        });

        return true;
    }

    /**
     * Remove e retorna o próximo item da fila.
     *
     * @returns {object | null} item ou null se vazio
     */
    function dequeue() {
        if (queue.length === 0) {
            return null;
        }

        const item = queue.shift();

        telemetry.emit('nerv:buffer:outbound:dequeue', {
            size: queue.length,
        });

        return item;
    }

    /**
     * Retorna o tamanho atual da fila.
     */
    function size() {
        return queue.length;
    }

    /**
     * Indica se a fila está vazia.
     */
    function isEmpty() {
        return queue.length === 0;
    }

    /**
     * Limpa a fila (uso técnico/diagnóstico).
     */
    function clear() {
        queue.length = 0;

        telemetry.emit('nerv:buffer:outbound:cleared');
    }

    /* ===========================
     Exportação canônica
  =========================== */

    return Object.freeze({
        enqueue,
        dequeue,
        size,
        isEmpty,
        clear,
    });
}

export default createOutboundQueue;
