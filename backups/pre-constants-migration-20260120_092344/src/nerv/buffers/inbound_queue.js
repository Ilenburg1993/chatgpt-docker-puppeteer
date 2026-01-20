/* ==========================================================================
   src/nerv/buffers/inbound_queue.js
   Subsistema: NERV — Neural Event Relay Vector
   Módulo: buffers/
   Arquivo: inbound_queue.js

   Papel:
   - Gerenciar fila técnica FIFO de entrada (inbound)
   - Isolar o transporte da camada de recepção
   - Aplicar backpressure físico por limite de tamanho
   - Emitir telemetria técnica sobre pressão e drenagem

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
 * Cria uma fila isolada.
 */
function createQueue() {
    return [];
}

/* ===========================
   Fábrica da fila inbound
=========================== */

/**
 * Cria a fila técnica de entrada.
 *
 * @param {Object} deps
 * @param {Object} deps.telemetry
 * Interface de telemetria do NERV (observação técnica).
 *
 * @param {number|null} deps.maxSize
 * Limite máximo técnico da fila (opcional).
 */
function createInboundQueue({ telemetry, maxSize = null }) {
    if (!telemetry || typeof telemetry.emit !== 'function') {
        throw new Error('inbound_queue requer telemetry válida');
    }

    const queue = createQueue();

    /* ===========================
     Operações internas
  =========================== */

    /**
     * Verifica se a fila atingiu o limite técnico.
     */
    function isFull() {
        return typeof maxSize === 'number' && queue.length >= maxSize;
    }

    /* ===========================
     API pública do módulo
  =========================== */

    /**
     * Enfileira item na fila inbound.
     *
     * @param {*} item
     * Item opaco (frame ou estrutura técnica)
     * @returns {boolean} true se aceito, false se recusado por pressão
     */
    function enqueue(item) {
        if (isFull()) {
            telemetry.emit('nerv:buffer:inbound:pressure', {
                size: queue.length,
                limit: maxSize
            });
            return false;
        }

        queue.push(item);

        telemetry.emit('nerv:buffer:inbound:enqueue', {
            size: queue.length
        });

        return true;
    }

    /**
     * Remove e retorna o próximo item da fila.
     *
     * @returns {*} item ou null se vazio
     */
    function dequeue() {
        if (queue.length === 0) {
            return null;
        }

        const item = queue.shift();

        telemetry.emit('nerv:buffer:inbound:dequeue', {
            size: queue.length
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

        telemetry.emit('nerv:buffer:inbound:cleared');
    }

    /* ===========================
     Exportação canônica
  =========================== */

    return Object.freeze({
        enqueue,
        dequeue,
        size,
        isEmpty,
        clear
    });
}

module.exports = createInboundQueue;
