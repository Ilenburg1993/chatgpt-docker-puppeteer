// @ts-check - Type checking rigoroso habilitado

import * as driverFactory from './factory.js';

/**
 * Opções do construtor do DriverLifecycleManager.
 * @typedef {Object} DriverLifecycleOptions
 * @property {string|null} [taskId] - ID da tarefa associada.
 * @property {string|null} [target] - Nome do target do driver.
 * @property {Object} [driverConfig] - Configuração adicional do driver.
 */

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
     * Cria um gerenciador de ciclo de vida para drivers.
     * @param {DriverLifecycleOptions} [options={}] - Opções de configuração.
     */
    constructor({ taskId = null, target = null, driverConfig = {} } = {}) {
        this.taskId = taskId;
        this.target = target;
        this.driverConfig = driverConfig;

        // Soberania de interrupcao: o chamador pode abortar execucao a qualquer momento.
        this.abortController = new AbortController();

        /** @type {import('#types/driver/contracts').IDriver | null} */
        this.driver = null;
        this._released = false;
    }

    /**
     * @returns {AbortSignal} Sinal de abort para controle de interrupção.
     */
    get signal() {
        return this.abortController.signal;
    }

    /**
     * Cria/adquire um driver. Não faz attach a página por conta própria.
     * @returns {Promise<any>} Instância do driver adquirido.
     * @throws {Error} Se falhar ao adquirir driver do pool ou criar novo.
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
     * Interrompe a execução associada.
     * @param {string} [reason='aborted'] - Motivo da interrupção.
     * @returns {void}
     * @sideEffects Aborta o AbortController associado.
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
     * Libera o driver de volta ao pool quando aplicável.
     * @returns {Promise<void>}
     * @sideEffects Retorna driver ao pool e limpa referência local.
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
