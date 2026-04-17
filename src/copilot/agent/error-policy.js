// @ts-check
/**
 * @module copilot/agent/error-policy
 * @file Classificação central de erros do subsistema `agent`.
 *
 *   Primeira entrega incremental do K3. A meta aqui é parar de espalhar heurísticas de erro por `messaging` e
 *   `reconnect-policy`, concentrando a decisão em um ponto único e facilmente testável.
 * @see EventBus
 */

import { isFatalError, toError } from '#copilot/core';

/** @typedef {'retry' | 'fatal' | 'ignore'} AgentErrorDisposition */

/** @template T @typedef {T | Promise<T>} Awaitable */

/**
 * @template T
 * @typedef {{ ok: true; value: T }} AgentPolicySuccess
 */

/**
 * @typedef {{ ok: false; error: Error; disposition: AgentErrorDisposition }} AgentPolicyFailure
 */

/**
 * @template T
 * @typedef {AgentPolicySuccess<T> | AgentPolicyFailure} AgentPolicyResult
 */

/**
 * Classifica um erro do subsistema `agent` em três categorias operacionais:
 *
 * - `ignore`: não tentar reconexão nem retry automático
 * - `fatal`: encerrar o fluxo atual sem retry transparente
 * - `retry`: elegível para retry/reconexão
 *
 * Nesta fase incremental, a política preserva a semântica já praticada no runtime:
 *
 * - `AbortError` → `ignore`
 * - erros fatais já reconhecidos por `#copilot/core` → `fatal`
 * - todo o resto → `retry`
 *
 * @param {unknown} error
 * @returns {AgentErrorDisposition}
 */
export function classifyAgentError(error) {
    const normalized = toError(error);
    if (normalized instanceof DOMException && normalized.name === 'AbortError') {
        return 'ignore';
    }
    if (isFatalError(normalized)) {
        return 'fatal';
    }
    return 'retry';
}

/**
 * Helper semântico para os pontos em que o runtime só precisa saber se deve tentar retry/reconexão.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export function shouldRetryAgentError(error) {
    return classifyAgentError(error) === 'retry';
}

/**
 * Executa uma operação síncrona ou assíncrona sob a política canônica de classificação de erros do `agent`.
 *
 * Diferente de um `try/catch` ad hoc, esta função sempre normaliza o erro, aplica a classificação centralizada e
 * devolve um resultado explícito (`ok=true|false`). Isso permite que `messaging`, `reconnect-policy` e futuros módulos
 * compartilhem a mesma semântica sem duplicar boilerplate.
 *
 * @template T
 * @param {() => Awaitable<T>} fn
 * @param {{
 *     classify?: (error: unknown) => AgentErrorDisposition;
 *     onError?: (error: Error, disposition: AgentErrorDisposition) => void | Promise<void>;
 * }} [opts]
 * @returns {Promise<AgentPolicyResult<T>>}
 */
export async function withAgentErrorPolicy(fn, opts = {}) {
    const classify = opts.classify ?? classifyAgentError;
    try {
        return { ok: true, value: await Promise.resolve(fn()) };
    } catch (error) {
        const normalized = toError(error);
        const disposition = classify(normalized);
        await opts.onError?.(normalized, disposition);
        return { ok: false, error: normalized, disposition };
    }
}
