// @ts-check
/**
 * src/copilot/sdk/logger.js
 *
 * Proxy local de logger para o módulo SDK. Permite que `observability/logger` seja injetado em runtime (via bootstrap),
 * evitando dependência direta de L1 → L2.
 *
 * Fallback: WARN+ apenas no console cru. INFO/DEBUG antes do bootstrap tendem a poluir o terminal interativo e o boot
 * do subprocesso CLI; assim, preservamos erros importantes sem degradar a UX realtime.
 *
 * @module copilot/sdk/logger
 * @see EventBus
 */

import { toError } from '#copilot/infra/public/platform/error';

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

/** @type {((error: unknown, context: string) => void) | null} */
let _reportError = null;

/** @param {(error: unknown, context: string) => void} reporter */
export function setSdkErrorReporter(reporter) {
    _reportError = typeof reporter === 'function' ? reporter : null;
}

/**
 * Best-effort reporting owned by the SDK boundary. Reporting failure never changes SDK control flow.
 * @param {unknown} error
 * @param {string} context
 */
export function logSdkSwallowed(error, context) {
    const normalized = toError(error);
    try {
        log('DEBUG', `[swallowed:${context}] ${normalized.message}`);
    } catch {
        /* reporting never changes control flow */
    }
    try {
        _reportError?.(error, context);
    } catch {
        /* reporting never changes control flow */
    }
}
