// @ts-check
/**
 * Logger do runtime de hooks em superfície neutra (SDK).
 *
 * Mantém assinatura `log(level,msg,meta)` com injeção tardia, evitando que camadas fora de hooks dependam do módulo
 * `hooks/` apenas para configurar logging.
 *
 * @module copilot/sdk/session/hook-logger
 */

/**
 * @callback HookLogFn
 * @param {'DEBUG' | 'INFO' | 'WARN' | 'ERROR'} level
 * @param {string | Error | Record<string, unknown>} msg
 * @param {string | Record<string, unknown>} [meta]
 * @returns {void}
 */

/** @type {HookLogFn | null} */
let _injectedLogger = null;

/**
 * @param {HookLogFn} logFn
 * @returns {void}
 */
export function setHooksLogger(logFn) {
    _injectedLogger = logFn;
}

/**
 * @returns {void}
 */
export function clearHooksLogger() {
    _injectedLogger = null;
}

/**
 * @type {HookLogFn}
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
            break;
        default:
            console.info(text);
    }
}
