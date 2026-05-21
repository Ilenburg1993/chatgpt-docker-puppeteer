// @ts-check
/**
 * Taxonomia terminal de falhas externas BYOK.
 *
 * O SDK pode entregar o mesmo bloqueio do provider por caminhos distintos: throw do `sendTurn`, `session.error` ou
 * resultado de uma probe descartavel. A UX nao deve fazer cada borda adivinhar sozinha se um `402`, `429`, credencial
 * ou modelo ausente e um problema local. Este modulo preserva a mensagem original para auditoria e fornece a leitura
 * operacional comum usada por probe, turno vivo e erro de sessao.
 *
 * @module copilot/terminal/byok/provider-failure
 */

import { toError } from '#copilot/core';

/**
 * @typedef {'credits' | 'rate-limit' | 'auth' | 'model-or-route' | 'timeout' | 'network' | 'upstream' | 'unknown'} TerminalByokProviderFailureKind
 */

/**
 * @typedef {object} TerminalByokProviderFailure
 * @property {TerminalByokProviderFailureKind} kind
 * @property {string} message
 * @property {number | null} statusCode
 * @property {string} errorContext
 * @property {string} operatorLabel
 * @property {string} operatorAction
 * @property {boolean} external
 */

/**
 * @param {unknown} error
 * @returns {number | null}
 */
function readStructuredStatusCode(error) {
    if (!error || typeof error !== 'object') return null;
    const record = /** @type {Record<string, unknown>} */ (error);
    const candidates = [record['status'], record['statusCode'], record['responseStatus'], record['httpStatus']];
    for (const candidate of candidates) {
        if (typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 100 && candidate <= 599) {
            return candidate;
        }
    }
    return null;
}

/**
 * @param {string} message
 * @returns {number | null}
 */
function readMessageStatusCode(message) {
    const explicit = message.match(
        /\b(?:http\s*|status(?:\s+code)?\s*[:=]?\s*|response\s+status\s*[:=]?\s*)([1-5]\d{2})\b/iu,
    );
    if (explicit) return Number(explicit[1]);
    const leading = message.match(/^\s*([1-5]\d{2})\b/u);
    return leading ? Number(leading[1]) : null;
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function readFailureCode(error) {
    if (!error || typeof error !== 'object') return '';
    const code = Reflect.get(error, 'code');
    return typeof code === 'string' || typeof code === 'number' ? String(code) : '';
}

/**
 * @param {string} message
 * @returns {boolean}
 */
function textLooksLikeCreditsFailure(message) {
    return /\b(add credits?|credit(?:s)?\s+(?:required|exhausted|needed)|payment required|insufficient (?:balance|credits?|funds)|balance (?:is )?(?:zero|exhausted)|quota\/saldo|saldo)\b/iu.test(
        message,
    );
}

/**
 * @param {string} message
 * @returns {boolean}
 */
function textLooksLikeAuthFailure(message) {
    return /\b(unauthori[sz]ed|forbidden|invalid api key|api key invalid|authentication|credential|permission denied)\b/iu.test(
        message,
    );
}

/**
 * @param {string} message
 * @returns {boolean}
 */
function textLooksLikeRateLimitFailure(message) {
    return /\b(rate limit|rate-limit|too many requests|requests? per minute|tokens? per minute)\b/iu.test(message);
}

/**
 * @param {string} message
 * @returns {boolean}
 */
function textLooksLikeTimeoutFailure(message) {
    return /\b(timeout|timed out|sem progresso|inactivity)\b/iu.test(message);
}

/**
 * @param {string} message
 * @param {string} code
 * @returns {boolean}
 */
function textLooksLikeNetworkFailure(message, code) {
    return (
        /\b(connection error|fetch failed|network|socket|econn(?:reset|refused)|etimedout|dns)\b/iu.test(message) ||
        /^(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT)$/u.test(code)
    );
}

/**
 * @param {TerminalByokProviderFailureKind} kind
 * @param {number | null} statusCode
 * @param {string} message
 * @returns {TerminalByokProviderFailure}
 */
function buildFailure(kind, statusCode, message) {
    const http = statusCode ? `HTTP ${statusCode}` : null;
    switch (kind) {
        case 'credits':
            return {
                kind,
                message,
                statusCode,
                errorContext: 'provider.credits',
                operatorLabel: `provider BYOK recusou a chamada por credito, saldo ou cota${http ? ` (${http})` : ''}`,
                operatorAction:
                    'troque para modelo/perfil free ou com credito, revise a cota do provider e rode /byok probe agent antes da sessao viva',
                external: true,
            };
        case 'rate-limit':
            return {
                kind,
                message,
                statusCode,
                errorContext: 'provider.rate_limit',
                operatorLabel: `provider BYOK aplicou rate limit${http ? ` (${http})` : ''}`,
                operatorAction:
                    'aguarde a janela do provider, use modelo/perfil com limite maior ou reduza o contexto antes de nova probe',
                external: true,
            };
        case 'auth':
            return {
                kind,
                message,
                statusCode,
                errorContext: 'provider.auth',
                operatorLabel: `provider BYOK rejeitou autenticacao ou permissao${http ? ` (${http})` : ''}`,
                operatorAction:
                    'revise a credencial e o endpoint em .env.local, rode /byok reload e valide com /byok probe agent',
                external: true,
            };
        case 'model-or-route':
            return {
                kind,
                message,
                statusCode,
                errorContext: 'provider.model_or_route',
                operatorLabel: `provider BYOK nao encontrou modelo ou rota configurada${http ? ` (${http})` : ''}`,
                operatorAction:
                    'confira /byok models refresh, selecione o modelo explicitamente e probe o candidato antes do live',
                external: true,
            };
        case 'timeout':
            return {
                kind,
                message,
                statusCode,
                errorContext: 'provider.timeout',
                operatorLabel: `provider BYOK ficou sem resposta dentro da janela esperada${http ? ` (${http})` : ''}`,
                operatorAction:
                    'inspecione /byok health, tente modelo/provider alternativo e preserve contexto pequeno para isolar latencia',
                external: true,
            };
        case 'network':
            return {
                kind,
                message,
                statusCode,
                errorContext: 'provider.network',
                operatorLabel: `falha de rede ao falar com provider BYOK${http ? ` (${http})` : ''}`,
                operatorAction:
                    'verifique conectividade/baseUrl do provider e repita a probe descartavel antes de abrir turno vivo',
                external: true,
            };
        case 'upstream':
            return {
                kind,
                message,
                statusCode,
                errorContext: 'provider.upstream',
                operatorLabel: `provider BYOK retornou falha upstream${http ? ` (${http})` : ''}`,
                operatorAction:
                    'tente novamente ou troque modelo/provider; use /byok health para separar instabilidade de configuracao',
                external: true,
            };
        default:
            return {
                kind: 'unknown',
                message,
                statusCode,
                errorContext: 'provider.unknown',
                operatorLabel: `falha BYOK ainda sem classe operacional${http ? ` (${http})` : ''}`,
                operatorAction:
                    'inspecione /byok health e /errors; se repetir, valide o mesmo provider com /byok probe agent',
                external: true,
            };
    }
}

/**
 * Classifica um erro visto na fronteira BYOK. A funcao nao decide sozinha se a falha veio do provider; quem chama deve
 * usa-la apenas dentro de fluxo BYOK ou combinar seu resultado com evidencias de runtime.
 *
 * @param {unknown} error
 * @returns {TerminalByokProviderFailure}
 */
export function classifyTerminalByokProviderFailure(error) {
    const err = toError(error);
    const message = err.message || 'erro BYOK sem mensagem';
    const statusCode = readStructuredStatusCode(error) ?? readMessageStatusCode(message);
    const code = readFailureCode(error);
    if (statusCode === 402 || textLooksLikeCreditsFailure(message)) {
        return buildFailure('credits', statusCode, message);
    }
    if (statusCode === 429 || textLooksLikeRateLimitFailure(message)) {
        return buildFailure('rate-limit', statusCode, message);
    }
    if (statusCode === 401 || statusCode === 403 || textLooksLikeAuthFailure(message)) {
        return buildFailure('auth', statusCode, message);
    }
    if (statusCode === 404) {
        return buildFailure('model-or-route', statusCode, message);
    }
    if (textLooksLikeTimeoutFailure(message)) {
        return buildFailure('timeout', statusCode, message);
    }
    if (textLooksLikeNetworkFailure(message, code)) {
        return buildFailure('network', statusCode, message);
    }
    if (statusCode !== null && statusCode >= 500) {
        return buildFailure('upstream', statusCode, message);
    }
    return buildFailure('unknown', statusCode, message);
}
