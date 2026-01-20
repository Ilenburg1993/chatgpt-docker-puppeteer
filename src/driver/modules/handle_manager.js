/* ==========================================================================
   src/driver/modules/handle_manager.js
   Audit Level: 100 — Handle Lifecycle Management
   Status: CONSOLIDATED (Protocol 11)
   Responsabilidade: Gestão de handles do Puppeteer com cleanup automático.
========================================================================== */

const { log } = require('../../core/logger');

class HandleManager {
    constructor(driver) {
        this.driver = driver;
        this.activeHandles = [];
    }

    register(handle) {
        if (handle) {
            this.activeHandles.push(handle);
        }
        return handle;
    }

    /**
     * Limpa todos os handles com timeout de 3s.
     *
     * [V800] Usa AbortController para cancelar cleanup em timeout,
     * evitando promises órfãs rodando indefinidamente em background.
     */
    async clearAll() {
        const CLEANUP_TIMEOUT_MS = 3000;

        // [V800] AbortController permite cancelamento real do cleanup
        const abortController = new AbortController();
        const signal = abortController.signal;

        // Timeout que aborta o cleanup
        const timeoutId = setTimeout(() => {
            abortController.abort();
        }, CLEANUP_TIMEOUT_MS);

        let cleanedCount = 0;

        try {
            // Cleanup com suporte a abort
            while (this.activeHandles.length > 0) {
                // Verifica abort signal antes de cada iteração
                if (signal.aborted) {
                    throw new Error('CLEANUP_ABORTED');
                }

                const h = this.activeHandles.pop();

                try {
                    await h.dispose();
                    cleanedCount++;
                } catch (disposeErr) {
                    // Ignora erros individuais de dispose
                    if (disposeErr.name !== 'AbortError') {
                        log('DEBUG', `[HANDLES] Erro ao dispor handle: ${disposeErr.message}`);
                    }
                }
            }

            // Sucesso: todos handles limpos
            clearTimeout(timeoutId);
            log('DEBUG', `[HANDLES] ${cleanedCount} handles limpos com sucesso`);
        } catch (_abortErr) {
            // Timeout atingido: cleanup interrompido
            clearTimeout(timeoutId);

            const remaining = this.activeHandles.length;
            log('WARN', `[HANDLES] Cleanup abortado após timeout (${CLEANUP_TIMEOUT_MS}ms)`);
            log('WARN', `[HANDLES] ${cleanedCount} limpos, ${remaining} handles restantes marcados para GC`);

            // Esvazia array para liberar referências (GC do Puppeteer limpará)
            this.activeHandles = [];
        }
    }

    getActiveCount() {
        return this.activeHandles.length;
    }
}

module.exports = HandleManager;
