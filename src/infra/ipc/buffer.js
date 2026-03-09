// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { log } from '#core/logger';

/** Classe exportada: default. */
class IPCBuffer {
    /**
     * @param {number} maxSize - Limite máximo de mensagens para evitar Out-of-Memory.
     */
    constructor(maxSize = 1000) {
        this.queue = /** @type {any[]} */ ([]);
        this.maxSize = maxSize;
    }

    /**
     * Adiciona um envelope à fila de espera. Implementa política de descarte FIFO se o limite for atingido.
     *
     * @param {object} envelope - O Envelope V2 validado.
     */
    enqueue(envelope) {
        if (this.queue.length >= this.maxSize) {
            // Remove o evento mais antigo para preservar a memória do sistema
            const dropped = this.queue.shift();
            log('WARN', `[BUFFER] Outbox lotada. Descartando mensagem antiga: ${dropped.kind}`);
        }

        this.queue.push(envelope);
    }

    /**
     * Extrai todas as mensagens acumuladas para transmissão. Limpa a fila atômicamente após a leitura.
     *
     * @returns {unknown[]} Lista de envelopes em ordem cronológica.
     */
    flush() {
        if (this.queue.length === 0) {
            return [];
        }

        const pending = [...this.queue];
        this.queue = [];

        log('INFO', `[BUFFER] Liberando ${pending.length} mensagens para sincronização retroativa.`);
        return pending;
    }

    /**
     * Verifica se a represa está vazia.
     */
    isEmpty() {
        return this.queue.length === 0;
    }

    /**
     * Retorna a contagem atual de mensagens represadas.
     */
    get size() {
        return this.queue.length;
    }
}

export default IPCBuffer;
