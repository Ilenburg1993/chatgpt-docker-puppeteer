// @ts-check
/**
 * src/copilot/presentation/sdk/recovery-policy.js
 *
 * Classificação estrutural de erros do runtime SDK para bordas locais. Mantém `terminal/` sem dependência direta da SDK
 * layer; a semântica é intencionalmente estável e espelha as categorias operacionais públicas.
 *
 * @module copilot/presentation/sdk-recovery-policy
 */

import {
    classifySdkError as classifyCoreSdkError,
    classifySdkRateLimitScope as classifyCoreSdkRateLimitScope,
} from '#copilot/core';

/** @typedef {'rate_limit' | 'quota_exhausted' | 'account' | 'auth' | 'model_unsupported' | 'network' | 'timeout' | 'unknown'} RuntimeSdkErrorKind */
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
 * Diferencia os dois limites públicos do Copilot:
 *
 * - limite de sessão: precisa aguardar reset;
 * - limite semanal/modelo: pode, quando o próprio SDK permitir, ser mitigado pela seleção Auto sem assumir uma unidade
 *   request-based de billing.
 *
 * Mantém `kind='rate_limit'` estável para retry/reconnect, mas permite uma UX mais correta.
 *
 * @param {unknown} error
 * @returns {RuntimeSdkRateLimitScope}
 */
export function classifyRuntimeSdkRateLimitScope(error) {
    return classifyCoreSdkRateLimitScope(error);
}

/**
 * @param {unknown} error
 * @returns {RuntimeSdkErrorKind}
 */
export function classifyRuntimeSdkError(error) {
    return classifyCoreSdkError(error);
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
        case 'account':
            return {
                kind,
                scope,
                retryable: false,
                allowReconnect: false,
                tripCircuit: false,
                resetCircuit: true,
                backoffMs: 0,
                reason: 'estado de conta/cobrança bloqueou o SDK; reconnect local não altera o bloqueio externo',
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
        case 'model_unsupported':
            return {
                kind,
                scope,
                retryable: false,
                allowReconnect: false,
                tripCircuit: false,
                resetCircuit: true,
                backoffMs: 0,
                reason: 'modelo ou capacidade não suportada exige troca de modelo, não reconnect do runtime',
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
    const message = error instanceof Error
        ? /** @type {Error} */ (error).message
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
        case 'account':
            return {
                label: '[sdk conta]',
                headline: message,
                detail: 'Conta, cobrança ou assinatura bloqueou a chamada do SDK; o runtime local continua saudável.',
                actionHint: 'Revise autenticação, assinatura/quota da conta e depois use /restart.',
            };
        case 'model_unsupported':
            return {
                label: '[sdk modelo]',
                headline: message,
                detail: 'O modelo ou uma capacidade solicitada não é aceito pelo SDK/provider atual.',
                actionHint: 'Troque para /model auto ou selecione um modelo compatível com /model <id> e use /restart.',
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
