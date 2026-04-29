// @ts-check
/**
 * Helpers para construir attachments aceitos por `session.send()`/`session.sendAndWait()`.
 *
 * @module copilot/sdk/session/attachments
 */

/**
 * @typedef {NonNullable<import('@github/copilot-sdk').MessageOptions['attachments']>[number]} MessageAttachment
 *
 * @typedef {Extract<MessageAttachment, { type: 'file' }>} FileAttachment
 *
 * @typedef {Extract<MessageAttachment, { type: 'directory' }>} DirectoryAttachment
 *
 * @typedef {Extract<MessageAttachment, { type: 'selection' }>} SelectionAttachment
 *
 * @typedef {Extract<MessageAttachment, { type: 'blob' }>} BlobAttachment
 */

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {string}
 */
function requireNonEmptyString(value, field) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new TypeError(`[sdk/attachments] ${field} deve ser string não-vazia`);
    }
    return value;
}

/**
 * @param {string | undefined} displayName
 * @returns {{ displayName?: string }}
 */
function optionalDisplayName(displayName) {
    if (displayName === undefined) return {};
    return { displayName: requireNonEmptyString(displayName, 'displayName') };
}

/**
 * Cria attachment de arquivo.
 *
 * @param {string} path
 * @param {{ displayName?: string }} [opts]
 * @returns {FileAttachment}
 */
export function fileAttachment(path, opts = {}) {
    return /** @type {FileAttachment} */ ({
        type: 'file',
        path: requireNonEmptyString(path, 'path'),
        ...optionalDisplayName(opts.displayName),
    });
}

/**
 * Alias explícito para `fileAttachment`, preservando a nomenclatura proposta na auditoria externa.
 *
 * @param {string} path
 * @param {{ displayName?: string }} [opts]
 * @returns {FileAttachment}
 */
export function createFileAttachment(path, opts = {}) {
    return fileAttachment(path, opts);
}

/**
 * Cria attachment de diretório.
 *
 * @param {string} path
 * @param {{ displayName?: string }} [opts]
 * @returns {DirectoryAttachment}
 */
export function directoryAttachment(path, opts = {}) {
    return /** @type {DirectoryAttachment} */ ({
        type: 'directory',
        path: requireNonEmptyString(path, 'path'),
        ...optionalDisplayName(opts.displayName),
    });
}

/**
 * Cria attachment de seleção de arquivo.
 *
 * @param {string} filePath
 * @param {{
 *     displayName: string;
 *     selection?: SelectionAttachment['selection'];
 *     text?: string;
 * }} opts
 * @returns {SelectionAttachment}
 */
export function selectionAttachment(filePath, opts) {
    if (!opts || typeof opts !== 'object') {
        throw new TypeError('[sdk/attachments] opts é obrigatório para selectionAttachment');
    }
    return /** @type {SelectionAttachment} */ ({
        type: 'selection',
        filePath: requireNonEmptyString(filePath, 'filePath'),
        displayName: requireNonEmptyString(opts.displayName, 'displayName'),
        ...(opts.selection !== undefined ? { selection: opts.selection } : {}),
        ...(opts.text !== undefined ? { text: requireNonEmptyString(opts.text, 'text') } : {}),
    });
}

/**
 * Cria attachment blob, normalmente para imagem já codificada em base64.
 *
 * @param {string} data
 * @param {string} mimeType
 * @param {{ displayName?: string }} [opts]
 * @returns {BlobAttachment}
 */
export function blobAttachment(data, mimeType, opts = {}) {
    return /** @type {BlobAttachment} */ ({
        type: 'blob',
        data: requireNonEmptyString(data, 'data'),
        mimeType: requireNonEmptyString(mimeType, 'mimeType'),
        ...optionalDisplayName(opts.displayName),
    });
}

/**
 * Alias explícito para `blobAttachment`, preservando a nomenclatura proposta na auditoria externa.
 *
 * @param {string} data
 * @param {string} mimeType
 * @param {{ displayName?: string }} [opts]
 * @returns {BlobAttachment}
 */
export function createBlobAttachment(data, mimeType, opts = {}) {
    return blobAttachment(data, mimeType, opts);
}

/**
 * Normaliza um ou mais attachments para uso em MessageOptions.
 *
 * @param {MessageAttachment | MessageAttachment[] | null | undefined} attachments
 * @returns {MessageAttachment[]}
 */
export function normalizeAttachments(attachments) {
    if (attachments === null || attachments === undefined) return [];
    return Array.isArray(attachments) ? attachments : [attachments];
}
