// @ts-check
/**
 * Feedback estruturado para falhas de tools.
 *
 * Objetivo: manter compatibilidade com respostas legadas (`success:false`, `ok:false`, `error`, `reason`) e acrescentar
 * um bloco canônico que ajude a LLM a corrigir a próxima chamada sem adivinhar.
 */

import { toError } from '#copilot/infra/public/platform/error';

const MAX_STRING_PREVIEW = 240;
const MAX_ARRAY_PREVIEW = 20;
const MAX_OBJECT_KEYS_PREVIEW = 40;
const MAX_SCHEMA_PROPERTIES_PREVIEW = 40;

const SECRET_KEY_RE = /(?:password|passwd|secret|token|authorization|api[_-]?key|private[_-]?key|credential)/i;

const CATEGORY_DEFAULTS = /** @type {const} */ ({
    'invalid-parameters': {
        retryable: false,
        fix: 'Corrija os argumentos enviados para a tool e chame novamente com o schema esperado.',
    },
    'policy-denied': {
        retryable: false,
        fix: 'Escolha um caminho, comando ou recurso permitido pela policy atual antes de tentar novamente.',
    },
    'not-found': {
        retryable: false,
        fix: 'Verifique se o caminho, identificador ou recurso existe e tente novamente com um valor válido.',
    },
    conflict: {
        retryable: false,
        fix: 'Releia o estado atual, atualize hashes/cursors/locks e repita a operação com os dados mais recentes.',
    },
    timeout: {
        retryable: true,
        fix: 'Reduza o escopo, aumente o timeout quando a tool permitir, ou tente novamente mais tarde.',
    },
    'external-service': {
        retryable: true,
        fix: 'Verifique conectividade, limites/rate limit e disponibilidade do serviço externo antes de repetir.',
    },
    'internal-error': {
        retryable: true,
        fix: 'Tente novamente com menor escopo; se persistir, use o feedback e logs para investigar a causa interna.',
    },
    unknown: {
        retryable: false,
        fix: 'Leia a mensagem de erro, ajuste a chamada e prefira uma operação menor para isolar a causa.',
    },
});

/**
 * @typedef {'invalid-parameters'
 *     | 'policy-denied'
 *     | 'not-found'
 *     | 'conflict'
 *     | 'timeout'
 *     | 'external-service'
 *     | 'internal-error'
 *     | 'unknown'} ToolFailureCategory
 */

/**
 * @typedef {object} ToolFailureFeedback
 * @property {1} version
 * @property {string} toolName
 * @property {ToolFailureCategory} category
 * @property {string} reason
 * @property {boolean} retryable
 * @property {string} fix
 * @property {unknown} [expectedParameters]
 * @property {unknown} [receivedParameters]
 * @property {Record<string, unknown>} [details]
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} error
 * @returns {string | undefined}
 */
function getErrorCode(error) {
    if (!isRecord(error)) return undefined;
    const code = error['code'];
    return typeof code === 'string' ? code : undefined;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function messageFrom(value) {
    if (value instanceof Error) {
        const err = toError(value);
        return err.message || err.name;
    }
    if (typeof value === 'string') return value;
    if (isRecord(value)) {
        for (const key of ['error', 'reason', 'message']) {
            const candidate = value[key];
            if (typeof candidate === 'string' && candidate.trim()) return candidate;
        }
    }
    return 'Tool falhou sem mensagem detalhada.';
}

/**
 * @param {unknown} error
 * @returns {string | undefined}
 */
function errorNameFrom(error) {
    const err = error instanceof Error ? toError(error) : null;
    return err?.name;
}

/**
 * Classifica erros de execução e falhas retornadas por handlers.
 *
 * @param {unknown} error
 * @returns {ToolFailureCategory}
 */
export function classifyToolFailure(error) {
    const message = messageFrom(error);
    const code = getErrorCode(error);
    const name = errorNameFrom(error);
    const haystack = `${code ?? ''} ${name ?? ''} ${message}`.toLowerCase();

    if (/\b(etimedout|timeout|timed out|aborterror|aborted|cancelled|cancelado)\b/.test(haystack)) {
        return 'timeout';
    }
    if (
        /\b(enoent|not found|no such file|não encontrado|não encontrada|nao encontrado|nao encontrada|não existe|nao existe)\b/.test(
            haystack,
        )
    ) {
        return 'not-found';
    }
    if (
        /\b(eacces|eperm|permission|denied|blocked|bloquead|policy|política|politica|protegida|protegido|fora do workspace|não permitido|nao permitido)\b/.test(
            haystack,
        )
    ) {
        return 'policy-denied';
    }
    if (
        /\b(eexist|conflict|expectedhash|expected hash|hash|stale|changed|alterad|já existe|ja existe|overwrite|lock|precondition|pré-condição|pre-condicao|nothing to commit|nenhum arquivo)\b/.test(
            haystack,
        )
    ) {
        return 'conflict';
    }
    if (
        /\b(econn|enotfound|eai_again|http|fetch|network|rate limit|429|serviço externo|servico externo|resposta sem corpo|response without body)\b/.test(
            haystack,
        )
    ) {
        return 'external-service';
    }
    if (
        /\b(zod|schema|validation|invalid|inválid|invalido|inválido|parameter|parameters|parametro|parametros|parâmetro|parâmetros|argument|argumento|argumentos|required|obrigatório|obrigatorio|expected|esperado|deve ser|tipo|enum|range|encoding)\b/.test(
            haystack,
        )
    ) {
        return 'invalid-parameters';
    }
    if (error instanceof Error || toError(error)) {
        return 'internal-error';
    }
    return 'unknown';
}

/**
 * @param {unknown} value
 * @param {WeakSet<object>} seen
 * @param {number} depth
 * @param {string | undefined} key
 * @returns {unknown}
 */
function previewValue(value, seen, depth, key) {
    if (key && SECRET_KEY_RE.test(key)) return '[redacted]';
    if (typeof value === 'string') {
        return value.length > MAX_STRING_PREVIEW ? `${value.slice(0, MAX_STRING_PREVIEW)}...` : value;
    }
    if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) {
        return value;
    }
    if (typeof value === 'bigint') return value.toString();
    if (value instanceof Uint8Array) {
        return { type: value.constructor.name, byteLength: value.byteLength };
    }
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'function') return `[function ${value.name || 'anonymous'}]`;
    if (!isRecord(value) && !Array.isArray(value)) return String(value);
    if (depth <= 0) return Array.isArray(value) ? `[array:${value.length}]` : '[object]';
    if (seen.has(value)) return '[circular]';
    seen.add(value);
    if (Array.isArray(value)) {
        const items = value.slice(0, MAX_ARRAY_PREVIEW).map((item) => previewValue(item, seen, depth - 1, undefined));
        if (value.length > MAX_ARRAY_PREVIEW) items.push(`... ${value.length - MAX_ARRAY_PREVIEW} more items`);
        return items;
    }
    const entries = Object.entries(value).slice(0, MAX_OBJECT_KEYS_PREVIEW);
    const out = /** @type {Record<string, unknown>} */ ({});
    for (const [entryKey, entryValue] of entries) {
        out[entryKey] = previewValue(entryValue, seen, depth - 1, entryKey);
    }
    const remaining = Object.keys(value).length - entries.length;
    if (remaining > 0) out['__truncatedKeys'] = remaining;
    return out;
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
export function previewToolFeedbackValue(value) {
    return previewValue(value, new WeakSet(), 3, undefined);
}

/**
 * @param {unknown} schema
 * @returns {unknown}
 */
export function summarizeToolParameterSchema(schema) {
    if (!isRecord(schema)) return undefined;
    const properties = isRecord(schema['properties']) ? schema['properties'] : undefined;
    const summarizedProperties = /** @type {Record<string, unknown>} */ ({});
    if (properties) {
        for (const [name, property] of Object.entries(properties).slice(0, MAX_SCHEMA_PROPERTIES_PREVIEW)) {
            if (isRecord(property)) {
                summarizedProperties[name] = previewToolFeedbackValue({
                    type: property['type'],
                    enum: property['enum'],
                    description: property['description'],
                    default: property['default'],
                });
            } else {
                summarizedProperties[name] = previewToolFeedbackValue(property);
            }
        }
    }
    return {
        type: schema['type'],
        required: Array.isArray(schema['required']) ? schema['required'] : undefined,
        additionalProperties: schema['additionalProperties'],
        properties: summarizedProperties,
        propertyCount: properties ? Object.keys(properties).length : 0,
    };
}

/**
 * @param {{
 *     toolName: string;
 *     error?: unknown;
 *     message?: string;
 *     category?: ToolFailureCategory;
 *     retryable?: boolean;
 *     fix?: string;
 *     parameters?: unknown;
 *     receivedParameters?: unknown;
 *     details?: Record<string, unknown>;
 * }} options
 * @returns {ToolFailureFeedback}
 */
export function createToolFailureFeedback(options) {
    const category = options.category ?? classifyToolFailure(options.error ?? options.message);
    const defaults = CATEGORY_DEFAULTS[category] ?? CATEGORY_DEFAULTS.unknown;
    const reason = options.message ?? messageFrom(options.error);
    const details = options.details ? previewToolFeedbackValue(options.details) : undefined;
    return {
        version: 1,
        toolName: options.toolName,
        category,
        reason,
        retryable: options.retryable ?? defaults.retryable,
        fix: options.fix ?? defaults.fix,
        ...(options.parameters !== undefined
            ? {
                  expectedParameters:
                      summarizeToolParameterSchema(options.parameters) ?? previewToolFeedbackValue(options.parameters),
              }
            : {}),
        ...(options.receivedParameters !== undefined
            ? { receivedParameters: previewToolFeedbackValue(options.receivedParameters) }
            : {}),
        ...(isRecord(details) ? { details } : {}),
    };
}

/**
 * @param {unknown} result
 * @returns {result is Record<string, unknown>}
 */
export function isToolFailureResult(result) {
    if (!isRecord(result)) return false;
    return result['success'] === false || result['ok'] === false;
}

/**
 * @param {unknown} value
 * @returns {value is string | number | boolean | null}
 */
function isScalarDetail(value) {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null;
}

/**
 * @param {Record<string, unknown>} source
 * @param {Record<string, unknown>} target
 * @param {string[]} keys
 */
function copyScalarDetails(source, target, keys) {
    for (const key of keys) {
        const value = source[key];
        if (isScalarDetail(value)) target[key] = value;
    }
}

/**
 * @param {Record<string, unknown>} result
 * @returns {Record<string, unknown>}
 */
function extractFailureDetails(result) {
    const details = /** @type {Record<string, unknown>} */ ({
        legacyShape: Object.keys(result).filter((key) => key !== 'toolFeedback'),
    });
    copyScalarDetails(result, details, [
        'code',
        'exitCode',
        'signal',
        'status',
        'statusCode',
        'traceId',
        'operationId',
        'path',
        'source',
        'destination',
        'cursor',
        'nextCursor',
        'currentHash',
        'expectedHash',
        'previousHash',
        'contentHash',
    ]);
    const operation = result['operation'];
    if (isRecord(operation)) {
        const operationDetails = /** @type {Record<string, unknown>} */ ({});
        copyScalarDetails(operation, operationDetails, [
            'operationId',
            'traceId',
            'status',
            'capability',
            'risk',
            'target',
            'elapsedMs',
        ]);
        if (Object.keys(operationDetails).length > 0) details['operation'] = operationDetails;
    }
    const metadata = result['metadata'];
    if (isRecord(metadata)) {
        const metadataDetails = /** @type {Record<string, unknown>} */ ({});
        copyScalarDetails(metadata, metadataDetails, [
            'engine',
            'elapsedMs',
            'durationMs',
            'bytesReturned',
            'truncated',
            'configuredLimit',
            'cursorOffset',
            'totalMatches',
        ]);
        if (Object.keys(metadataDetails).length > 0) details['metadata'] = metadataDetails;
    }
    return details;
}

/**
 * Acrescenta `toolFeedback` a retornos legados de falha sem apagar o tipo estrutural do resultado original.
 *
 * @template TResult
 * @param {TResult} result
 * @param {{ toolName: string; parameters?: unknown; receivedParameters?: unknown }} context
 * @returns {TResult}
 */
export function enrichToolFailureResult(result, context) {
    if (!isToolFailureResult(result)) return result;
    if (isRecord(result['toolFeedback'])) return result;
    const feedback = createToolFailureFeedback({
        toolName: context.toolName,
        error: result,
        parameters: context.parameters,
        receivedParameters: context.receivedParameters,
        details: extractFailureDetails(result),
    });
    return /** @type {TResult} */ ({ ...result, toolFeedback: feedback });
}

/**
 * @typedef {{ success: false; ok: false; error: string; toolFeedback: ToolFailureFeedback }} ToolExecutionFailureResponse
 */

/**
 * @param {unknown} value
 * @returns {value is ToolExecutionFailureResponse}
 */
export function isToolExecutionFailureResponse(value) {
    if (!isRecord(value)) return false;
    return (
        value['success'] === false &&
        value['ok'] === false &&
        typeof value['error'] === 'string' &&
        isRecord(value['toolFeedback'])
    );
}

/**
 * @param {{ toolName: string; error: unknown; parameters?: unknown; receivedParameters?: unknown }} options
 * @returns {ToolExecutionFailureResponse}
 */
export function createToolFailureResponse(options) {
    const feedback = createToolFailureFeedback({
        toolName: options.toolName,
        error: options.error,
        parameters: options.parameters,
        receivedParameters: options.receivedParameters,
        details: {
            errorName: errorNameFrom(options.error),
            code: getErrorCode(options.error),
        },
    });
    return {
        success: false,
        ok: false,
        error: feedback.reason,
        toolFeedback: feedback,
    };
}

/**
 * Cria um retorno de falha estruturado para handlers que validam domínio/policy antes de chamar a infra.
 *
 * @param {{
 *     toolName: string;
 *     error?: unknown;
 *     message?: string;
 *     category?: ToolFailureCategory;
 *     retryable?: boolean;
 *     fix?: string;
 *     parameters?: unknown;
 *     receivedParameters?: unknown;
 *     details?: Record<string, unknown>;
 *     extra?: Record<string, unknown>;
 * }} options
 * @returns {{ success: false; error: string; toolFeedback: ToolFailureFeedback } & Record<string, unknown>}
 */
export function createToolFailureResult(options) {
    const feedback = createToolFailureFeedback(options);
    return {
        success: false,
        error: feedback.reason,
        ...(options.extra ?? {}),
        toolFeedback: feedback,
    };
}

/**
 * Envolve handlers de tools com feedback estruturado de falha preservando o resultado do caminho normal. Exceções são
 * convertidas, por contrato, em uma resposta de falha estruturada.
 *
 * @template TArgs
 * @template TResult
 * @param {string} toolName
 * @param {(args: TArgs, invocation?: import('#copilot/sdk/types').ToolInvocation) => Promise<TResult> | TResult} handler
 * @param {{ parameters?: unknown }} [options]
 * @returns {(
 *     args: TArgs,
 *     invocation?: import('#copilot/sdk/types').ToolInvocation,
 * ) => Promise<TResult | ReturnType<typeof createToolFailureResponse>>}
 */
export function withToolFailureFeedback(toolName, handler, options = {}) {
    return async function toolFailureAwareHandler(args, invocation) {
        const receivedParameters = args;
        try {
            const result = await handler(args, invocation);
            return enrichToolFailureResult(result, {
                toolName,
                parameters: options.parameters,
                receivedParameters,
            });
        } catch (error) {
            return createToolFailureResponse({
                toolName,
                error,
                parameters: options.parameters,
                receivedParameters,
            });
        }
    };
}
