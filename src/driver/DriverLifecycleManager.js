// @ts-check

import * as driverFactory from './factory.js';

/**
 * DriverLifecycleManager
 *
 * Responsabilidade: coordenar o ciclo de vida de um driver por task, com soberania
 * de interrupcao via AbortController.
 *
 * Nota: este modulo nao deve importar KERNEL nem SERVER. Ele so orquestra drivers.
 */
export class DriverLifecycleManager {
    /**
     * @param {object} opts
     * @param {string} [opts.taskId]
     * @param {string} [opts.target]
     * @param {object} [opts.driverConfig]
     */
    constructor({ taskId = null, target = null, driverConfig = {} } = {}) {
        this.taskId = taskId;
        this.target = target;
        this.driverConfig = driverConfig;

        // Soberania de interrupcao: o chamador pode abortar execucao a qualquer momento.
        this.abortController = new AbortController();

        /** @type {any} */
        this.driver = null;
        this._released = false;
    }

    /** @returns {AbortSignal} */
    get signal() {
        return this.abortController.signal;
    }

    /**
     * Cria/adquire um driver. Nao faz attach a pagina por conta propria.
     * @returns {Promise<any>}
     */
    async acquire() {
        if (this.driver) return this.driver;

        const target = (this.target || driverFactory.getDefaultTarget()).toLowerCase();

        // Prefer pool se habilitado; cai para createDriver quando necessario.
        let driver = null;
        try {
            driver = await driverFactory.acquireFromPool(target);
        } catch {
            // ignore and fallback
        }
        if (!driver) {
            driver = await driverFactory.createDriver(target, this.driverConfig);
        }

        this.driver = driver;
        return driver;
    }

    /**
     * Interrompe a execucao associada.
     * @param {string} [reason]
     */
    abort(reason = 'aborted') {
        try {
            this.abortController.abort(new Error(reason));
        } catch {
            // AbortController pode lancar se abort() for chamado multiplas vezes em alguns runtimes
            this.abortController.abort();
        }
    }

    /**
     * Libera o driver de volta ao pool quando aplicavel.
     * @returns {Promise<void>}
     */
    async release() {
        if (this._released) return;
        this._released = true;

        if (!this.driver) return;

        try {
            await driverFactory.releaseToPool(this.driver);
        } finally {
            this.driver = null;
        }
    }
}

export default DriverLifecycleManager;
