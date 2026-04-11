// @ts-check
/**
 * src/copilot/observability/error-tracker.js
 *
 * Registro centralizado de erros para src/copilot.
 *
 * Funcionalidades:
 *
 * - Ring buffer dos últimos N erros (padrão 100) com contexto completo
 * - Handlers para processErrors/unhandledRejection no processo Node (opcionais)
 * - Contagem por tipo de erro para métricas
 * - API de consulta: `getErrors()`, `getErrorStats()`, `clearErrors()`
 *
 * @module copilot/observability/error-tracker
 * @see EventBus
 */

import { log } from './logger.js';

// ─── Tipos ────────────────────────────────────────────────────────────────────

/**
 * @typedef {object} ErrorEntry
 * @property {string} id - ID único do erro.
 * @property {number} timestamp - Epoch ms.
 * @property {string} message - Mensagem do erro.
 * @property {string} [stack] - Stack trace completo.
 * @property {string} [errorType] - Nome do tipo do erro (`err.constructor.name`).
 * @property {string} [source] - Origem (ex: `uncaughtException`, `unhandledRejection`, `sdk`, `tool`).
 * @property {string} [sessionId] - ID da sessão ativa, se disponível.
 * @property {string} [toolName] - Nome da ferramenta, se o erro ocorreu durante uma tool call.
 * @property {Record<string, unknown>} [metadata] - Metadados adicionais.
 */

/**
 * @typedef {object} ErrorStats
 * @property {number} total - Total de erros registrados (pode ser maior que buffer, se overflow).
 * @property {number} buffered - Quantos estão no ring buffer atual.
 * @property {Record<string, number>} byType - Contagem por `errorType`.
 * @property {Record<string, number>} bySource - Contagem por `source`.
 * @property {ErrorEntry | undefined} last - Erro mais recente.
 */

/**
 * @typedef {object} ErrorTrackerOptions
 * @property {number} [maxRecords] - Tamanho do ring buffer (padrão: 100).
 * @property {boolean} [registerGlobalHandlers] - Registrar handlers globais no processo (padrão: false).
 * @property {string | null} [sessionId] - ID de sessão para context nos erros capturados.
 */

/**
 * @typedef {object} TrackErrorOptions
 * @property {string} [source] - Origem do erro.
 * @property {string} [toolName] - Ferramenta associada.
 * @property {string} [sessionId] - Sessão associada.
 * @property {Record<string, unknown>} [metadata] - Metadados adicionais.
 */

/**
 * @typedef {object} ErrorTracker
 * @property {(err: unknown, opts?: TrackErrorOptions) => ErrorEntry} trackError - Registra um erro.
 * @property {(n?: number, source?: string) => ErrorEntry[]} getErrors - Retorna últimos N erros.
 * @property {() => ErrorStats} getStats - Retorna estatísticas agregadas.
 * @property {() => void} clearErrors - Limpa o buffer.
 * @property {() => void} registerGlobalHandlers - Registra uncaughtException/unhandledRejection.
 * @property {() => void} destroy - Remove listeners globais e limpa estado.
 */

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _idCounter = 0;

/**
 * Gera ID único para o erro.
 *
 * @returns {string}
 */
function nextId() {
    return `err-${Date.now()}-${++_idCounter}`;
}

/**
 * Extrai mensagem e stack de qualquer valor throwable.
 *
 * @param {unknown} err
 * @returns {{ message: string; stack: string | undefined; errorType: string }}
 */
function extractErrorInfo(err) {
    if (err instanceof Error) {
        return { message: err.message, stack: err.stack, errorType: err.constructor.name };
    }
    if (typeof err === 'string') {
        return { message: err, stack: undefined, errorType: 'string' };
    }
    return { message: String(err), stack: undefined, errorType: typeof err };
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Cria um registro de erros com ring buffer e API de consulta.
 *
 * @param {ErrorTrackerOptions} [opts={}] Default is `{}`
 * @returns {ErrorTracker}
 */
export function createErrorTracker(opts = {}) {
    const { maxRecords = 100, registerGlobalHandlers: autoRegister = false, sessionId: defaultSessionId = null } = opts;

    /** @type {ErrorEntry[]} */
    const _buffer = [];
    let _totalRegistered = 0;

    /** @type {Record<string, number>} */
    const _byType = {};

    /** @type {Record<string, number>} */
    const _bySource = {};

    /**
     * Registra e persiste um erro.
     *
     * @param {unknown} err
     * @param {TrackErrorOptions} [trackOpts={}] Default is `{}`
     * @returns {ErrorEntry}
     */
    function trackError(err, trackOpts = {}) {
        const { source = 'unknown', toolName, sessionId = defaultSessionId ?? undefined, metadata } = trackOpts;

        const { message, stack, errorType } = extractErrorInfo(err);

        /** @type {ErrorEntry} */
        const entry = {
            id: nextId(),
            timestamp: Date.now(),
            message,
            ...(stack !== undefined ? { stack } : {}),
            errorType,
            source,
            ...(sessionId != null ? { sessionId } : {}),
            ...(toolName !== undefined ? { toolName } : {}),
            ...(metadata !== undefined ? { metadata } : {}),
        };

        // Ring buffer
        _buffer.push(entry);
        if (_buffer.length > maxRecords) _buffer.shift();
        _totalRegistered++;

        // Contagens
        _byType[errorType] = (_byType[errorType] ?? 0) + 1;
        _bySource[source] = (_bySource[source] ?? 0) + 1;

        return entry;
    }

    /**
     * @param {number} [n=20] Default is `20`
     * @param {string} [filterSource] - Se definido, filtra por source.
     * @returns {ErrorEntry[]}
     */
    function getErrors(n = 20, filterSource) {
        const buf = filterSource ? _buffer.filter((e) => e.source === filterSource) : _buffer;
        return buf.slice(-n);
    }

    /**
     * @returns {ErrorStats}
     */
    function getStats() {
        return {
            total: _totalRegistered,
            buffered: _buffer.length,
            byType: { ..._byType },
            bySource: { ..._bySource },
            last: _buffer[_buffer.length - 1],
        };
    }

    function clearErrors() {
        _buffer.length = 0;
        _totalRegistered = 0;
        Object.keys(_byType).forEach((k) => delete _byType[k]);
        Object.keys(_bySource).forEach((k) => delete _bySource[k]);
    }

    // ── Global process handlers ───────────────────────────────────────────────

    /** @type {((err: Error) => void) | null} */
    let _uncaughtHandler = null;
    /** @type {((reason: unknown, promise: Promise<unknown>) => void) | null} */
    let _rejectionHandler = null;

    function registerGlobalHandlers() {
        if (_uncaughtHandler) return; // Já registrado

        _uncaughtHandler = (err) => {
            const entry = trackError(err, { source: 'uncaughtException' });
            log('FATAL', `[error-tracker] uncaughtException: ${entry.message}`, undefined);
        };

        _rejectionHandler = (reason) => {
            const entry = trackError(reason, { source: 'unhandledRejection' });
            log('ERROR', `[error-tracker] unhandledRejection: ${entry.message}`, undefined);
        };

        process.on('uncaughtException', _uncaughtHandler);
        process.on('unhandledRejection', _rejectionHandler);
    }

    function destroy() {
        if (_uncaughtHandler) {
            process.off('uncaughtException', _uncaughtHandler);
            _uncaughtHandler = null;
        }
        if (_rejectionHandler) {
            process.off('unhandledRejection', _rejectionHandler);
            _rejectionHandler = null;
        }
        clearErrors();
    }

    if (autoRegister) registerGlobalHandlers();

    return { trackError, getErrors, getStats, clearErrors, registerGlobalHandlers, destroy };
}

// ─── Singleton ────────────────────────────────────────────────────────────────

/** Singleton global do error tracker para src/copilot. */
export const defaultErrorTracker = createErrorTracker({
    maxRecords: 100,
    registerGlobalHandlers: false,
});
