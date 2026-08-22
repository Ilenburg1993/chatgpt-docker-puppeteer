// @ts-check
/**
 * Taxonomia operacional de falhas externas BYOK.
 *
 * O SDK pode entregar o mesmo bloqueio do provider por caminhos distintos: throw do `sendTurn`, `session.error` ou
 * resultado de uma probe descartavel. Cada borda consumidora deve receber a mesma leitura operacional para `402`,
 * `429`, credencial invalida, modelo ausente, timeout e falhas de rede. Este modulo preserva a mensagem original para
 * auditoria e fornece a taxonomia comum usada por probes, turnos vivos, erro de sessao e health.
 *
 * @module copilot/model-gateway/health/provider-failure
 */

import { toError } from '#copilot/core/error-handlers';

/**
 * @typedef {'credits'
 *     | 'rate-limit'
 *     | 'auth'
 *     | 'model-or-route'
 *     | 'capability-unsupported'
 *     | 'invalid-request'
 *     | 'timeout'
 *     | 'network'
 *     | 'upstream'
 *     | 'unknown'} ByokProviderFailureKind
 */

/**
 * @typedef {object} ByokProviderFailure
 * @property {ByokProviderFailureKind} kind
 * @property {string} message
 * @property {number | null} statusCode
 * @property {string} errorContext
 * @property {string} operatorLabel
 * @property {string} operatorAction
 * @property {boolean} external
 * @property {number | null} retryAfterSeconds
 * @property {string | null} resetAt
 * @property {Record<string, string | number>} limitHeaders
 */

const BYOK_PROVIDER_FAILURE_KINDS = new Set([
    'credits',
    'rate-limit',
    'auth',
    'model-or-route',
    'capability-unsupported',
    'invalid-request',
    'timeout',
    'network',
    'upstream',
    'unknown',
]);

/**
 * Validates an already-classified provider failure, e.g. one read back from SQLite/JSON.
 *
 * @param {unknown} value
 * @returns {value is ByokProviderFailure}
 */
export function isByokProviderFailure(value) {
    if (!isRecord(value)) return false;
    if (typeof value['kind'] !== 'string' || !BYOK_PROVIDER_FAILURE_KINDS.has(value['kind'])) return false;
    if (typeof value['message'] !== 'string') return false;
    if (value['statusCode'] !== null && typeof value['statusCode'] !== 'number') return false;
    if (typeof value['errorContext'] !== 'string') return false;
    if (typeof value['operatorLabel'] !== 'string') return false;
    if (typeof value['operatorAction'] !== 'string') return false;
    if (typeof value['external'] !== 'boolean') return false;
    if (value['retryAfterSeconds'] !== null && typeof value['retryAfterSeconds'] !== 'number') return false;
    if (value['resetAt'] !== null && typeof value['resetAt'] !== 'string') return false;
    if (!isRecord(value['limitHeaders'])) return false;
    return Object.values(value['limitHeaders']).every((item) => typeof item === 'string' || typeof item === 'number');
}

/**
 * @param {unknown} error
 * @returns {number | null}
 */
function readStructuredStatusCode(error) {
    if (!error || typeof error !== 'object') return null;
    const record = /** @type {Record<string, unknown>} */ (error);
    const response =
        record['response'] && typeof record['response'] === 'object'
            ? /** @type {Record<string, unknown>} */ (record['response'])
            : {};
    const candidates = [
        record['status'],
        record['statusCode'],
        record['responseStatus'],
        record['httpStatus'],
        response['status'],
        response['statusCode'],
    ];
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
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function stringValue(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function finiteNumber(value) {
    const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
    return Number.isFinite(number) ? number : null;
}

/**
 * @param {string} value
 * @returns {number | null}
 */
function parseRetryAfterSeconds(value) {
    const seconds = Number(value.trim());
    if (Number.isFinite(seconds)) return Math.max(0, seconds);
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? Math.max(0, Math.ceil((date.getTime() - Date.now()) / 1000)) : null;
}

/**
 * @param {string} value
 * @returns {number | null}
 */
function parseDurationSeconds(value) {
    const trimmed = value.trim();
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) return Math.max(0, numeric);
    const match = trimmed.match(/^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?$/iu);
    if (!match) return null;
    const hours = Number(match[1] ?? 0);
    const minutes = Number(match[2] ?? 0);
    const seconds = Number(match[3] ?? 0);
    const total = hours * 3600 + minutes * 60 + seconds;
    return Number.isFinite(total) && total >= 0 ? total : null;
}

/**
 * Rate-limit reset headers are not standardized across providers: some send ISO timestamps, some send Unix epoch
 * seconds or milliseconds, and others send a relative duration. Prefer absolute timestamps when the numeric value is
 * clearly epoch-shaped; otherwise treat small numbers as relative seconds.
 *
 * @param {string} value
 * @returns {string | null}
 */
function parseResetHeaderAt(value) {
    const trimmed = value.trim();
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric) && numeric >= 0) {
        if (numeric >= 1_000_000_000_000) return new Date(numeric).toISOString();
        if (numeric >= 1_000_000_000) return new Date(numeric * 1000).toISOString();
        return new Date(Date.now() + numeric * 1000).toISOString();
    }
    const date = new Date(trimmed);
    if (Number.isFinite(date.getTime())) return date.toISOString();
    const seconds = parseDurationSeconds(trimmed);
    return seconds !== null ? new Date(Date.now() + seconds * 1000).toISOString() : null;
}

/**
 * @param {unknown} headers
 * @param {string} name
 * @returns {string | null}
 */
function readHeader(headers, name) {
    if (!headers) return null;
    const lower = name.toLowerCase();
    const getter = Reflect.get(Object(headers), 'get');
    if (typeof getter === 'function') {
        const value = getter.call(headers, name) ?? getter.call(headers, lower);
        return stringValue(value);
    }
    if (!isRecord(headers)) return null;
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === lower)
            return stringValue(value) ?? (typeof value === 'number' ? String(value) : null);
    }
    return null;
}

/**
 * @param {unknown} error
 * @returns {unknown[]}
 */
function readHeaderSources(error) {
    if (!isRecord(error)) return [];
    const response = isRecord(error['response']) ? error['response'] : {};
    const cause = isRecord(error['cause']) ? error['cause'] : {};
    return [error['headers'], response['headers'], cause['headers']].filter(Boolean);
}

/**
 * @param {unknown} error
 * @param {string} message
 * @returns {{
 *     retryAfterSeconds: number | null;
 *     resetAt: string | null;
 *     limitHeaders: Record<string, string | number>;
 * }}
 */
function readLimitHints(error, message) {
    const limitHeaders = /** @type {Record<string, string | number>} */ ({});
    const headerSources = readHeaderSources(error);
    const headerNames = [
        'retry-after',
        'x-ratelimit-reset',
        'x-ratelimit-reset-requests',
        'x-ratelimit-reset-tokens',
        'x-ratelimit-remaining-requests',
        'x-ratelimit-remaining-tokens',
        'anthropic-ratelimit-requests-reset',
        'anthropic-ratelimit-tokens-reset',
        'anthropic-ratelimit-input-tokens-reset',
        'anthropic-ratelimit-output-tokens-reset',
    ];
    for (const headers of headerSources) {
        for (const name of headerNames) {
            const value = readHeader(headers, name);
            if (value !== null) limitHeaders[name] = finiteNumber(value) ?? value;
        }
    }
    const retryHeader = headerSources
        .map((headers) => readHeader(headers, 'retry-after'))
        .find((value) => value !== null);
    const retryAfterSeconds =
        retryHeader !== undefined && retryHeader !== null
            ? parseRetryAfterSeconds(retryHeader)
            : (() => {
                  const match = message.match(
                      /\b(?:retry(?:\s+after)?|try again in)\s+(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m)\b/iu,
                  );
                  if (!match) return null;
                  const value = Number(match[1]);
                  return /m(?:in(?:ute)?s?)?/iu.test(match[2] ?? 's') ? value * 60 : value;
              })();
    const resetHeader = headerSources
        .flatMap((headers) =>
            ['x-ratelimit-reset', 'x-ratelimit-reset-requests', 'x-ratelimit-reset-tokens'].map((name) =>
                readHeader(headers, name),
            ),
        )
        .find((value) => value !== null);
    const resetFromHeader = resetHeader !== undefined && resetHeader !== null ? parseResetHeaderAt(resetHeader) : null;
    return {
        retryAfterSeconds,
        resetAt:
            resetFromHeader ??
            (retryAfterSeconds !== null && retryAfterSeconds > 0
                ? new Date(Date.now() + retryAfterSeconds * 1000).toISOString()
                : null),
        limitHeaders,
    };
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
    return /\b(unauthori[sz]ed|forbidden|invalid api key|api key (?:invalid|expired|disabled)|authentication|credential|permission denied)\b/iu.test(
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
 * @param {string} message
 * @returns {boolean}
 */
function textLooksLikeModelOrRouteFailure(message) {
    return /\b(?:invalid|unknown|missing|unavailable|unsupported|not found|does not exist|doesn't exist|no such)\s+(?:model|deployment|route)\b|\b(?:model|deployment|route)\b[^\n]{0,80}\b(?:not found|does not exist|doesn't exist|is unavailable|is invalid)\b/iu.test(
        message,
    );
}

/**
 * @param {string} message
 * @returns {boolean}
 */
function textLooksLikeWireSchemaFailure(message) {
    return (
        /property ['"]?parsed['"]? is unsupported/iu.test(message) ||
        /messages\.\d+.*(?:property|field).*(?:unsupported|not supported)/iu.test(message) ||
        /unsupported (?:parameter|field).*messages/iu.test(message)
    );
}

/**
 * @param {string} message
 * @returns {boolean}
 */
function textLooksLikeUnsupportedCapabilityFailure(message) {
    return (
        /\binvalid api parameter\b/iu.test(message) ||
        /\bunsupported (?:parameter|field|capability|modality|attachment|image|vision)\b/iu.test(message) ||
        /\b(?:image|vision|attachment|tool|tools|function calling|json schema|response format)\b.*\b(?:unsupported|not supported|invalid)\b/iu.test(
            message,
        ) ||
        /\b(?:does not|doesn't|do not|don't) support\b/iu.test(message)
    );
}

/**
 * @param {ByokProviderFailureKind} kind
 * @param {number | null} statusCode
 * @param {string} message
 * @param {{
 *     retryAfterSeconds: number | null;
 *     resetAt: string | null;
 *     limitHeaders: Record<string, string | number>;
 * }} limitHints
 * @returns {ByokProviderFailure}
 */
function buildFailure(kind, statusCode, message, limitHints) {
    const http = statusCode ? `HTTP ${statusCode}` : null;
    const base = {
        retryAfterSeconds: limitHints.retryAfterSeconds,
        resetAt: limitHints.resetAt,
        limitHeaders: limitHints.limitHeaders,
    };
    switch (kind) {
        case 'credits':
            return {
                ...base,
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
                ...base,
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
                ...base,
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
                ...base,
                kind,
                message,
                statusCode,
                errorContext: 'provider.model_or_route',
                operatorLabel: `provider BYOK nao encontrou modelo ou rota configurada${http ? ` (${http})` : ''}`,
                operatorAction:
                    'confira /byok models refresh, selecione o modelo explicitamente e probe o candidato antes do live',
                external: true,
            };
        case 'capability-unsupported':
            return {
                ...base,
                kind,
                message,
                statusCode,
                errorContext: 'provider.capability_unsupported',
                operatorLabel: `provider BYOK recusou parametro ou capacidade da chamada${http ? ` (${http})` : ''}`,
                operatorAction:
                    'trate como falha da capability/probe, nao como indisponibilidade geral; tente rota sem essa capacidade ou modelo com suporte declarado',
                external: true,
            };
        case 'invalid-request':
            return {
                ...base,
                kind,
                message,
                statusCode,
                errorContext: 'provider.invalid_request',
                operatorLabel: `provider BYOK rejeitou a forma da requisicao${http ? ` (${http})` : ''}`,
                operatorAction:
                    'nao repita a mesma rota sem alterar o request; tente outro modelo/adapter e preserve a mensagem para corrigir o contrato do provider',
                external: true,
            };
        case 'timeout':
            return {
                ...base,
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
                ...base,
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
                ...base,
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
                ...base,
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
 * @returns {ByokProviderFailure}
 */
export function classifyByokProviderFailure(error) {
    const err = toError(error);
    const message = err.message || 'erro BYOK sem mensagem';
    const statusCode = readStructuredStatusCode(error) ?? readMessageStatusCode(message);
    const code = readFailureCode(error);
    const limitHints = readLimitHints(error, message);
    if (
        statusCode === 402 ||
        /(?:insufficient_quota|quota_exceeded|credits?_exhausted)/iu.test(code) ||
        textLooksLikeCreditsFailure(message)
    ) {
        return buildFailure('credits', statusCode, message, limitHints);
    }
    if (statusCode === 429 || textLooksLikeRateLimitFailure(message)) {
        return buildFailure('rate-limit', statusCode, message, limitHints);
    }
    if (statusCode === 401 || statusCode === 403 || textLooksLikeAuthFailure(message)) {
        return buildFailure('auth', statusCode, message, limitHints);
    }
    if (statusCode === 404 || (statusCode === 400 && textLooksLikeModelOrRouteFailure(message))) {
        return buildFailure('model-or-route', statusCode, message, limitHints);
    }
    if (statusCode === 400 && textLooksLikeWireSchemaFailure(message)) {
        return buildFailure('capability-unsupported', statusCode, message, limitHints);
    }
    if (statusCode === 400 && textLooksLikeUnsupportedCapabilityFailure(message)) {
        return buildFailure('capability-unsupported', statusCode, message, limitHints);
    }
    if (statusCode === 400) {
        return buildFailure('invalid-request', statusCode, message, limitHints);
    }
    if (textLooksLikeTimeoutFailure(message)) {
        return buildFailure('timeout', statusCode, message, limitHints);
    }
    if (textLooksLikeNetworkFailure(message, code)) {
        return buildFailure('network', statusCode, message, limitHints);
    }
    if (statusCode !== null && statusCode >= 500) {
        return buildFailure('upstream', statusCode, message, limitHints);
    }
    return buildFailure('unknown', statusCode, message, limitHints);
}
