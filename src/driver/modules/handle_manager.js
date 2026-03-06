// @ts-check - Type checking rigoroso habilitado (arquivo core)
import EventEmitter from 'node:events';
import { log } from '#core/logger';
import { withTimeout } from '#infra/abort_controller_utils';

/* ==========================================================================
   HANDLE_CONFIG - Configurações centralizadas (zero magic numbers)
========================================================================== */

/**
 * Configurações do HandleManager.
 * Todas são configuráveis via variáveis de ambiente.
 * @constant {object} HANDLE_CONFIG
 */
const HANDLE_CONFIG = {
    /** Timeout máximo para clearAll (ms) - Default: 3 segundos */
    CLEANUP_TIMEOUT_MS: parseInt(process.env.HANDLE_CLEANUP_TIMEOUT || '3000', 10),

    /** Timeout para dispose individual (ms) - Default: 1 segundo */
    DISPOSE_TIMEOUT_MS: parseInt(process.env.HANDLE_DISPOSE_TIMEOUT || '1000', 10),

    /** Máximo de handles simultâneos - Default: 1000 */
    MAX_HANDLES: parseInt(process.env.HANDLE_MAX_HANDLES || '1000', 10),
};

/* ==========================================================================
   HANDLE_EVENTS - Eventos locais do HandleManager
========================================================================== */

/**
 * Eventos emitidos pelo HandleManager (EventEmitter local).
 * Subscribers podem escutar estes eventos para observar lifecycle.
 * @constant {object} HANDLE_EVENTS
 */
const HANDLE_EVENTS = {
    /** Handle registrado no manager */
    HANDLE_REGISTERED: 'handle:registered',

    /** Handle individual limpo com sucesso */
    HANDLE_CLEARED: 'handle:cleared',

    /** Todos handles limpos (clearAll success) */
    HANDLES_CLEARED_ALL: 'handles:cleared_all',

    /** Cleanup atingiu timeout (aborted) */
    CLEANUP_TIMEOUT: 'cleanup:timeout',

    /** Erro durante cleanup ou validação */
    CLEANUP_ERROR: 'cleanup:error',
};

/* ==========================================================================
   HandleManager Class - EventEmitter com telemetria completa
========================================================================== */

/**
 * Gerencia lifecycle de handles do Puppeteer com cleanup automático.
 *
 * v2.0 Features:
 * - EventEmitter inheritance (observability via eventos locais)
 * - Validação completa (tipo + dispose method + limite)
 * - Timeout protection (clearAll 3s + dispose individual 1s)
 * - Metrics tracking (7 métricas + timing)
 * - Cleanup seletivo (clearOne method)
 * - Introspection (getStats method)
 *
 * @class HandleManager
 * @extends EventEmitter
 *
 * @example
 * const manager = new HandleManager(driver);
 *
 * // Escutar eventos
 * manager.on(HANDLE_EVENTS.HANDLE_REGISTERED, (data) => {
 *   console.log(`Handle registered (${data.count} active)`);
 * });
 *
 * manager.on(HANDLE_EVENTS.CLEANUP_TIMEOUT, (data) => {
 *   console.warn(`Cleanup timeout: ${data.cleaned}/${data.remaining}`);
 * });
 *
 * // Registrar handles
 * const handle = await page.$('.selector');
 * manager.register(handle);
 *
 * // Cleanup
 * await manager.clearAll(); // ou
 * await manager.clearOne(handle);
 *
 * // Stats
 * const stats = manager.getStats();
 */
class HandleManager extends EventEmitter {
    /**
     * Cria HandleManager instance.
     *
     * @constructor
     * @param {object} driver - Driver Puppeteer (para referência)
     *
     * @example
     * const manager = new HandleManager(driver);
     */
    constructor(driver) {
        super(); // ✅ EventEmitter constructor

        /**
         * Referência ao driver Puppeteer.
         * @type {object}
         * @private
         */
        this.driver = driver;

        /**
         * Array de handles ativos (aguardando cleanup).
         * @type {Array<object>}
         * @private
         */
        this.activeHandles = [];

        /**
         * Métricas de lifecycle.
         * @type {any}
         * @private
         */
        this.stats = {
            /** Total de handles registrados (histórico) */
            handlesRegistered: 0,

            /** Total de handles limpos com sucesso */
            handlesCleared: 0,

            /** Total de timeouts ocorridos em cleanup */
            timeoutsOccurred: 0,

            /** Total de erros durante cleanup */
            errorsOccurred: 0,

            /** Total de chamadas clearAll */
            totalClearAllCalls: 0,

            /** Duração da última clearAll (ms) */
            lastClearAllDuration: 0,

            /** Duração máxima de clearAll (ms) */
            maxClearAllDuration: 0,
        };

        log('DEBUG', '[HandleManager] v2.0 initialized (EventEmitter + full observability)');
    }

    /**
     * Registra handle para cleanup automático.
     *
     * Validações:
     * - Handle não pode ser null/undefined
     * - Handle deve ter método dispose() (Puppeteer JSHandle)
     * - Limite MAX_HANDLES não pode ser ultrapassado
     *
     * @param {any} handle - Handle Puppeteer (JSHandle com método dispose)
     * @returns {object} Handle registrado (para chaining)
     * @throws {Error} Se handle inválido ou limite atingido
     *
     * @emits HANDLE_EVENTS.HANDLE_REGISTERED - Handle registrado com sucesso
     * @emits HANDLE_EVENTS.CLEANUP_ERROR - Limite atingido
     *
     * @example
     * const handle = await page.$('.selector');
     * manager.register(handle); // ✅ Válido
     *
     * manager.register(null); // ❌ Erro: Handle is required
     * manager.register('string'); // ❌ Erro: Must have dispose() method
     */
    register(handle) {
        // ✅ Validação 1: Handle não pode ser null/undefined
        if (!handle) {
            const error = '[HandleManager] Handle is required';
            log('ERROR', error);
            throw new Error(error);
        }

        // ✅ Validação 2: Handle deve ter método dispose()
        if (typeof handle.dispose !== 'function') {
            const error = '[HandleManager] Handle must have dispose() method (Puppeteer JSHandle)';
            log('ERROR', error);

            this.emit(HANDLE_EVENTS.CLEANUP_ERROR, {
                error,
                handleType: typeof handle,
                reason: 'INVALID_HANDLE',
            });

            throw new Error(error);
        }

        // ✅ Validação 3: Verificação de limite
        if (this.activeHandles.length >= HANDLE_CONFIG.MAX_HANDLES) {
            const error = `Max handles limit reached (${HANDLE_CONFIG.MAX_HANDLES})`;
            log('ERROR', `[HandleManager] ${error}`);

            this.emit(HANDLE_EVENTS.CLEANUP_ERROR, {
                error,
                limit: HANDLE_CONFIG.MAX_HANDLES,
                current: this.activeHandles.length,
                reason: 'LIMIT_EXCEEDED',
            });

            throw new Error(`[HandleManager] ${error}`);
        }

        // ✅ Adicionar handle + atualizar metrics
        this.activeHandles.push(handle);
        this.stats.handlesRegistered++;

        // ✅ Emit evento local
        this.emit(HANDLE_EVENTS.HANDLE_REGISTERED, {
            count: this.activeHandles.length,
            total: this.stats.handlesRegistered,
            limit: HANDLE_CONFIG.MAX_HANDLES,
            timestamp: Date.now(),
        });

        log('DEBUG', `[HandleManager] Handle registered (${this.activeHandles.length} active)`);

        return handle;
    }

    /**
     * Limpa todos os handles com timeout protection.
     *
     * v2.0 Improvements:
     * - Timeout configurável (CLEANUP_TIMEOUT_MS)
     * - Timeout individual em dispose (DISPOSE_TIMEOUT_MS)
     * - Metrics tracking (duration, cleaned, errors)
     * - Event emission (success, timeout, error)
     * - AbortController (V800 - cancelamento real)
     *
     * [V800] Usa AbortController para cancelar cleanup em timeout,
     * evitando promises órfãs rodando indefinidamente em background.
     *
     * @async
     * @returns {Promise<object>} Resultado do cleanup
     *
     * Propriedades do objeto retornado:
     *   - cleaned (number): Handles limpos com sucesso
     *   - errors (number): Erros durante cleanup
     *   - timeout (boolean): Se timeout ocorreu
     *   - duration (number): Duração total (ms)
     *
     * @emits HANDLE_EVENTS.HANDLE_CLEARED - Cada handle limpo
     * @emits HANDLE_EVENTS.HANDLES_CLEARED_ALL - Cleanup completo
     * @emits HANDLE_EVENTS.CLEANUP_TIMEOUT - Timeout atingido
     * @emits HANDLE_EVENTS.CLEANUP_ERROR - Erro em dispose
     *
     * @example
     * const result = await manager.clearAll();
     * // { cleaned: 10, errors: 0, timeout: false, duration: 543 }
     */
    async clearAll() {
        const startTime = Date.now();
        const timeout = HANDLE_CONFIG.CLEANUP_TIMEOUT_MS;

        this.stats.totalClearAllCalls++;

        log('INFO', `[HandleManager] Starting clearAll (${this.activeHandles.length} handles, timeout: ${timeout}ms)`);

        // [V800] AbortController permite cancelamento real do cleanup
        const abortController = new AbortController();
        const signal = abortController.signal;

        // Timeout que aborta o cleanup
        const timeoutId = setTimeout(() => {
            abortController.abort();
        }, timeout);

        let cleanedCount = 0;
        let errorsCount = 0;

        try {
            // Cleanup com suporte a abort
            while (this.activeHandles.length > 0) {
                // Verifica abort signal antes de cada iteração
                if (signal.aborted) {
                    throw new Error('CLEANUP_ABORTED');
                }

                const h = /** @type {any} */ (this.activeHandles.pop());

                try {
                    // FIXED (P0-1.3): Usa withTimeout para garantir cleanup
                    await withTimeout(() => h.dispose(), HANDLE_CONFIG.DISPOSE_TIMEOUT_MS, 'HANDLE_DISPOSE_TIMEOUT');

                    cleanedCount++;
                    this.stats.handlesCleared++;

                    // ✅ Emit evento para cada handle limpo
                    this.emit(HANDLE_EVENTS.HANDLE_CLEARED, {
                        cleanedCount,
                        remaining: this.activeHandles.length,
                        timestamp: Date.now(),
                    });
                } catch (/** @type {any} */ disposeErr) {
                    errorsCount++;
                    this.stats.errorsOccurred++;

                    // Log erro individual
                    if (disposeErr.name !== 'AbortError') {
                        log('DEBUG', `[HandleManager] Error disposing handle: ${disposeErr.message}`);

                        // ✅ Emit erro individual
                        this.emit(HANDLE_EVENTS.CLEANUP_ERROR, {
                            error: disposeErr.message,
                            isTimeout: disposeErr.name === 'TimeoutError',
                            cleanedCount,
                            remaining: this.activeHandles.length,
                        });
                    }
                }
            }

            // ✅ Sucesso: todos handles limpos
            clearTimeout(timeoutId);

            const duration = Date.now() - startTime;
            this.stats.lastClearAllDuration = duration;
            this.stats.maxClearAllDuration = Math.max(this.stats.maxClearAllDuration, duration);

            log(
                'INFO',
                `[HandleManager] clearAll completed (${cleanedCount} cleaned, ${errorsCount} errors, ${duration}ms)`
            );

            // ✅ Emit evento de sucesso
            this.emit(HANDLE_EVENTS.HANDLES_CLEARED_ALL, {
                cleaned: cleanedCount,
                errors: errorsCount,
                timeout: false,
                duration,
                timestamp: Date.now(),
            });

            return { cleaned: cleanedCount, errors: errorsCount, timeout: false, duration };
        } catch (/** @type {any} */ _abortErr) {
            // ✅ Timeout atingido: cleanup interrompido
            clearTimeout(timeoutId);

            const remaining = this.activeHandles.length;
            const duration = Date.now() - startTime;

            this.stats.timeoutsOccurred++;
            this.stats.lastClearAllDuration = duration;
            this.stats.maxClearAllDuration = Math.max(this.stats.maxClearAllDuration, duration);

            log('WARN', `[HandleManager] Cleanup aborted after timeout (${timeout}ms)`);
            log(
                'WARN',
                `[HandleManager] ${cleanedCount} cleaned, ${errorsCount} errors, ${remaining} remaining marked for GC`
            );

            // ✅ Emit evento de timeout
            this.emit(HANDLE_EVENTS.CLEANUP_TIMEOUT, {
                cleaned: cleanedCount,
                errors: errorsCount,
                remaining,
                timeout,
                duration,
                timestamp: Date.now(),
            });

            // Esvazia array para liberar referências (GC do Puppeteer limpará)
            this.activeHandles = [];

            return { cleaned: cleanedCount, errors: errorsCount, timeout: true, duration };
        }
    }

    /**
     * Limpa handle específico (cleanup seletivo).
     *
     * v2.0 New Method - permite cleanup individual sem limpar todos.
     * Útil quando handle específico não é mais necessário.
     *
     * @async
     * @param {any} handle - Handle a limpar
     * @returns {Promise<boolean>} True se limpo, false se não encontrado
     *
     * @emits HANDLE_EVENTS.HANDLE_CLEARED - Handle limpo com sucesso
     * @emits HANDLE_EVENTS.CLEANUP_ERROR - Erro ao limpar
     *
     * @example
     * const handle = await page.$('.selector');
     * manager.register(handle);
     *
     * // Cleanup seletivo
     * const cleared = await manager.clearOne(handle);
     * // true (handle limpo)
     */
    async clearOne(handle) {
        const index = this.activeHandles.indexOf(handle);

        if (index === -1) {
            log('DEBUG', '[HandleManager] Handle not found in active handles');
            return false;
        }

        // Remove do array
        this.activeHandles.splice(index, 1);

        try {
            // FIXED (P0-1.3): Usa withTimeout para garantir cleanup do AbortController
            // Previne timeout leaks quando dispose() trava
            await withTimeout(() => handle.dispose(), HANDLE_CONFIG.DISPOSE_TIMEOUT_MS, 'HANDLE_DISPOSE_TIMEOUT');

            this.stats.handlesCleared++;

            // ✅ Emit evento
            this.emit(HANDLE_EVENTS.HANDLE_CLEARED, {
                cleanedCount: this.stats.handlesCleared,
                remaining: this.activeHandles.length,
                timestamp: Date.now(),
            });

            log('DEBUG', `[HandleManager] Handle cleared (${this.activeHandles.length} remaining)`);

            return true;
        } catch (/** @type {any} */ err) {
            this.stats.errorsOccurred++;

            log('WARN', `[HandleManager] Error clearing handle: ${err.message}`);

            // ✅ Emit erro
            this.emit(HANDLE_EVENTS.CLEANUP_ERROR, {
                error: err.message,
                isTimeout: err.code === 'TIMEOUT' || err.name === 'TimeoutError',
                remaining: this.activeHandles.length,
            });

            // FIXED: Forçar dispose mesmo em timeout (best effort)
            try {
                await handle.dispose().catch(() => {});
            } catch (/** @type {any} */ _) {
                // Ignore - já logamos o erro principal acima
            }

            return false;
        }
    }

    /**
     * Retorna número de handles ativos.
     *
     * @returns {number} Count de handles aguardando cleanup
     *
     * @example
     * const count = manager.getActiveCount();
     * // 5
     */
    getActiveCount() {
        return this.activeHandles.length;
    }

    /**
     * Retorna estatísticas completas do HandleManager.
     *
     * v2.0 New Method - introspection completa para debugging/monitoring.
     *
     * @returns {object} Stats object com todas as métricas
     *
     * Propriedades do objeto retornado:
     *   - handlesRegistered (number): Total registrados (histórico)
     *   - handlesCleared (number): Total limpos
     *   - timeoutsOccurred (number): Total de timeouts
     *   - errorsOccurred (number): Total de erros
     *   - totalClearAllCalls (number): Total de clearAll chamadas
     *   - lastClearAllDuration (number): Duração última clearAll (ms)
     *   - maxClearAllDuration (number): Duração máxima clearAll (ms)
     *   - activeHandles (number): Handles atualmente ativos
     *   - config (Object): Configuração atual
     *
     * @example
     * const stats = manager.getStats();
     * console.log(stats);
     * // {
     * //   handlesRegistered: 100,
     * //   handlesCleared: 95,
     * //   timeoutsOccurred: 1,
     * //   errorsOccurred: 3,
     * //   totalClearAllCalls: 10,
     * //   lastClearAllDuration: 543,
     * //   maxClearAllDuration: 2890,
     * //   activeHandles: 5,
     * //   config: { CLEANUP_TIMEOUT_MS: 3000, ... }
     * // }
     */
    getStats() {
        return {
            ...this.stats,
            activeHandles: this.activeHandles.length,
            config: { ...HANDLE_CONFIG },
        };
    }

    /**
     * Helper para criar timeout Promise (usado internamente).
     * Similar ao pattern usado em driver_nerv_adapter v2.0.
     *
     * @private
     * @param {number} ms - Timeout em milissegundos
     * @param {string} operation - Nome da operação (para erro)
     * @returns {Promise<never>} Promise que rejeita após timeout
     *
     * @example
     * await Promise.race([
     *   handle.dispose(),
     *   this._timeout(1000, 'dispose')
     * ]);
     */
    _timeout(ms, operation) {
        return new Promise((_, reject) => {
            setTimeout(() => {
                const error = /** @type {any} */ (new Error(`Timeout after ${ms}ms`));
                error.name = 'TimeoutError';
                error.operation = operation;
                reject(error);
            }, ms);
        });
    }
}

/**
 * Factory function para criar instância do HandleManager
 *
 * **Side-effects:** N/A
 * **Semântica:** Cria nova instância do HandleManager associada ao driver fornecido.
 * **Unidades:** N/A
 *
 * @param {object} driver - Instância do driver para gerenciar handles
 * @returns {HandleManager} Nova instância do HandleManager
 */
export const create = driver => {
    return new HandleManager(driver);
};

/**
 * Constantes de configuração do HandleManager
 *
 * **Side-effects:** N/A
 * **Semântica:** Configurações de timeouts e limites para gerenciamento de handles.
 * **Unidades:** Milissegundos para timeouts, números inteiros para contadores.
 *
 * @type {Object<string, number>}
 */
export { HandleManager };

/**
 * Eventos emitidos pelo HandleManager
 *
 * **Side-effects:** N/A
 * **Semântica:** Enumeração de eventos para comunicação com sistemas externos.
 * **Unidades:** N/A
 *
 * @type {Object<string, string>}
 */
export { HANDLE_CONFIG };

/**
 * Configurações do HandleManager
 *
 * **Side-effects:** N/A
 * **Semântica:** Configurações de timeouts e limites para gerenciamento de handles.
 * **Unidades:** Milissegundos para timeouts, números inteiros para contadores.
 *
 * @type {Object<string, number>}
 */
export { HANDLE_EVENTS };
