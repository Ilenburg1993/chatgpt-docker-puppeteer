// @ts-check
/**
 * src/copilot/sdk/session/model-switch-verify-retry.js
 *
 * Helper para verificação de model switch com retry + timeout cap.
 *
 * **Fase 3.2 Optimization #1**: Implementa retry com exponential backoff e timeout cap de 500ms para evitar waits
 * indefinidos.
 *
 * @module copilot/sdk/session/model-switch-verify-retry
 */

/**
 * @typedef {object} ModelSwitchRetryConfig
 * @property {number} maxRetries - Max tentativas
 * @property {number} pollDelayMs - Delay inicial em ms
 * @property {number} totalTimeoutMs - Timeout máximo em ms
 */

/**
 * @typedef {object} VerifyResult
 * @property {boolean} ok - true se verificação passou
 * @property {number} retries - Número de tentativas realizadas
 * @property {boolean} timedOut - true se atingiu timeout cap
 */

const DEFAULT_CONFIG = Object.freeze({
    maxRetries: 3,
    pollDelayMs: 100,
    totalTimeoutMs: 500,
});

/**
 * Aguarda o tempo especificado em ms.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
async function waitMs(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Verifica model switch com retry + timeout cap.
 *
 * Executa predicado (função de verificação) até 3 vezes com backoff exponencial, respeitando timeout máximo de 500ms.
 * Retorna resultado com número de tentativas e status de timeout.
 *
 * @example
 *     const result = await verifyModelSwitchWithRetry(
 *         async () => {
 *             const current = await modelGetCurrent(session);
 *             return current.modelId === 'gpt-4-turbo';
 *         },
 *         { maxRetries: 3, pollDelayMs: 100, totalTimeoutMs: 500 },
 *     );
 *
 * @param {() => Promise<boolean>} predicateFn - Função que valida switch (true=sucesso)
 * @param {Partial<ModelSwitchRetryConfig>} [config]
 * @returns {Promise<VerifyResult>}
 */
export async function verifyModelSwitchWithRetry(predicateFn, config = {}) {
    if (typeof predicateFn !== 'function') {
        throw new TypeError('[model-switch-verify-retry] predicateFn deve ser função.');
    }

    const cfg = /** @type {ModelSwitchRetryConfig} */ (Object.freeze({ ...DEFAULT_CONFIG, ...config }));
    const startTime = Date.now();

    return verifyInternal(predicateFn, cfg, startTime, 0);
}

/**
 * Retry recursivo com timeout cap.
 *
 * @private
 * @param {() => Promise<boolean>} predicateFn
 * @param {ModelSwitchRetryConfig} cfg
 * @param {number} startTime
 * @param {number} retryCount
 * @returns {Promise<VerifyResult>}
 */
async function verifyInternal(predicateFn, cfg, startTime, retryCount) {
    // Executar predicado
    let predicateOk = false;
    try {
        predicateOk = await predicateFn();
    } catch {
        // Se predicado falha com erro, trata como false (não ok)
        // predicateOk já é false por padrão, sem need reassign
    }

    // Se passou, retornar sucesso
    if (predicateOk) {
        return {
            ok: true,
            retries: retryCount,
            timedOut: false,
        };
    }

    // Calcular tempo decorrido e remanescente
    const elapsedMs = Date.now() - startTime;
    const remainingMs = cfg.totalTimeoutMs - elapsedMs;

    // Se há retry disponível E tempo remanescente, fazer retry
    if (retryCount < cfg.maxRetries && remainingMs > 50) {
        // Exponential backoff: 100ms × (1 + retryCount)
        // Retry 0: 100ms, Retry 1: 200ms, Retry 2: 300ms
        const delay = cfg.pollDelayMs * (1 + retryCount);
        await waitMs(delay);
        return verifyInternal(predicateFn, cfg, startTime, retryCount + 1);
    }

    // Timeout atingido ou max retries
    const timedOut = remainingMs <= 0;
    return {
        ok: false,
        retries: retryCount,
        timedOut,
    };
}
