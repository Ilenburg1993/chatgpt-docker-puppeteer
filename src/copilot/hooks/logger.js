// @ts-check
/**
 * src/copilot/hooks/logger.js
 *
 * Logger minimal para o módulo hooks/.
 *
 * Faixa 3.1 — AC: `hooks/ → observability/` layer violation fix.
 *
 * Em vez de importar o logger estruturado de observability/ (que é uma camada proibida para hooks/), este módulo expõe
 * a mesma assinatura `log(level, msg)` via um wrapper leve.
 *
 * O logger real pode ser injetado via `setHooksLogger()` por uma camada superior (agent/, server/). Se não injetado,
 * usa `console.*` como fallback.
 *
 * @module copilot/hooks/logger
 */

/**
 * @callback LogFn
 * @param {'DEBUG' | 'INFO' | 'WARN' | 'ERROR'} level
 * @param {string | Error | Record<string, unknown>} msg
 * @param {string | Record<string, unknown>} [meta]
 * @returns {void}
 */

/** @type {LogFn | null} */
let _injectedLogger = null;

/**
 * Injeta logger estruturado (chamado por agent/ ou server/ ao inicializar).
 *
 * @param {LogFn} logFn
 * @returns {void}
 */
export function setHooksLogger(logFn) {
    _injectedLogger = logFn;
}

/**
 * Remove logger injetado (ex: após shutdown ou em testes).
 *
 * @returns {void}
 */
export function clearHooksLogger() {
    _injectedLogger = null;
}

/**
 * Logger do módulo hooks/. Usa logger injetado se disponível; caso contrário, console.*.
 *
 * @type {LogFn}
 */
export function log(level, msg, meta) {
    if (_injectedLogger) {
        _injectedLogger(level, msg, meta);
        return;
    }
    const text = msg instanceof Error ? msg.message : typeof msg === 'object' ? JSON.stringify(msg) : msg;
    switch (level.toUpperCase()) {
        case 'ERROR':
            console.error(text);
            break;
        case 'WARN':
            console.warn(text);
            break;
        case 'DEBUG':
            // Supress em produção sem logger injetado
            break;
        default:
            console.info(text);
    }
}
