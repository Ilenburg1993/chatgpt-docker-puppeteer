// @ts-check
/**
 * @module copilot/presentation/agent-http-errors
 * @file Projeção HTTP canônica para erros do runtime do `agent`.
 *
 *   Esta camada concentra a semântica de borda para erros do agente e evita que cada rota HTTP continue inventando seu
 *   próprio mapeamento `Error -> status/body`.
 */

import { toError } from '#copilot/core';
import { classifyAgentError } from '../agent/error-policy.js';

/** @typedef {import('../agent/error-policy.js').AgentErrorDisposition} AgentErrorDisposition */

/**
 * @typedef {Object} AgentHttpErrorProjection
 * @property {number} status
 * @property {{ ok: false; error: string; code?: string; disposition: AgentErrorDisposition; retryable: boolean }} body
 */

/**
 * @typedef {Object} AgentHttpErrorOptions
 * @property {number} [fallbackStatus]
 * @property {number} [timeoutStatus]
 * @property {string} [overrideMessage]
 * @property {string} [timeoutMessage]
 * @property {Partial<Record<string, number>>} [statusByCode]
 */

/** @type {Readonly<Record<string, number>>} */
export const DEFAULT_AGENT_HTTP_STATUS_BY_CODE = Object.freeze({
    ABORT_ERR: 504,
    AGENT_STOPPED: 503,
    BRIDGE_AGENT_STOPPED: 503,
    DIALOG_ENDED: 409,
    DIALOG_NOT_ACTIVE: 409,
    DIALOG_QUEUE_FULL: 429,
    DIALOG_TIMEOUT: 504,
    ERR_IPC_CHANNEL_CLOSED: 503,
    ERR_IPC_DISCONNECTED: 503,
    ERR_SOCKET_CLOSED: 503,
    NOT_ATTACHED: 503,
    NO_SESSION: 503,
    QUEUE_FULL: 429,
    SESSION_FATAL: 503,
});

/**
 * Projeta um erro do runtime do agente para uma resposta HTTP consistente.
 *
 * @param {unknown} error
 * @param {AgentHttpErrorOptions} [options]
 * @returns {AgentHttpErrorProjection}
 */
export function projectAgentHttpError(error, options = {}) {
    const { fallbackStatus = 500, timeoutStatus = 504, overrideMessage, timeoutMessage, statusByCode = {} } = options;

    const normalized = toError(error);
    const disposition = classifyAgentError(normalized);
    const rawCode = normalized.code;
    const code = typeof rawCode === 'string' ? rawCode : typeof rawCode === 'number' ? String(rawCode) : undefined;

    const explicitStatus =
        code && Object.prototype.hasOwnProperty.call(statusByCode, code)
            ? statusByCode[code]
            : code && Object.prototype.hasOwnProperty.call(DEFAULT_AGENT_HTTP_STATUS_BY_CODE, code)
              ? DEFAULT_AGENT_HTTP_STATUS_BY_CODE[code]
              : undefined;

    const status =
        explicitStatus ?? (disposition === 'fatal' ? 503 : disposition === 'ignore' ? timeoutStatus : fallbackStatus);

    const isTimeoutLike = code === 'ABORT_ERR' || code === 'DIALOG_TIMEOUT' || disposition === 'ignore';
    const message =
        overrideMessage ?? (isTimeoutLike && typeof timeoutMessage === 'string' ? timeoutMessage : normalized.message);

    return {
        status,
        body: {
            ok: false,
            error: message,
            ...(code ? { code } : {}),
            disposition,
            retryable: disposition === 'retry',
        },
    };
}
