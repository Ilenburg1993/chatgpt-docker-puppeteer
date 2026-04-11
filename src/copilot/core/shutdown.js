// @ts-check
/**
 * src/copilot/core/shutdown.js
 *
 * Gerenciador de graceful shutdown centralizado. Registra handlers nomeados com prioridade e os executa em ordem
 * durante o shutdown.
 *
 * L0 (core) — não importa camadas superiores. Logger é injetado via `setShutdownLogger`.
 *
 * @module copilot/core/shutdown
 * @see EventBus
 */

/**
 * @typedef {(level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL', msg: string) => void} ShutdownLogFn
 */

/** @type {ShutdownLogFn} */
let _log = (level, msg) => {
    const fn = level === 'WARN' || level === 'ERROR' ? console.warn : console.log;
    fn(`[shutdown][${level}] ${msg}`);
};

/**
 * @typedef {object} ShutdownHandler
 * @property {string} name - Nome do handler (para log)
 * @property {number} priority - Prioridade (menor = executa primeiro)
 * @property {() => Promise<void>} fn - Função de cleanup
 */

/** @type {ShutdownHandler[]} */
const handlers = [];

/** @type {boolean} */
let shuttingDown = false;

/**
 * Injeta logger externo (ex: observability/logger). Chamado no bootstrap.
 *
 * @param {ShutdownLogFn} logFn
 */
export function setShutdownLogger(logFn) {
    _log = logFn;
}

/**
 * Registra um handler de shutdown com nome e prioridade. Prioridades recomendadas:
 *
 * - 10: agent/session stop
 * - 20: bridges/connections
 * - 30: database close
 * - 40: terminal/infra
 * - 50: final cleanup
 *
 * @param {string} name - Nome descritivo do handler
 * @param {() => Promise<void>} fn - Função de cleanup async
 * @param {number} [priority=50] - Prioridade (menor = executa primeiro). Default is `50`
 */
export function registerShutdownHandler(name, fn, priority = 50) {
    handlers.push({ name, priority, fn });
    handlers.sort((a, b) => a.priority - b.priority);
}

/**
 * Executa todos os handlers de shutdown em ordem de prioridade. Cada handler tem um timeout de 5s. Se um falhar, os
 * próximos continuam. Seguro para chamar múltiplas vezes (idempotente).
 *
 * @param {string} [reason='unknown'] - Motivo do shutdown (para log). Default is `'unknown'`
 * @returns {Promise<void>}
 */
export async function runShutdown(reason = 'unknown') {
    if (shuttingDown) return;
    shuttingDown = true;

    _log('INFO', `Graceful shutdown iniciado (reason: ${reason}) — ${handlers.length} handlers`);

    for (const handler of handlers) {
        try {
            await Promise.race([
                handler.fn(),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error(`Shutdown handler "${handler.name}" timeout`)), 5_000),
                ),
            ]);
            _log('INFO', `  ✓ ${handler.name}`);
        } catch (/** @type {any} */ err) {
            _log('WARN', `  ✗ ${handler.name}: ${err?.message ?? err}`);
        }
    }

    _log('INFO', 'Graceful shutdown concluído');
}

/**
 * Retorna se o processo está em shutdown.
 *
 * @returns {boolean}
 */
export function isShuttingDown() {
    return shuttingDown;
}

/**
 * Remove todos os handlers (apenas para testes).
 */
export function _resetForTesting() {
    handlers.length = 0;
    shuttingDown = false;
}
