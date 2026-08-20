// @ts-check
/**
 * Contratos canônicos para operações de I/O.
 *
 * Objetivo: padronizar envelope observável de read/write/search/diff/scan/fetch em todas as bordas (tools, server,
 * terminal, agent), preservando compatibilidade com payloads legados. Limites de tamanho/quantidade são tratados como
 * metadata informativa; somente políticas de segurança devem bloquear.
 *
 * @module copilot/core/io-contracts
 */

/**
 * @typedef {'read'
 *     | 'write'
 *     | 'append'
 *     | 'search'
 *     | 'diff'
 *     | 'parse'
 *     | 'stat'
 *     | 'mkdir'
 *     | 'index'
 *     | 'scan'
 *     | 'fetch'
 *     | 'delete'
 *     | 'copy'
 *     | 'move'
 *     | 'patch'
 *     | 'metadata'} IoOperation
 */

/** @typedef {'file' | 'directory' | 'workspace' | 'url' | 'sqlite' | 'shell' | 'git' | 'rag' | 'unknown'} IoTargetKind */

/** @typedef {'low' | 'medium' | 'high' | 'critical'} IoRiskClass */

/** @typedef {'none' | 'l1-hit' | 'l1-miss' | 'l2-hit' | 'l2-miss' | 'stale' | 'bypass'} IoCacheState */

/**
 * @typedef {'PathDenied'
 *     | 'UrlDenied'
 *     | 'PayloadTooLarge'
 *     | 'Timeout'
 *     | 'Abort'
 *     | 'NotFound'
 *     | 'BinaryDenied'
 *     | 'ParseFailed'
 *     | 'LockTimeout'
 *     | 'LockConflict'
 *     | 'IndexUnavailable'
 *     | 'ExternalToolFailed'
 *     | 'StorageUnavailable'
 *     | 'Unknown'} IoErrorCode
 */

/**
 * @typedef {object} IoMeta
 * @property {IoOperation} operation
 * @property {string} target
 * @property {IoTargetKind} targetKind
 * @property {number} [bytesRead]
 * @property {number} [bytesWritten]
 * @property {number} [durationMs]
 * @property {string} [engine]
 * @property {IoCacheState} cache
 * @property {boolean} [truncated]
 * @property {IoRiskClass} riskClass
 * @property {string} [traceId]
 * @property {string} [runtimeId]
 * @property {string} policyVersion
 * @property {Record<string, unknown>} [advisoryLimits]
 */

/**
 * @typedef {object} IoFailure
 * @property {false} ok
 * @property {IoErrorCode} code
 * @property {string} message
 * @property {IoMeta} io
 */

/**
 * @template T
 * @typedef {object} IoSuccess
 * @property {true} ok
 * @property {T} data
 * @property {IoMeta} io
 */

/** @type {string} */
export const IO_POLICY_VERSION = '2026-05-06.read-write-ultrafast.v1';

/**
 * @returns {string}
 */
export function createIoTraceId() {
    return `io-${Date.now().toString(36)}-${globalThis.crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Monta metadata canônica de I/O.
 *
 * @param {Partial<IoMeta> & { operation: IoOperation; target: string }} input
 * @returns {IoMeta}
 */
export function buildIoMeta(input) {
    /** @type {IoMeta} */
    const meta = {
        operation: input.operation,
        target: input.target,
        targetKind: input.targetKind ?? 'unknown',
        cache: input.cache ?? 'none',
        riskClass: input.riskClass ?? 'low',
        policyVersion: input.policyVersion ?? IO_POLICY_VERSION,
    };
    if (input.bytesRead !== undefined) meta.bytesRead = input.bytesRead;
    if (input.bytesWritten !== undefined) meta.bytesWritten = input.bytesWritten;
    if (input.durationMs !== undefined) meta.durationMs = input.durationMs;
    if (input.engine !== undefined) meta.engine = input.engine;
    if (input.truncated !== undefined) meta.truncated = input.truncated;
    if (input.traceId !== undefined) meta.traceId = input.traceId;
    if (input.runtimeId !== undefined) meta.runtimeId = input.runtimeId;
    if (input.advisoryLimits !== undefined) meta.advisoryLimits = input.advisoryLimits;
    return meta;
}

/**
 * Anexa metadata canônica de I/O em payloads de sucesso sem alterar o shape legado.
 *
 * @template {Record<string, unknown>} T
 * @param {T} payload
 * @param {IoMeta} io
 * @returns {T & { io: IoMeta }}
 */
export function withIoMeta(payload, io) {
    return { ...payload, io };
}

/**
 * Cria um resultado canônico de sucesso.
 *
 * @template T
 * @param {T} data
 * @param {IoMeta} io
 * @returns {IoSuccess<T>}
 */
export function ioOk(data, io) {
    return { ok: true, data, io };
}

/**
 * Cria um resultado canônico de falha.
 *
 * @param {IoErrorCode} code
 * @param {string} message
 * @param {IoMeta} io
 * @returns {IoFailure}
 */
export function ioFail(code, message, io) {
    return { ok: false, code, message, io };
}

/**
 * Converte erros nativos/externos em código estável de I/O.
 *
 * @param {unknown} error
 * @returns {{ code: IoErrorCode; message: string; cause: unknown }}
 */
export function toIoError(error) {
    const err = /** @type {{ code?: unknown; name?: unknown; message?: unknown }} */ (error);
    const code = typeof err.code === 'string' ? err.code : '';
    const name = typeof err.name === 'string' ? err.name : '';
    const message = typeof err.message === 'string' && err.message ? err.message : String(error);

    /** @type {IoErrorCode} */
    let ioCode = 'Unknown';
    if (/lock.+timeout|timeout.+lock|lock do recurso/i.test(message)) ioCode = 'LockTimeout';
    else if (code === 'ENOENT' || code === 'ENOTDIR') ioCode = 'NotFound';
    else if (code === 'EACCES' || code === 'EPERM') ioCode = 'PathDenied';
    else if (code === 'EEXIST') ioCode = 'LockConflict';
    else if (code === 'ETIMEDOUT' || name === 'TimeoutError') ioCode = 'Timeout';
    else if (code === 'ABORT_ERR' || name === 'AbortError') ioCode = 'Abort';
    else if (name === 'SyntaxError') ioCode = 'ParseFailed';
    else if (/bin[aá]rio|invalid.+utf-?8|bytes inv[aá]lidos/i.test(message)) ioCode = 'BinaryDenied';
    else if (/payload.+large|too large|tamanho.+exced/i.test(message)) ioCode = 'PayloadTooLarge';

    return { code: ioCode, message, cause: error };
}
