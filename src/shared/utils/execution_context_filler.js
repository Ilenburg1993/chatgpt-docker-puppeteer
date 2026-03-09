// @ts-check - Type checking rigoroso habilitado (arquivo core)
import * as logger from '#core/logger';
import fs from 'node:fs';
import os from 'node:os';

/**
 * @typedef {object} FillExecutionContextOptions
 * @property {object} [driver] - Driver instance (BaseDriver, ChatGPTDriver, etc)
 * @property {object} [browserPool] - BrowserPool manager instance
 * @property {number} [tacticalAttempts=0] - Tentativas de retry tático (Driver). Default is `0`
 * @property {number} [strategicAttempts=0] - Tentativas de retry estratégico (Kernel). Default is `0`
 * @property {string[]} [errorsRecovered=[]] - Erros recuperados via retry. Default is `[]`
 * @property {number} [totalBackoffMs=0] - Tempo total aguardado entre retries. Default is `0`
 */

/**
 * @typedef {object} FillExecutionContextTask
 * @property {any} _ Propriedades definidas em runtime.
 */
/**
 * Preenche execution context de uma task V5.
 *
 * @param {FillExecutionContextTask} task - Task V5 object (mutável)
 * @param {FillExecutionContextOptions} options - Opções de preenchimento
 * @returns {any} Task com execution context preenchido
 */
function fillExecutionContext(/** @type {any} */ task, /** @type {any} */ options) {
    options = options || {};

    try {
        // Garante que task tem estrutura V5
        if (!task.execution) {
            logger.warn('[EXECUTION_FILLER] Task sem campo execution, criando estrutura V5...');
            task.execution = {
                driver: {},
                environment: {},
                retry: {},
            };
        }

        // ==========================================
        // 1. DRIVER CONTEXT
        // ==========================================
        if (options.driver) {
            task.execution.driver = {
                type: options.driver.name || options.driver.constructor?.name || 'Unknown',
                version: options.driver.version || '1.0',
                connection_mode: options.driver.connectionMode || 'auto',
                browser_pool_health: options.browserPool?.getHealth?.() || 'unknown',
            };
        } else {
            // Defaults se driver não fornecido
            task.execution.driver = {
                type: task.execution.driver?.type || 'Unknown',
                version: task.execution.driver?.version || '1.0',
                connection_mode: task.execution.driver?.connection_mode || 'auto',
                browser_pool_health: task.execution.driver?.browser_pool_health || 'unknown',
            };
        }

        // ==========================================
        // 2. ENVIRONMENT CONTEXT
        // ==========================================
        task.execution.environment = {
            platform: os.platform(), // 'linux', 'win32', 'darwin'
            node_version: process.version, // 'v24.0.0'
            container: _detectContainer(), // true se Docker
            chrome_version: _getChromeVersion(options.browserPool), // '120.0.6099.109'
        };

        // ==========================================
        // 3. RETRY TELEMETRY
        // ==========================================
        task.execution.retry = {
            tactical_attempts: options.tacticalAttempts || task.execution.retry?.tactical_attempts || 0,
            strategic_attempts: options.strategicAttempts || task.execution.retry?.strategic_attempts || 0,
            errors_recovered: options.errorsRecovered || task.execution.retry?.errors_recovered || [],
            total_backoff_ms: options.totalBackoffMs || task.execution.retry?.total_backoff_ms || 0,
        };

        logger.debug(
            `[EXECUTION_FILLER] Execution context preenchido para task ${task.meta.id}`,
            /** @type {any} */ ({
                driver: task.execution.driver.type,
                platform: task.execution.environment.platform,
                tacticalAttempts: task.execution.retry.tactical_attempts,
                strategicAttempts: task.execution.retry.strategic_attempts,
            }),
        );

        return task;
    } catch (/** @type {any} */ error) {
        const _ce = /** @type {any} */ (error);
        logger.error(
            `[EXECUTION_FILLER] Erro ao preencher execution context: ${_ce.message}`,
            /** @type {any} */ ({
                task_id: task?.meta?.id,
                error,
            }),
        );
        // Não throw - retorna task sem modificar
        return task;
    }
}

/**
 * Detecta se está rodando em container Docker.
 *
 * @private
 * @returns {boolean}
 */
function _detectContainer() {
    try {
        // Método 1: Verifica /.dockerenv
        if (fs.existsSync('/.dockerenv')) {
            return true;
        }

        // Método 2: Verifica /proc/1/cgroup
        if (fs.existsSync('/proc/1/cgroup')) {
            const cgroup = fs.readFileSync('/proc/1/cgroup', 'utf8');
            if (cgroup.includes('docker') || cgroup.includes('kubepods')) {
                return true;
            }
        }

        return false;
    } catch (/** @type {any} */ error) {
        const _ce = /** @type {any} */ (error);
        logger.debug(
            '[EXECUTION_FILLER] Erro ao detectar container, assumindo false',
            /** @type {any} */ ({ error: _ce.message }),
        );
        return false;
    }
}

/**
 * @typedef {object} GetChromeVersionBrowserPool
 * @property {any} _ Propriedades definidas em runtime.
 */
/**
 * Obtém versão do Chrome do BrowserPool.
 *
 * @private
 * @param {GetChromeVersionBrowserPool} browserPool - BrowserPool manager
 * @returns {Promise<string>} Chrome version ou 'unknown'
 */
async function _getChromeVersion(/** @type {any} */ browserPool) {
    try {
        // Tenta obter versão do browserPool
        if (browserPool?.browser?.version) {
            return browserPool.browser.version();
        }

        // Fallback: tenta obter via puppeteer
        const puppeteer = await import('puppeteer').then((m) => m.default ?? m);
        if (typeof puppeteer.executablePath === 'function') {
            // Versão está embutida no path geralmente
            return 'unknown';
        }

        return 'unknown';
    } catch (/** @type {any} */ error) {
        const _ce = /** @type {any} */ (error);
        logger.debug('[EXECUTION_FILLER] Erro ao obter Chrome version', /** @type {any} */ ({ error: _ce.message }));
        return 'unknown';
    }
}

/**
 * @typedef {object} IncrementTacticalAttemptsTask
 * @property {any} _ Propriedades definidas em runtime.
 */
/**
 * Incrementa tactical_attempts (retry Driver). Usado durante retry loop no Driver.
 *
 * @param {IncrementTacticalAttemptsTask} task - Task V5 object
 * @param {string} [errorRecovered] - Erro recuperado (opcional)
 * @param {number} [backoffMs=0] - Tempo aguardado neste backoff. Default is `0`
 * @returns {void}
 */
function incrementTacticalAttempts(
    /** @type {any} */ task,
    /** @type {any} */ errorRecovered,
    /** @type {any} */ backoffMs,
) {
    errorRecovered = errorRecovered || null;
    backoffMs = backoffMs || 0;

    if (!task.execution || !task.execution.retry) {
        logger.warn('[EXECUTION_FILLER] Task sem execution.retry, inicializando...');
        task.execution = task.execution || {};
        task.execution.retry = {
            tactical_attempts: 0,
            strategic_attempts: 0,
            errors_recovered: [],
            total_backoff_ms: 0,
        };
    }

    task.execution.retry.tactical_attempts++;
    task.execution.retry.total_backoff_ms += backoffMs;

    if (errorRecovered) {
        task.execution.retry.errors_recovered.push(errorRecovered);
    }

    logger.debug(
        `[EXECUTION_FILLER] Tactical attempt ${task.execution.retry.tactical_attempts}`,
        /** @type {any} */ ({
            task_id: task.meta.id,
            error: errorRecovered,
            backoff_ms: backoffMs,
        }),
    );
}

/**
 * @typedef {object} IncrementStrategicAttemptsTask
 * @property {any} _ Propriedades definidas em runtime.
 */
/**
 * Incrementa strategic_attempts (retry Kernel - reagendamento). Usado quando Kernel reagenda task após falha.
 *
 * @param {IncrementStrategicAttemptsTask} task - Task V5 object
 * @param {string} [errorRecovered] - Erro recuperado (opcional)
 * @param {number} [backoffMs=0] - Tempo aguardado neste backoff. Default is `0`
 * @returns {void}
 */
function incrementStrategicAttempts(
    /** @type {any} */ task,
    /** @type {any} */ errorRecovered,
    /** @type {any} */ backoffMs,
) {
    errorRecovered = errorRecovered || null;
    backoffMs = backoffMs || 0;

    if (!task.execution || !task.execution.retry) {
        logger.warn('[EXECUTION_FILLER] Task sem execution.retry, inicializando...');
        task.execution = task.execution || {};
        task.execution.retry = {
            tactical_attempts: 0,
            strategic_attempts: 0,
            errors_recovered: [],
            total_backoff_ms: 0,
        };
    }

    task.execution.retry.strategic_attempts++;
    task.execution.retry.total_backoff_ms += backoffMs;

    if (errorRecovered) {
        task.execution.retry.errors_recovered.push(errorRecovered);
    }

    logger.debug(
        `[EXECUTION_FILLER] Strategic attempt ${task.execution.retry.strategic_attempts}`,
        /** @type {any} */ ({
            task_id: task.meta.id,
            error: errorRecovered,
            backoff_ms: backoffMs,
        }),
    );
}

export { fillExecutionContext, incrementStrategicAttempts, incrementTacticalAttempts };
