// @ts-check
/**
 * Contrato local canônico para `MessageOptions` do @github/copilot-sdk.
 *
 * A intenção deste módulo é falhar cedo, com feedback acionável, antes de
 * deixar o SDK receber payloads ambíguos ou parcialmente inválidos.
 *
 * @module copilot/sdk/session/message-options
 */

/**
 * @typedef {import('@github/copilot-sdk').MessageOptions} MessageOptions
 *
 * @typedef {NonNullable<MessageOptions['attachments']>[number]} MessageAttachment
 */

const MESSAGE_OPTION_KEYS = new Set(['prompt', 'attachments', 'mode', 'requestHeaders']);
const ATTACHMENT_TYPES = new Set(['file', 'directory', 'selection', 'blob']);

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function objectOrNull(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? /** @type {Record<string, unknown>} */ (value)
        : null;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {string}
 */
function requireNonEmptyString(value, field) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new TypeError(`[sdk/message-options] ${field} deve ser string não-vazia.`);
    }
    return value;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {string | undefined}
 */
function optionalString(value, field) {
    if (value === undefined) return undefined;
    if (typeof value !== 'string') {
        throw new TypeError(`[sdk/message-options] ${field} deve ser string quando fornecido.`);
    }
    return value;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {number}
 */
function requireFiniteNumber(value, field) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new TypeError(`[sdk/message-options] ${field} deve ser number finito.`);
    }
    return value;
}

/**
 * @param {Record<string, unknown>} obj
 * @param {Set<string>} allowed
 * @param {string} context
 */
function assertKnownKeys(obj, allowed, context) {
    const unknown = Object.keys(obj).filter((key) => !allowed.has(key));
    if (unknown.length > 0) {
        throw new TypeError(
            `[sdk/message-options] ${context} contém campo(s) desconhecido(s): ${unknown.join(', ')}.`,
        );
    }
}

/**
 * @param {unknown} value
 * @param {string} context
 * @returns {{ line: number; character: number }}
 */
function normalizePosition(value, context) {
    const obj = objectOrNull(value);
    if (!obj) {
        throw new TypeError(`[sdk/message-options] ${context} deve ser objeto { line, character }.`);
    }
    assertKnownKeys(obj, new Set(['line', 'character']), context);
    return {
        line: requireFiniteNumber(obj['line'], `${context}.line`),
        character: requireFiniteNumber(obj['character'], `${context}.character`),
    };
}

/**
 * @param {unknown} value
 * @param {string} context
 * @returns {{ start: { line: number; character: number }; end: { line: number; character: number } } | undefined}
 */
function normalizeSelectionRange(value, context) {
    if (value === undefined) return undefined;
    const obj = objectOrNull(value);
    if (!obj) {
        throw new TypeError(`[sdk/message-options] ${context} deve ser objeto { start, end }.`);
    }
    assertKnownKeys(obj, new Set(['start', 'end']), context);
    return {
        start: normalizePosition(obj['start'], `${context}.start`),
        end: normalizePosition(obj['end'], `${context}.end`),
    };
}

/**
 * @param {Record<string, unknown>} attachment
 * @param {number} index
 * @returns {MessageAttachment}
 */
function normalizeAttachmentObject(attachment, index) {
    const type = attachment['type'];
    if (typeof type !== 'string' || !ATTACHMENT_TYPES.has(type)) {
        throw new TypeError(
            `[sdk/message-options] attachments[${index}].type deve ser file | directory | selection | blob.`,
        );
    }

    if (type === 'file') {
        assertKnownKeys(attachment, new Set(['type', 'path', 'displayName']), `attachments[${index}]`);
        return /** @type {MessageAttachment} */ ({
            type,
            path: requireNonEmptyString(attachment['path'], `attachments[${index}].path`),
            ...(attachment['displayName'] !== undefined
                ? { displayName: requireNonEmptyString(attachment['displayName'], `attachments[${index}].displayName`) }
                : {}),
        });
    }

    if (type === 'directory') {
        assertKnownKeys(attachment, new Set(['type', 'path', 'displayName']), `attachments[${index}]`);
        return /** @type {MessageAttachment} */ ({
            type,
            path: requireNonEmptyString(attachment['path'], `attachments[${index}].path`),
            ...(attachment['displayName'] !== undefined
                ? { displayName: requireNonEmptyString(attachment['displayName'], `attachments[${index}].displayName`) }
                : {}),
        });
    }

    if (type === 'selection') {
        assertKnownKeys(
            attachment,
            new Set(['type', 'filePath', 'displayName', 'selection', 'text']),
            `attachments[${index}]`,
        );
        const selection = normalizeSelectionRange(attachment['selection'], `attachments[${index}].selection`);
        const text = optionalString(attachment['text'], `attachments[${index}].text`);
        return /** @type {MessageAttachment} */ ({
            type,
            filePath: requireNonEmptyString(attachment['filePath'], `attachments[${index}].filePath`),
            displayName: requireNonEmptyString(attachment['displayName'], `attachments[${index}].displayName`),
            ...(selection ? { selection } : {}),
            ...(text !== undefined ? { text } : {}),
        });
    }

    assertKnownKeys(attachment, new Set(['type', 'data', 'mimeType', 'displayName']), `attachments[${index}]`);
    return /** @type {MessageAttachment} */ ({
        type,
        data: requireNonEmptyString(attachment['data'], `attachments[${index}].data`),
        mimeType: requireNonEmptyString(attachment['mimeType'], `attachments[${index}].mimeType`),
        ...(attachment['displayName'] !== undefined
            ? { displayName: requireNonEmptyString(attachment['displayName'], `attachments[${index}].displayName`) }
            : {}),
    });
}

/**
 * @param {unknown} attachments
 * @returns {MessageAttachment[] | undefined}
 */
export function normalizeMessageAttachments(attachments) {
    if (attachments === undefined) return undefined;
    if (!Array.isArray(attachments)) {
        throw new TypeError('[sdk/message-options] attachments deve ser array quando fornecido.');
    }
    return attachments.map((attachment, index) => {
        const obj = objectOrNull(attachment);
        if (!obj) {
            throw new TypeError(`[sdk/message-options] attachments[${index}] deve ser objeto.`);
        }
        return normalizeAttachmentObject(obj, index);
    });
}

/**
 * @param {unknown} requestHeaders
 * @returns {Record<string, string> | undefined}
 */
export function normalizeMessageRequestHeaders(requestHeaders) {
    if (requestHeaders === undefined) return undefined;
    const obj = objectOrNull(requestHeaders);
    if (!obj) {
        throw new TypeError('[sdk/message-options] requestHeaders deve ser objeto Record<string,string>.');
    }
    /** @type {Record<string, string>} */
    const normalized = {};
    for (const [key, value] of Object.entries(obj)) {
        if (key.trim().length === 0) {
            throw new TypeError('[sdk/message-options] requestHeaders não aceita chave vazia.');
        }
        if (typeof value !== 'string') {
            throw new TypeError(`[sdk/message-options] requestHeaders.${key} deve ser string.`);
        }
        normalized[key] = value;
    }
    return normalized;
}

/**
 * @param {unknown} messageOptions
 * @returns {MessageOptions}
 */
export function normalizeMessageOptions(messageOptions) {
    const obj = objectOrNull(messageOptions);
    if (!obj) {
        throw new TypeError('[sdk/message-options] MessageOptions deve ser objeto.');
    }
    assertKnownKeys(obj, MESSAGE_OPTION_KEYS, 'MessageOptions');

    const prompt = requireNonEmptyString(obj['prompt'], 'prompt');

    const mode = obj['mode'];
    if (mode !== undefined && mode !== 'enqueue' && mode !== 'immediate') {
        throw new TypeError('[sdk/message-options] mode deve ser enqueue | immediate quando fornecido.');
    }

    const attachments = normalizeMessageAttachments(obj['attachments']);
    const requestHeaders = normalizeMessageRequestHeaders(obj['requestHeaders']);

    return {
        prompt,
        ...(attachments !== undefined ? { attachments } : {}),
        ...(mode !== undefined ? { mode: /** @type {'enqueue' | 'immediate'} */ (mode) } : {}),
        ...(requestHeaders !== undefined ? { requestHeaders } : {}),
    };
}

/**
 * @param {MessageOptions} messageOptions
 * @returns {{
 *     promptLength: number;
 *     attachmentsCount: number;
 *     mode: 'enqueue' | 'immediate';
 *     requestHeadersCount: number;
 * }}
 */
export function summarizeMessageOptions(messageOptions) {
    return {
        promptLength: messageOptions.prompt.length,
        attachmentsCount: messageOptions.attachments?.length ?? 0,
        mode: messageOptions.mode ?? 'enqueue',
        requestHeadersCount: Object.keys(messageOptions.requestHeaders ?? {}).length,
    };
}
