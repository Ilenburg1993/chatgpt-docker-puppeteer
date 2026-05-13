// @ts-check
/**
 * src/copilot/presentation/sdk/recovery-policy.js
 *
 * Classificação estrutural de erros do runtime SDK para bordas locais. Mantém `terminal/` sem dependência direta da SDK
 * layer; a semântica é intencionalmente estável e espelha as categorias operacionais públicas.
 *
 * @module copilot/presentation/sdk-recovery-policy
 */

/** @typedef {'rate_limit' | 'quota_exhausted' | 'auth' | 'network' | 'timeout' | 'unknown'} RuntimeSdkErrorKind */
/** @typedef {'connection' | 'session'} RuntimeSdkRecoveryScope */
/** @typedef {'session' | 'weekly_model' | 'unknown'} RuntimeSdkRateLimitScope */

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
 *
 *
 * @typedef {{
 *     label: string;
 *     headline: string;
 *     detail: string;
 *     actionHint: string;
 * }} RuntimeSdkRecoveryMessage
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
 * Diferencia os dois limites públicos do Copilot:
 *
 * - limite de sessão: precisa aguardar reset;
 * - limite semanal/modelo: pode ser mitigado com seleção Auto quando a conta ainda tem premium requests.
 *
 * Mantém `kind='rate_limit'` estável para retry/reconnect, mas permite uma UX mais correta.
 *
 * @param {unknown} error
 * @returns {RuntimeSdkRateLimitScope}
 */
export function classifyRuntimeSdkRateLimitScope(error) {
    const fp = getRuntimeSdkErrorFingerprint(error);
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

/**
 * Monta uma mensagem operacional para bordas humanas do runtime local.
 *
 * A mensagem separa falhas do processo local de bloqueios externos do SDK. Rate limit/quota/auth não devem ser
 * mascarados como boot quebrado, nem alimentar reconexão automática.
 *
 * @param {RuntimeSdkRecoveryPolicy} policy
 * @param {unknown} error
 * @returns {RuntimeSdkRecoveryMessage}
 */
export function describeSdkRecoveryPolicy(policy, error) {
    const message =
        error instanceof Error
            ? error.message
            : typeof error === 'object' && error !== null
              ? String(/** @type {Record<string, unknown>} */ (error)['message'] ?? error)
              : String(error);
    switch (policy.kind) {
        case 'auth':
            return {
                label: '[sdk auth]',
                headline: message,
                detail: 'Autenticação do SDK bloqueou o dialog loop; o host local continua vivo.',
                actionHint: 'Reautentique o Copilot/GitHub e use /restart para tentar novamente.',
            };
        case 'rate_limit':
            if (classifyRuntimeSdkRateLimitScope(error) === 'session') {
                return {
                    label: '[sdk quota]',
                    headline: message,
                    detail: 'Limite de sessão do SDK bloqueou o turno; terminal, HTTP, status e comandos locais seguem disponíveis.',
                    actionHint:
                        'Aguarde o reset indicado pelo SDK; /model auto não contorna limite de sessão ativo. Depois do reset, use /restart.',
                };
            }
            if (classifyRuntimeSdkRateLimitScope(error) === 'weekly_model') {
                return {
                    label: '[sdk quota]',
                    headline: message,
                    detail: 'Limite semanal/modelo do SDK bloqueou o turno; terminal e host local continuam vivos e podem trocar a seleção de modelo.',
                    actionHint:
                        'Use /model auto seguido de /restart para delegar a seleção ao Copilot, ou aguarde o reset semanal se precisar de escolha manual.',
                };
            }
            return {
                label: '[sdk quota]',
                headline: message,
                detail: 'Rate limit do SDK bloqueou o turno; terminal, HTTP, status e comandos locais seguem disponíveis.',
                actionHint:
                    'Se a mensagem indicar limite semanal/modelo, use /model auto seguido de /restart; se indicar reset de sessão, aguarde o reset.',
            };
        case 'quota_exhausted':
            return {
                label: '[sdk quota]',
                headline: message,
                detail: 'Quota do SDK esgotada; reconnect automático foi desativado para evitar consumo repetido de PRs.',
                actionHint:
                    'Aguarde o reset da quota, altere o modelo com /model <id> ou use /model auto e depois /restart.',
            };
        case 'timeout':
        case 'network':
            return {
                label: '[sdk rede]',
                headline: message,
                detail: 'Falha transitória do SDK; a política permite retry/backoff local.',
                actionHint: 'Se persistir, verifique conectividade e use /restart.',
            };
        case 'unknown':
        default:
            return {
                label: '[sdk]',
                headline: message,
                detail: 'Erro não classificado do SDK.',
                actionHint: 'Use /status, /errors e /restart após revisar o erro.',
            };
    }
}
