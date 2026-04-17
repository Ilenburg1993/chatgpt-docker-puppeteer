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
