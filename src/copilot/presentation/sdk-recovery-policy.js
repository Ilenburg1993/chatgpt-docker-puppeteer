// @ts-check
/**
 * src/copilot/presentation/sdk-recovery-policy.js
 *
 * Classificação estrutural de erros do runtime SDK para bordas locais. Mantém `terminal/` sem dependência direta da SDK
 * layer; a semântica é intencionalmente estável e espelha as categorias operacionais públicas.
 *
 * @module copilot/presentation/sdk-recovery-policy
 */

/** @typedef {'rate_limit' | 'quota_exhausted' | 'auth' | 'network' | 'timeout' | 'unknown'} RuntimeSdkErrorKind */
/** @typedef {'connection' | 'session'} RuntimeSdkRecoveryScope */

/**
 * @typedef {{
 *     kind: RuntimeSdkErrorKind;
 *     scope: RuntimeSdkRecoveryScope;
 *     retryable: boolean;
 *     allowReconnect: boolean;
 *     tripCircuit: boolean;
 *     resetCircuit: boolean;
 *     backoffMs: number;
 *     reason: string;
 * }} RuntimeSdkRecoveryPolicy
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
function lower(value) {
    return typeof value === 'string' ? value.toLowerCase() : '';
}

/**
 * @param {unknown} error
 * @returns {{ code: string; errorType: string; message: string; status: number | null }}
 */
function getRuntimeSdkErrorFingerprint(error) {
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
 * @param {unknown} error
 * @returns {RuntimeSdkErrorKind}
 */
export function classifyRuntimeSdkError(error) {
    const fp = getRuntimeSdkErrorFingerprint(error);
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
 * @param {unknown} error
 * @param {RuntimeSdkRecoveryScope} [scope='connection'] Default is `'connection'`
 * @returns {RuntimeSdkRecoveryPolicy}
 */
export function getSdkRecoveryPolicy(error, scope = 'connection') {
    const kind = classifyRuntimeSdkError(error);
    switch (kind) {
        case 'rate_limit':
            return {
                kind,
                scope,
                retryable: false,
                allowReconnect: false,
                tripCircuit: false,
                resetCircuit: true,
                backoffMs: 0,
                reason: 'rate limit do SDK não deve abrir circuito local nem disparar reconnect automático',
            };
        case 'quota_exhausted':
            return {
                kind,
                scope,
                retryable: false,
                allowReconnect: false,
                tripCircuit: false,
                resetCircuit: true,
                backoffMs: 0,
                reason: 'quota esgotada exige intervenção externa; reconnect local só piora a UX',
            };
        case 'auth':
            return {
                kind,
                scope,
                retryable: false,
                allowReconnect: false,
                tripCircuit: false,
                resetCircuit: true,
                backoffMs: 0,
                reason: 'falha de autenticação não representa indisponibilidade do transporte',
            };
        case 'timeout':
            return {
                kind,
                scope,
                retryable: true,
                allowReconnect: true,
                tripCircuit: true,
                resetCircuit: false,
                backoffMs: scope === 'connection' ? 1_500 : 1_000,
                reason: 'timeout é tratado como falha transitória e deve alimentar backoff/circuit breaker',
            };
        case 'network':
            return {
                kind,
                scope,
                retryable: true,
                allowReconnect: true,
                tripCircuit: true,
                resetCircuit: false,
                backoffMs: scope === 'connection' ? 1_000 : 750,
                reason: 'falha de rede é transitória e deve contribuir para abrir o circuito',
            };
        case 'unknown':
        default:
            return {
                kind,
                scope,
                retryable: scope === 'connection',
                allowReconnect: scope === 'connection',
                tripCircuit: scope === 'connection',
                resetCircuit: false,
                backoffMs: scope === 'connection' ? 750 : 0,
                reason:
                    scope === 'connection'
                        ? 'falha desconhecida de conexão é tratada conservadoramente como transitória'
                        : 'falha desconhecida fora da conexão não recebe reconnect automático por padrão',
            };
    }
}
