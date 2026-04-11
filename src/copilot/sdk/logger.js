// @ts-check
/**
 * src/copilot/sdk/logger.js
 *
 * Proxy local de logger para o módulo SDK. Permite que `observability/logger` seja injetado em runtime (via bootstrap),
 * evitando dependência direta de L1 → L2.
 *
 * Fallback: console.error (nenhum log é perdido antes do bootstrap).
 *
 * @module copilot/sdk/logger
 * @see EventBus
 */

/**
 * @typedef {'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL'} LogLevel
 */

/**
 * @typedef {(level: LogLevel, msg: string, meta?: string) => void} LogFn
 */

/** @type {LogFn} */
let _log = (level, msg, meta) => {
    const line = `[sdk] ${level}: ${msg}${meta ? ` ${meta}` : ''}`;
    if (level === 'ERROR' || level === 'FATAL') console.error(line);
    else if (level === 'WARN') console.warn(line);
    else console.log(line);
};

/**
 * Injeta o logger real do observability. Chamado uma vez durante o bootstrap.
 *
 * @param {LogFn} logFn
 */
export function setSdkLogger(logFn) {
    if (typeof logFn === 'function') _log = logFn;
}

/**
 * Logger proxy para uso interno do SDK.
 *
 * @type {LogFn}
 */
export function log(level, msg, meta) {
    _log(level, msg, meta);
}
