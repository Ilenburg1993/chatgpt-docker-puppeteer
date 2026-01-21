/* ==========================================================================
   src/kernel/state/observation_store.js
   Audit Level: 810 — Short-Term Sensory Memory
   Status: CONSOLIDATED (Protocol 11)
   Responsabilidade:
     - Armazenar buffer de observações pendentes (Fila de Entrada).
     - Manter histórico recente para debugging (Blackbox).
     - Garantir processamento ordenado (FIFO).
========================================================================== */

class ObservationStore {
    constructor(config = {}) {
        // [P3.1 DEPRECATION WARNING]
        console.warn(
            '[DEPRECATED] ObservationStore (state/) is deprecated. Use ObservationStore (src/kernel/observation_store/) instead.'
        );
        console.warn('[DEPRECATED] This class will be removed in a future version.');

        this.limit = config.HISTORY_LIMIT || 100; // Mantém as últimas 100
        this.pending = []; // Fila de processamento (O que o Kernel precisa ver)
        this.history = []; // Arquivo morto (O que já aconteceu)
    }

    /**
     * Adiciona um novo estímulo à fila de atenção.
     * @param {object} observation - Objeto padronizado de observação.
     */
    add(observation) {
        // Validação básica de integridade
        if (!observation.type || !observation.code) {
            console.warn('[KERNEL MEMORY] Observação malformada descartada:', observation);
            return;
        }

        // Adiciona à fila de pendências
        this.pending.push(observation);

        // Adiciona ao histórico (com rotação)
        this.history.push({ ...observation, status: 'RECEIVED' });
        if (this.history.length > this.limit) {
            this.history.shift();
        }
    }

    /**
     * Retorna todas as observações que ainda não foram digeridas pelo Kernel.
     * @returns {Array} Lista de observações.
     */
    getPending() {
        // Retorna uma cópia rasa para evitar mutação externa acidental
        return [...this.pending];
    }

    /**
     * Marca observações como "Vistas" e as remove da fila de pendências.
     * Deve ser chamado pelo Kernel após o ciclo de decisão.
     * @param {Array} processedItems - Lista de observações processadas.
     */
    markProcessed(processedItems) {
        const idsToRemove = new Set(processedItems.map(o => o.id));

        // Remove da fila de pendentes
        this.pending = this.pending.filter(obs => !idsToRemove.has(obs.id));

        // Atualiza status no histórico (opcional, para debug avançado)
        // (Em produção de alta performance, poderíamos pular isso)
    }

    /**
     * Limpa a memória (ex: no Boot).
     */
    clear() {
        this.pending = [];
        this.history = [];
    }

    /**
     * Diagnóstico: Retorna snapshot da memória.
     */
    getSnapshot() {
        return {
            pendingCount: this.pending.length,
            historyCount: this.history.length,
            oldestPending: this.pending[0] ? this.pending[0].timestamp : null
        };
    }
}

module.exports = ObservationStore;
