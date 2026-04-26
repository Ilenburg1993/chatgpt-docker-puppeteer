// @ts-check
/**
 * @module copilot/sdk/errors
 * @file Classificacao pura de erros emitidos pelo GitHub Copilot SDK/CLI.
 *
 *   Este modulo fica na camada SDK porque descreve semantica do SDK, nao uma decisao de UX. O agent usa a classificacao
 *   para decidir reconnect/retry; terminal e server podem usa-la para apresentar mensagens limpas sem conhecer detalhes
 *   internos do agent.
 */

/** @typedef {'rate_limit' | 'quota_exhausted' | 'auth' | 'network' | 'timeout' | 'unknown'} SdkErrorKind */

/**
 * @param {unknown} value
 * @returns {string}
 */
function lower(value) {
    return typeof value === 'string' ? value.toLowerCase() : '';
}

/**
 * Extrai campos comuns de Error, SessionError, eventos SDK e objetos plain.
 *
 * @param {unknown} error
 * @returns {{ code: string; errorType: string; message: string; status: number | null }}
 */
export function getSdkErrorFingerprint(error) {
    if (error instanceof Error) {
        const raw = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (error));
        return {
            code: lower(raw['code']),
            errorType: lower(raw['errorType'] ?? raw['type']),
            message: lower(error.message),
            status: typeof raw['status'] === 'number' ? raw['status'] : null,
        };
    }
    if (typeof error === 'object' && error !== null) {
        const raw = /** @type {Record<string, unknown>} */ (error);
        return {
            code: lower(raw['code']),
            errorType: lower(raw['errorType'] ?? raw['type']),
            message: lower(raw['message'] ?? raw['error']),
            status: typeof raw['status'] === 'number' ? raw['status'] : null,
        };
    }
    return { code: '', errorType: '', message: lower(error), status: null };
}

/**
 * Classifica erros do SDK em categorias operacionais estaveis.
 *
 * @param {unknown} error
 * @returns {SdkErrorKind}
 */
export function classifySdkError(error) {
    const fp = getSdkErrorFingerprint(error);
    const haystack = `${fp.code} ${fp.errorType} ${fp.message}`;
    if (
        fp.status === 429 ||
        /\brate[_-]?limit\b/.test(haystack) ||
        haystack.includes('hit a rate limit') ||
        haystack.includes('too many requests')
    ) {
        return 'rate_limit';
    }
    if (
        haystack.includes('quota') ||
        haystack.includes('premium request') ||
        haystack.includes('premium requests') ||
        haystack.includes('usage limit') ||
        haystack.includes('limit exceeded')
    ) {
        return 'quota_exhausted';
    }
    if (
        haystack.includes('unauthorized') ||
        haystack.includes('forbidden') ||
        haystack.includes('authentication') ||
        haystack.includes('auth')
    ) {
        return 'auth';
    }
    if (haystack.includes('timeout') || fp.code === 'etimedout' || fp.code === 'time_out') {
        return 'timeout';
    }
    if (
        ['econnrefused', 'econnreset', 'epipe', 'eai_again', 'err_ipc_channel_closed', 'err_ipc_disconnected'].includes(
            fp.code,
        )
    ) {
        return 'network';
    }
    return 'unknown';
}

/**
 * Quota/rate-limit nao e recuperavel por reconnect local: reconnect consome mais requisicoes e piora a UX.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export function isSdkQuotaOrRateLimitError(error) {
    const kind = classifySdkError(error);
    return kind === 'rate_limit' || kind === 'quota_exhausted';
}

/**
 * Normaliza qualquer falha do SDK para `SdkOperationError` preservando a causa original.
 *
 * @param {string} operation
 * @param {unknown} error
 * @returns {SdkOperationError}
 */
export function toSdkOperationError(operation, error) {
    if (error instanceof SdkOperationError) {
        return error;
    }
    return new SdkOperationError(operation, classifySdkError(error), error);
}

// ─── SdkOperationError ───────────────────────────────────────────────────────

/**
 * Erro estruturado lançado por wrappers SDK quando uma operação falha. Inclui a operação, o kind classificado e a causa
 * original para rastreabilidade completa.
 *
 * @example
 *     throw new SdkOperationError('model.switchTo', classifySdkError(err), err);
 */
export class SdkOperationError extends Error {
    /**
     * @param {string} operation - Nome canônico da operação (ex: `'model.switchTo'`)
     * @param {SdkErrorKind} kind - Kind classificado via `classifySdkError`
     * @param {unknown} [cause] - Erro original do SDK
     */
    constructor(operation, kind, cause) {
        const causeMsg = cause instanceof Error ? cause.message : String(cause ?? '');
        super(`[sdk/${operation}] falhou (${kind}): ${causeMsg}`);
        this.name = 'SdkOperationError';
        /** @type {string} */
        this.operation = operation;
        /** @type {SdkErrorKind} */
        this.kind = kind;
        /** @type {unknown} */
        this.cause = cause;
    }
}
