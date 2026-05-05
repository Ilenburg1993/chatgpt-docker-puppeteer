// @ts-check
/**
 * src/copilot/agent/runtime-contracts.js
 *
 * Helpers de fronteira runtime para o subsistema agent.
 *
 * Objetivo: concentrar validações leves de capabilities e APIs opcionais do SDK fora dos módulos quentes, reduzindo
 * casts `unknown` espalhados e tornando as exceções de contrato explícitas.
 *
 * @module copilot/agent/runtime-contracts
 */

import { SessionError } from '#copilot/core';
import { setSessionModel } from '#copilot/sdk';
import { toError } from '../core/error-handlers.js';
import { log } from './ports/logging-port.js';

/**
 * @typedef {import('./types.js').AgentEventHost} AgentEventHost
 *
 * @typedef {import('./types.js').CopilotSession} CopilotSession
 */

/**
 * Garante em runtime que o host expõe a superfície mínima de EventEmitter esperada pelo hot path.
 *
 * @template {object} T
 * @param {T | null | undefined} host
 * @param {string} [label='AgentHost'] Default is `'AgentHost'`
 * @returns {T & Required<Pick<AgentEventHost, 'on' | 'once' | 'off'>>}
 * @throws {SessionError}
 */
export function assertEmitterHost(host, label = 'AgentHost') {
    const maybeOn = host && (typeof host === 'object' || typeof host === 'function') ? Reflect.get(host, 'on') : null;
    const maybeOnce =
        host && (typeof host === 'object' || typeof host === 'function') ? Reflect.get(host, 'once') : null;
    const maybeOff = host && (typeof host === 'object' || typeof host === 'function') ? Reflect.get(host, 'off') : null;
    if (
        !host ||
        (typeof host !== 'object' && typeof host !== 'function') ||
        typeof maybeOn !== 'function' ||
        typeof maybeOnce !== 'function' ||
        typeof maybeOff !== 'function'
    ) {
        throw new SessionError(`[${label}] Host não implementa EventEmitter mínimo.`, 'INVALID_HOST');
    }
    return /** @type {T & Required<Pick<AgentEventHost, 'on' | 'once' | 'off'>>} */ (host);
}

/**
 * @param {unknown} value
 * @returns {value is Promise<unknown>}
 */
function isPromiseLike(value) {
    return (
        value !== null &&
        (typeof value === 'object' || typeof value === 'function') &&
        typeof Reflect.get(value, 'then') === 'function'
    );
}

/**
 * Aplica `setModel()` na sessão SDK ativa quando a capability existir.
 *
 * Mantém a compatibilidade com versões do SDK onde `setModel()` é opcional/privado sem espalhar casts estruturais pelo
 * codebase.
 *
 * @param {CopilotSession | null | undefined} session
 * @param {string} modelId
 * @param {string} [logLabel='AlwaysAlive'] Default is `'AlwaysAlive'`
 * @param {{ reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' | undefined }} [options]
 * @returns {boolean} `true` quando a sessão suportava troca de modelo e a chamada assíncrona foi disparada.
 */
export function trySetLiveSessionModel(session, modelId, logLabel = 'AlwaysAlive', options) {
    if (session === null || session === undefined || (typeof session !== 'object' && typeof session !== 'function')) {
        return false;
    }

    const maybeSetModel = Reflect.get(session, 'setModel');
    if (typeof maybeSetModel !== 'function') {
        return false;
    }

    try {
        const maybeResult = setSessionModel(
            /** @type {CopilotSession} */ (session),
            modelId,
            options?.reasoningEffort
                ? { reasoningEffort: /** @type {'low' | 'medium' | 'high'} */ (options.reasoningEffort) }
                : undefined,
        );
        if (isPromiseLike(maybeResult) === true) {
            void Promise.resolve(maybeResult).catch((error) => {
                log('WARN', `[${logLabel}] setModel live async falhou: ${toError(error).message}`);
            });
        }
        return true;
    } catch (error) {
        log('WARN', `[${logLabel}] setModel live falhou (SDK version?): ${toError(error).message}`);
        return false;
    }
}

/**
 * Normaliza payloads de `session.token_budget_warning` para shape canônico.
 *
 * @param {unknown} rawEvent
 * @returns {{ ratio: number; currentTokens: number; tokenLimit: number }}
 */
export function normalizeTokenBudgetWarning(rawEvent) {
    if (!rawEvent || typeof rawEvent !== 'object') {
        return { ratio: 0, currentTokens: 0, tokenLimit: 0 };
    }

    const ratio = Reflect.get(rawEvent, 'ratio');
    const currentTokens = Reflect.get(rawEvent, 'currentTokens');
    const tokenLimit = Reflect.get(rawEvent, 'tokenLimit');

    return {
        ratio: typeof ratio === 'number' ? ratio : 0,
        currentTokens: typeof currentTokens === 'number' ? currentTokens : 0,
        tokenLimit: typeof tokenLimit === 'number' ? tokenLimit : 0,
    };
}

/**
 * Normaliza payload de `session.compaction_complete`.
 *
 * @param {unknown} rawEvent
 * @returns {{ success: boolean }}
 */
export function normalizeCompactionComplete(rawEvent) {
    if (!rawEvent || typeof rawEvent !== 'object') {
        return { success: false };
    }

    const success = Reflect.get(rawEvent, 'success');
    return { success: success === true };
}
