// @ts-check
/**
 * Feedback estruturado de falhas para `read_file_content`.
 *
 * @module copilot/tools/file/read/feedback
 */

import { createToolFailureResult } from '../../infra/tool-feedback.js';

const READ_FILE_FEEDBACK_FIX = /** @type {const} */ ({
    ERR_READ_PATH_INVALID:
        'Use um path relativo ao workspace ou absoluto permitido em /workspaces, sem null byte e sem escapar da policy.',
    ERR_READ_BINARY_LINE_WINDOW:
        'Remova startLine/endLine/maxLines ou troque encoding para utf8 quando quiser janela por linha.',
    ERR_READ_CURSOR_INVALID:
        'Use o nextCursor retornado pela chamada anterior. Para utf8 ele é a próxima linha; para base64 é byte offset.',
    ERR_READ_LINE_WINDOW_INVALID:
        'Ajuste startLine/endLine para um intervalo crescente; endLine deve ser maior ou igual a startLine.',
    ERR_READ_DIRECTORY:
        'Use list_directory para diretórios, ou informe o path de um arquivo regular para read_file_content.',
    ERR_READ_FAILED:
        'Releia o path, reduza maxBytes/maxLines ou use readStrategy=stream para isolar arquivos grandes.',
});

const READ_FILE_CONTENT_FEEDBACK_PARAMETERS = /** @type {const} */ ({
    type: 'object',
    required: ['path'],
    additionalProperties: false,
    properties: {
        path: { type: 'string', description: 'Caminho do arquivo.' },
        startLine: { type: 'integer', description: 'Linha inicial 1-based para utf8.' },
        endLine: { type: 'integer', description: 'Linha final 1-based inclusiva para utf8.' },
        cursor: { type: 'string', description: 'Cursor retornado por chamada anterior.' },
        maxLines: { type: 'integer', description: 'Máximo de linhas para utf8.' },
        maxBytes: { type: 'integer', description: 'Máximo de bytes de saída.' },
        encoding: { type: 'string', enum: ['utf8', 'base64'], description: 'Codificação de saída.' },
        readStrategy: { type: 'string', enum: ['cached', 'stream'], description: 'Estratégia de leitura.' },
        streamHighWaterMark: { type: 'integer', description: 'Buffer do read stream em bytes.' },
        includeMetadata: { type: 'boolean', description: 'Inclui metadata.' },
        includeHash: { type: 'boolean', description: 'Inclui hashes.' },
        includeReadThrough: { type: 'boolean', description: 'Aquece contexto relacionado.' },
        includeCacheStats: { type: 'boolean', description: 'Inclui stats do cache L1.' },
    },
});

/**
 * @typedef {keyof typeof READ_FILE_FEEDBACK_FIX} ReadFileFailureCode
 */

/**
 * @param {ReadFileFailureCode} code
 * @returns {string}
 */
function readFailureNextAction(code) {
    if (code === 'ERR_READ_PATH_INVALID') return 'Corrija o path para um arquivo permitido dentro do workspace.';
    if (code === 'ERR_READ_BINARY_LINE_WINDOW') return 'Remova a janela por linha ou use encoding=utf8.';
    if (code === 'ERR_READ_CURSOR_INVALID') return 'Reutilize exatamente o nextCursor retornado pela leitura anterior.';
    if (code === 'ERR_READ_LINE_WINDOW_INVALID') return 'Envie uma janela crescente com startLine menor ou igual a endLine.';
    if (code === 'ERR_READ_DIRECTORY') return 'Use list_directory para inspecionar o diretório ou informe um arquivo regular.';
    return 'Revalide o path e repita com escopo menor; se persistir, tente readStrategy=stream.';
}

/**
 * @param {ReadFileFailureCode} code
 * @param {string} message
 * @param {Record<string, unknown>} receivedParameters
 * @param {Record<string, unknown>} details
 * @returns {{
 *     operation: 'read';
 *     path: string | null;
 *     status: 'failed';
 *     code: ReadFileFailureCode;
 *     summary: string;
 *     nextAction: string;
 * }}
 */
function buildReadFailureTerminalSummary(code, message, receivedParameters, details) {
    const rawPath = details['path'] ?? receivedParameters['path'];
    const path = typeof rawPath === 'string' && rawPath.length > 0 ? rawPath : null;
    const nextAction = readFailureNextAction(code);
    const target = path ? `${path} · ` : '';
    return {
        operation: 'read',
        path,
        status: 'failed',
        code,
        summary: `Leitura falhou: ${target}${code} · ${message}`,
        nextAction,
    };
}

/**
 * @param {string} message
 * @param {ReadFileFailureCode} code
 * @param {Record<string, unknown>} receivedParameters
 * @param {Record<string, unknown>} [details]
 * @param {{ category?: import('../../infra/tool-feedback.js').ToolFailureCategory; error?: unknown; retryable?: boolean }} [options]
 */
export function createReadFileFailure(message, code, receivedParameters, details = {}, options = {}) {
    const terminalSummary = buildReadFailureTerminalSummary(code, message, receivedParameters, details);
    return createToolFailureResult({
        toolName: 'read_file_content',
        message,
        fix: READ_FILE_FEEDBACK_FIX[code],
        parameters: READ_FILE_CONTENT_FEEDBACK_PARAMETERS,
        receivedParameters,
        details: { code, ...details },
        extra: {
            code,
            operation: 'read',
            terminalSummary,
            llmNextAction: terminalSummary.nextAction,
            presentation: {
                operation: 'read',
                path: terminalSummary.path,
                targetKinds: [code === 'ERR_READ_DIRECTORY' ? 'directory' : 'file'],
                status: 'failed',
                summary: terminalSummary.summary,
            },
        },
        ...(options.error !== undefined ? { error: options.error } : {}),
        ...(options.category !== undefined ? { category: options.category } : {}),
        ...(options.retryable !== undefined ? { retryable: options.retryable } : {}),
    });
}
