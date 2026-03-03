// @ts-check - Type checking rigoroso habilitado (arquivo core)
import os from 'node:os';
import * as logger from '#core/logger';
import fs from 'node:fs';

/**
 * @typedef {object} FillExecutionContextOptions
 * @property {object} [driver] - Driver instance (BaseDriver, ChatGPTDriver, etc)
 * @property {object} [browserPool] - BrowserPool manager instance
 * @property {number} [tacticalAttempts=0] - Tentativas de retry tático (Driver)
 * @property {number} [strategicAttempts=0] - Tentativas de retry estratégico (Kernel)
 * @property {string[]} [errorsRecovered=[]] - Erros recuperados via retry
 * @property {number} [totalBackoffMs=0] - Tempo total aguardado entre retries
 */

/**
 * Preenche execution context de uma task V5.
 *
 * @param {object} task - Task V5 object (mutável)
 * @param {FillExecutionContextOptions} options - Opções de preenchimento
 * @returns {object} Task com execution context preenchido
 */
function fillExecutionContext(task, options) {
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

        logger.debug(`[EXECUTION_FILLER] Execution context preenchido para task ${task.meta.id}`, {
            driver: task.execution.driver.type,
            platform: task.execution.environment.platform,
            tacticalAttempts: task.execution.retry.tactical_attempts,
            strategicAttempts: task.execution.retry.strategic_attempts,
        });

        return task;
    } catch (error) {
        logger.error(`[EXECUTION_FILLER] Erro ao preencher execution context: ${error.message}`, {
            task_id: task?.meta?.id,
            error,
        });
        // Não throw - retorna task sem modificar
        return task;
    }
}

/**
 * Detecta se está rodando em container Docker.
 * @returns {boolean}
 * @private
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
    } catch (error) {
        logger.debug('[EXECUTION_FILLER] Erro ao detectar container, assumindo false', { error: error.message });
        return false;
    }
}

/**
 * Obtém versão do Chrome do BrowserPool.
 * @param {object} browserPool - BrowserPool manager
 * @returns {Promise<string>} Chrome version ou 'unknown'
 * @private
 */
async function _getChromeVersion(browserPool) {
    try {
        // Tenta obter versão do browserPool
        if (browserPool?.browser?.version) {
            return browserPool.browser.version();
        }

        // Fallback: tenta obter via puppeteer
        const puppeteer = await import('puppeteer').then(m => m.default ?? m);
        if (puppeteer.executablePath) {
            // Versão está embutida no path geralmente
            return 'unknown';
        }

        return 'unknown';
    } catch (error) {
        logger.debug('[EXECUTION_FILLER] Erro ao obter Chrome version', { error: error.message });
        return 'unknown';
    }
}

/**
 * Incrementa tactical_attempts (retry Driver).
 * Usado durante retry loop no Driver.
 *
 * @param {object} task - Task V5 object
 * @param {string} [errorRecovered] - Erro recuperado (opcional)
 * @param {number} [backoffMs=0] - Tempo aguardado neste backoff
  * @returns {void}
 */
function incrementTacticalAttempts(task, errorRecovered, backoffMs) {
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

    logger.debug(`[EXECUTION_FILLER] Tactical attempt ${task.execution.retry.tactical_attempts}`, {
        task_id: task.meta.id,
        error: errorRecovered,
        backoff_ms: backoffMs,
    });
}

/**
 * Incrementa strategic_attempts (retry Kernel - reagendamento).
 * Usado quando Kernel reagenda task após falha.
 *
 * @param {object} task - Task V5 object
 * @param {string} [errorRecovered] - Erro recuperado (opcional)
 * @param {number} [backoffMs=0] - Tempo aguardado neste backoff
  * @returns {void}
 */
function incrementStrategicAttempts(task, errorRecovered, backoffMs) {
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

    logger.debug(`[EXECUTION_FILLER] Strategic attempt ${task.execution.retry.strategic_attempts}`, {
        task_id: task.meta.id,
        error: errorRecovered,
        backoff_ms: backoffMs,
    });
}

export { fillExecutionContext, incrementTacticalAttempts, incrementStrategicAttempts };
