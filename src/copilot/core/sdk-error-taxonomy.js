// @ts-check
/**
 * Taxonomia pura de falhas do Copilot SDK/runtime.
 *
 * Este módulo não importa SDK, presentation, terminal ou agent. Ele é o núcleo compartilhado para que bordas humanas e
 * decisões de retry/reconnect não mantenham regexes paralelas.
 *
 * @module copilot/core/sdk-error-taxonomy
 */

/** @typedef {'rate_limit' | 'quota_exhausted' | 'account' | 'auth' | 'model_unsupported' | 'network' | 'timeout' | 'unknown'} SdkErrorTaxonomyKind */
/** @typedef {'session' | 'weekly_model' | 'unknown'} SdkRateLimitTaxonomyScope */

const errorCtor = /** @type {{ isError?: (value: unknown) => boolean }} */ (Error);
const isError =
    typeof errorCtor.isError === 'function'
        ? /** @type {(value: unknown) => boolean} */ (errorCtor.isError.bind(Error))
        : /** @type {(value: unknown) => boolean} */ ((value) => value instanceof Error);

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
    if (isError(error)) {
        const err = /** @type {Error} */ (error);
        const raw = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (err));
        return {
            code: lower(raw['code']),
            errorType: lower(raw['errorType'] ?? raw['type']),
            message: lower(err.message),
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
 * Refina `rate_limit` sem mudar a categoria operacional principal.
 *
 * @param {unknown} error
 * @returns {SdkRateLimitTaxonomyScope}
 */
export function classifySdkRateLimitScope(error) {
    const fp = getSdkErrorFingerprint(error);
    const haystack = `${fp.code} ${fp.errorType} ${fp.message}`;

    if (
        haystack.includes('weekly') ||
        haystack.includes('7-day') ||
        haystack.includes('premium request') ||
        haystack.includes('premium requests') ||
        haystack.includes('auto model') ||
        haystack.includes('model choice') ||
        haystack.includes('model selection')
    ) {
        return 'weekly_model';
    }

    if (
        haystack.includes('session limit') ||
        haystack.includes('wait for your limit to reset') ||
        haystack.includes('wait until it resets') ||
        /\breset in \d+/.test(haystack) ||
        /\breset\s+(?:em|in)\s+\d+/.test(haystack)
    ) {
        return 'session';
    }

    return 'unknown';
}

/**
 * Classifica erros do SDK em categorias operacionais estaveis.
 *
 * @param {unknown} error
 * @returns {SdkErrorTaxonomyKind}
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
        fp.status === 402 ||
        haystack.includes('billing') ||
        haystack.includes('payment required') ||
        haystack.includes('payment method') ||
        haystack.includes('subscription') ||
        haystack.includes('account disabled') ||
        haystack.includes('account suspended') ||
        haystack.includes('account state') ||
        haystack.includes('copilot access') ||
        haystack.includes('not enabled for this account')
    ) {
        return 'account';
    }
    if (
        haystack.includes('unsupported model') ||
        haystack.includes('model unsupported') ||
        haystack.includes('model not supported') ||
        haystack.includes('model is not supported') ||
        haystack.includes('model not found') ||
        haystack.includes('unknown model') ||
        haystack.includes('invalid model') ||
        haystack.includes('does not support this model') ||
        haystack.includes('capability-unsupported')
    ) {
        return 'model_unsupported';
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
        ) ||
        haystack.includes('network error') ||
        haystack.includes('fetch failed') ||
        haystack.includes('socket hang up')
    ) {
        return 'network';
    }
    return 'unknown';
}
