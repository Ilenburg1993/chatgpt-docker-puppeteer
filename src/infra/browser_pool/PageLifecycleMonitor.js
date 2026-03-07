// @ts-check
import { log } from '#core/logger';

/**
 * Event types emitidos pelo monitor.
 * @readonly
 * @enum {string}
 */
const LIFECYCLE_EVENTS = {
    PAGE_CLOSED: 'BROWSER_PAGE_CLOSED',
    PAGE_ERROR: 'BROWSER_PAGE_ERROR',
    PAGE_DISCONNECTED: 'BROWSER_PAGE_DISCONNECTED',
};

/**
 * Reason codes para page close events.
 * @readonly
 * @enum {string}
 */
const CLOSE_REASONS = {
    USER_CLOSED: 'USER_CLOSED', // Usuário fechou manualmente
    BROWSER_CLOSED: 'BROWSER_CLOSED', // Browser inteiro fechou
    CRASHED: 'CRASHED', // Page crashed
    UNKNOWN: 'UNKNOWN', // Reason desconhecida
};

/**
 * PageLifecycleMonitor - Monitora eventos de lifecycle de uma página.
 *
 * Instância por página, anexa listeners e cleanup automático.
 */
class PageLifecycleMonitor {
    /**
     * Cria monitor para página.
     *
     * @param {any} page - Puppeteer Page instance
     * @param {any} poolManager - Pool manager reference
     * @param {string} taskId - Task ID associado à página
     * @param {{ emit?: (event: unknown) => void } | null} [nerv=null] - NERV event bus (opcional)
     */
    constructor(page, poolManager, taskId, nerv = null) {
        if (!page) {
            throw new Error('[PageLifecycleMonitor] Page is required');
        }

        if (!poolManager) {
            throw new Error('[PageLifecycleMonitor] PoolManager is required');
        }

        if (!taskId) {
            throw new Error('[PageLifecycleMonitor] TaskId is required');
        }

        this.page = page;
        this.poolManager = poolManager;
        this.taskId = taskId;
        this.nerv = nerv;
        /** @type {any[]} */
        this.listeners = [];
        this.active = false;

        // Metadata
        this.createdAt = Date.now();
        this.eventsReceived = 0;
        this.rebindCount = 0;

        // Attach listeners imediatamente
        this._attachListeners();
    }

    /**
     * Anexa listeners para eventos de página.
     * @private
     */
    _attachListeners() {
        if (this.active) {
            log('WARN', `[PageLifecycleMonitor] Listeners already attached for ${this.taskId}`);
            return;
        }

        try {
            // 1. Page close event
            const closeHandler = () => {
                this.eventsReceived++;
                log('WARN', `[PageLifecycleMonitor] Page closed: ${this.taskId}`);
                this.handlePageClose();
            };
            this.page.on('close', closeHandler);
            this.listeners.push({ event: 'close', handler: closeHandler });

            // 2. Page error event
            const errorHandler = (/** @type {any} */ err) => {
                this.eventsReceived++;
                log('ERROR', `[PageLifecycleMonitor] Page error: ${this.taskId} - ${err.message}`);
                this.handlePageError(err);
            };
            this.page.on('error', errorHandler);
            this.listeners.push({ event: 'error', handler: errorHandler });

            // 3. Target disconnected event
            const disconnectHandler = () => {
                this.eventsReceived++;
                log('WARN', `[PageLifecycleMonitor] Target disconnected: ${this.taskId}`);
                this.handlePageDisconnect();
            };
            this.page.on('disconnected', disconnectHandler);
            this.listeners.push({ event: 'disconnected', handler: disconnectHandler });

            this.active = true;

            log(
                'DEBUG',
                `[PageLifecycleMonitor] Listeners attached for ${this.taskId} (${this.listeners.length} events)`
            );
        } catch (/** @type {any} */ _rawErr) {
            const err = /** @type {any} */ (_rawErr);
            log('ERROR', `[PageLifecycleMonitor] Failed to attach listeners: ${err.message}`);
        }
    }

    /**
     * Handler para page.on('close').
     *
     * Chamado quando:
     * - Usuário fecha tab manualmente
     * - Browser fecha
     * - Page.close() é chamado programaticamente
     */
    handlePageClose() {
        try {
            // 1. Remove from pool
            this.poolManager.removePageFromPool(this.taskId);

            // 2. Emit NERV event (se disponível)
            if (this.nerv) {
                (/** @type {any} */ (this.nerv)).emit({
                    type: LIFECYCLE_EVENTS.PAGE_CLOSED,
                    payload: {
                        taskId: this.taskId,
                        reason: CLOSE_REASONS.USER_CLOSED,
                        timestamp: Date.now(),
                        duration: Date.now() - this.createdAt,
                    },
                });
            }

            // 3. Update stats
            if (this.poolManager.stats) {
                this.poolManager.stats.pagesClosedByUser = (this.poolManager.stats.pagesClosedByUser || 0) + 1;
            }

            // 4. Cleanup listeners
            this.cleanup();

            log('INFO', `[PageLifecycleMonitor] Page close handled: ${this.taskId}`);
        } catch (/** @type {any} */ _rawErr) {
            const err = /** @type {any} */ (_rawErr);
            log('ERROR', `[PageLifecycleMonitor] Error handling page close: ${err.message}`);
        }
    }

    /**
     * Handler para page.on('error').
     *
     * Chamado quando JavaScript error ocorre na página.
     *
     * @param {Error} err - Error object
     */
    handlePageError(err) {
        try {
            // 1. Update stats
            if (this.poolManager.stats) {
                this.poolManager.stats.pageErrors = (this.poolManager.stats.pageErrors || 0) + 1;
            }

            // 2. Emit NERV event
            if (this.nerv) {
                (/** @type {any} */ (this.nerv)).emit({
                    type: LIFECYCLE_EVENTS.PAGE_ERROR,
                    payload: {
                        taskId: this.taskId,
                        error: err.message,
                        timestamp: Date.now(),
                    },
                });
            }

            log('WARN', `[PageLifecycleMonitor] Page error recorded: ${this.taskId}`);
        } catch (/** @type {any} */ _rawError) {
            const error = /** @type {any} */ (_rawError);
            log('ERROR', `[PageLifecycleMonitor] Error handling page error: ${error.message}`);
        }
    }

    /**
     * Handler para page.on('disconnected').
     *
     * Chamado quando target é disconnected (crash, browser close).
     */
    handlePageDisconnect() {
        try {
            // 1. Remove from pool
            this.poolManager.removePageFromPool(this.taskId);

            // 2. Update stats
            if (this.poolManager.stats) {
                this.poolManager.stats.pagesDisconnected = (this.poolManager.stats.pagesDisconnected || 0) + 1;
            }

            // 3. Emit NERV event
            if (this.nerv) {
                (/** @type {any} */ (this.nerv)).emit({
                    type: LIFECYCLE_EVENTS.PAGE_DISCONNECTED,
                    payload: {
                        taskId: this.taskId,
                        timestamp: Date.now(),
                    },
                });
            }

            // 4. Cleanup listeners
            this.cleanup();

            log('INFO', `[PageLifecycleMonitor] Page disconnect handled: ${this.taskId}`);
        } catch (/** @type {any} */ _rawErr) {
            const err = /** @type {any} */ (_rawErr);
            log('ERROR', `[PageLifecycleMonitor] Error handling page disconnect: ${err.message}`);
        }
    }

    /**
     * Remove todos os event listeners.
     *
     * Chamado:
     * - Automaticamente após page close/disconnect
     * - Manualmente ao liberar página normalmente
     */
    cleanup() {
        if (!this.active) {
            return;
        }

        try {
            this.listeners.forEach(({ event, handler }) => {
                this.page.removeListener(event, handler);
            });

            this.listeners = [];
            this.active = false;

            log('DEBUG', `[PageLifecycleMonitor] Cleanup completed for ${this.taskId}`);
        } catch (/** @type {any} */ _rawErr) {
            const err = /** @type {any} */ (_rawErr);
            log('ERROR', `[PageLifecycleMonitor] Cleanup failed: ${err.message}`);
        }
    }

    /**
     * Reassocia monitor para novo taskId (hot-reuse).
     *
     * @param {string} newTaskId - Novo taskId real
     * @returns {void}
     */
    rebindTaskId(newTaskId) {
        const previousTaskId = this.taskId;
        const normalizedTaskId = typeof newTaskId === 'string' ? newTaskId.trim() : '';

        if (!normalizedTaskId) {
            log('WARN', '[PageLifecycleMonitor] Ignoring rebind with empty taskId');
            return;
        }

        if (normalizedTaskId === previousTaskId) {
            return;
        }

        this.taskId = normalizedTaskId;
        this.rebindCount++;

        if (this.nerv) {
            (/** @type {any} */ (this.nerv)).emit({
                type: 'BROWSER_PAGE_TASK_REBIND',
                payload: {
                    oldTaskId: previousTaskId,
                    newTaskId: normalizedTaskId,
                    timestamp: Date.now(),
                    rebindCount: this.rebindCount,
                },
            });
        }

        log('DEBUG', `[PageLifecycleMonitor] TaskId rebind: ${previousTaskId} -> ${normalizedTaskId}`);
    }

    /**
     * Retorna status do monitor.
     *
     * @returns {any} Status object
     */
    getStatus() {
        return {
            taskId: this.taskId,
            active: this.active,
            listenersCount: this.listeners.length,
            eventsReceived: this.eventsReceived,
            uptime: Date.now() - this.createdAt,
        };
    }
}

export { PageLifecycleMonitor, LIFECYCLE_EVENTS, CLOSE_REASONS };
