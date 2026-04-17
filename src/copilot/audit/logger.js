// @ts-check
/**
 * src/copilot/audit/logger.js
 *
 * Proxy local de logger e LOG_DIR para o módulo audit. Evita dependência L1 → L2 (audit/ → observability/). Fallback
 * para console antes do bootstrap.
 *
 * @module copilot/audit/logger
 * @see EventBus
 */

import path, { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * @typedef {'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL'} LogLevel
 */

/**
 * @typedef {(level: LogLevel, msg: string, meta?: string) => void} LogFn
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../../..');

/** @type {LogFn} */
let _log = (level, msg, meta) => {
    const line = `[audit] ${level}: ${msg}${meta ? ` ${meta}` : ''}`;
    if (level === 'ERROR' || level === 'FATAL') console.error(line);
    else if (level === 'WARN') console.warn(line);
    else console.log(line);
};

/** @type {string} */
let _logDir = process.env['COPILOT_LOG_DIR']
    ? resolve(process.env['COPILOT_LOG_DIR'])
    : path.join(PROJECT_ROOT, 'var', 'logs', 'copilot');

/**
 * Injeta o logger real do observability. Chamado no bootstrap.
 *
 * @param {LogFn} logFn
 * @param {string} [logDir]
 */
export function setAuditLogger(logFn, logDir) {
    if (typeof logFn === 'function') _log = logFn;
    if (logDir) _logDir = logDir;
}

/**
 * Logger proxy para uso interno do audit.
 *
 * @type {LogFn}
 */
export function log(level, msg, meta) {
    _log(level, msg, meta);
}

/**
 * Diretório de logs (espelha LOG_DIR do observability após bootstrap).
 *
 * @returns {string}
 */
export function getLogDir() {
    return _logDir;
}
