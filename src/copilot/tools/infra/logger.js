// @ts-check
/**
 * src/copilot/tools/infra/logger.js
 *
 * Logger minimal para o módulo tools/.
 *
 * Faixa 3.1 — AC: `tools/ → observability/` layer violation fix.
 *
 * Em vez de importar o logger estruturado de observability/ (camada proibida para tools/), este módulo expõe a mesma
 * assinatura `log(level, msg)` via wrapper leve com injeção opcional.
 *
 * O logger real pode ser injetado via `setToolsLogger()` por uma camada superior (agent/, server/). Se não injetado,
 * usa `console.*` como fallback.
 *
 * @module copilot/tools/infra/logger
 */
import { toError } from '#copilot/core/error-handlers';
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
export function setToolsLogger(logFn) {
    _injectedLogger = logFn;
}

/**
 * Remove logger injetado (ex: após shutdown ou em testes).
 *
 * @returns {void}
 */
export function clearToolsLogger() {
    _injectedLogger = null;
}

/**
 * Logger do módulo tools/. Usa logger injetado se disponível; caso contrário, console.*.
 *
 * @type {LogFn}
 */
export function log(level, msg, meta) {
    if (_injectedLogger) {
        _injectedLogger(level, msg, meta);
        return;
    }
    const text = msg instanceof Error ? toError(msg).message : typeof msg === 'object' ? JSON.stringify(msg) : msg;
    switch (level.toUpperCase()) {
        case 'ERROR':
            console.error(text);
            break;
        case 'WARN':
            console.warn(text);
            break;
        case 'DEBUG':
            // L1-FIX: Sempre logar DEBUG via console.debug, mesmo sem logger injetado
            console.debug(text);
            break;
        default:
            console.info(text);
    }
}
