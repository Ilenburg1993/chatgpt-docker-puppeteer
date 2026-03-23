// @ts-check
/**
 * src/copilot/lib/telemetry.js
 *
 * Telemetria leve para eventos do Copilot SDK. Rastreia chamadas de ferramentas, latência, erros e sessões. Projetado
 * para uso interno — não envia dados externamente.
 *
 * Uso típico: import { createTelemetry, recordToolCall, getSummary } from '#copilot/lib/telemetry'; const tel =
 * createTelemetry(); recordToolCall(tel, 'lint_check', { durationMs: 120, success: true }); const summary =
 * getSummary(tel);
 *
 * @module copilot/lib/telemetry
 */

/**
 * @typedef {object} ToolCallRecord
 * @property {string} toolName - Nome da ferramenta
 * @property {number} timestamp - Unix ms do início da chamada
 * @property {number} durationMs - Duração em ms
 * @property {boolean} success - Se a chamada foi bem-sucedida
 * @property {string} [error] - Mensagem de erro (se success=false)
 * @property {string} [sessionId] - ID da sessão associada
 */

/**
 * @typedef {object} SessionRecord
 * @property {string} sessionId - ID da sessão
 * @property {number} startedAt - Unix ms de início
 * @property {number} [endedAt] - Unix ms de encerramento (undefined = ativa)
 * @property {'active' | 'ended' | 'error'} status - Status da sessão
 * @property {string} [error] - Mensagem de erro se status='error'
 */

/**
 * @typedef {object} TelemetryStore
 * @property {ToolCallRecord[]} toolCalls - Histórico de chamadas de ferramentas
 * @property {SessionRecord[]} sessions - Histórico de sessões
 * @property {number} maxRecords - Máximo de registros por categoria (circular buffer)
 */

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Cria um novo store de telemetria.
 *
 * @param {object} [opts={}] Default is `{}`
 * @param {number} [opts.maxRecords=500] Limite de registros para evitar memory leak. Default is `500`
 * @returns {TelemetryStore}
 */
export function createTelemetry(opts = {}) {
    const { maxRecords = 500 } = opts;
    return { toolCalls: [], sessions: [], maxRecords };
}

// ─── Ferramentas ─────────────────────────────────────────────────────────────

/**
 * Registra a chamada de uma ferramenta no store.
 *
 * @param {TelemetryStore} store
 * @param {string} toolName
 * @param {object} data
 * @param {number} data.durationMs - Duração da chamada em ms
 * @param {boolean} data.success - Se a chamada foi bem-sucedida
 * @param {string} [data.error] - Mensagem de erro
 * @param {string} [data.sessionId] - ID da sessão
 * @param {number} [data.timestamp] - Timestamp customizado (padrão: Date.now())
 * @returns {void}
 * @throws {Error} Se toolName for inválido
 */
export function recordToolCall(store, toolName, data) {
    if (!toolName || typeof toolName !== 'string')
        throw new Error('[lib/telemetry] recordToolCall: toolName (string) é obrigatório.');

    /** @type {ToolCallRecord} */
    const record = {
        toolName,
        timestamp: data.timestamp ?? Date.now(),
        durationMs: data.durationMs,
        success: data.success,
    };

    if (data.error !== undefined) record.error = data.error;
    if (data.sessionId !== undefined) record.sessionId = data.sessionId;

    store.toolCalls.push(record);

    // Circular buffer — descarta registros mais antigos
    if (store.toolCalls.length > store.maxRecords) {
        store.toolCalls.shift();
    }
}

// ─── Sessões ──────────────────────────────────────────────────────────────────

/**
 * Registra o início de uma sessão.
 *
 * @param {TelemetryStore} store
 * @param {string} sessionId
 * @param {object} [opts={}] Default is `{}`
 * @param {number} [opts.startedAt] - Timestamp customizado. Default is `Date.now()`
 * @returns {void}
 * @throws {Error} Se sessionId for inválido
 */
export function recordSessionStart(store, sessionId, opts = {}) {
    if (!sessionId || typeof sessionId !== 'string')
        throw new Error('[lib/telemetry] recordSessionStart: sessionId (string) é obrigatório.');

    store.sessions.push({
        sessionId,
        startedAt: opts.startedAt ?? Date.now(),
        status: 'active',
    });

    if (store.sessions.length > store.maxRecords) {
        store.sessions.shift();
    }
}

/**
 * Registra o encerramento de uma sessão.
 *
 * @param {TelemetryStore} store
 * @param {string} sessionId
 * @param {object} [opts={}] Default is `{}`
 * @param {number} [opts.endedAt] - Timestamp de término. Default is `Date.now()`
 * @param {'ended' | 'error'} [opts.status='ended'] - Status final. Default is `'ended'`
 * @param {string} [opts.error] - Mensagem de erro se status='error'
 * @returns {boolean} true se a sessão foi encontrada e atualizada, false se não existia
 */
export function recordSessionEnd(store, sessionId, opts = {}) {
    const rec = store.sessions.findLast((s) => s.sessionId === sessionId && s.status === 'active');
    if (!rec) return false;

    rec.endedAt = opts.endedAt ?? Date.now();
    rec.status = opts.status ?? 'ended';
    if (opts.error !== undefined) rec.error = opts.error;
    return true;
}

// ─── Consultas ────────────────────────────────────────────────────────────────

/**
 * Retorna o número total de chamadas de ferramentas registradas.
 *
 * @param {TelemetryStore} store
 * @returns {number}
 */
export function getTotalCalls(store) {
    return store.toolCalls.length;
}

/**
 * Retorna o número de chamadas bem-sucedidas.
 *
 * @param {TelemetryStore} store
 * @returns {number}
 */
export function getSuccessCount(store) {
    return store.toolCalls.filter((r) => r.success).length;
}

/**
 * Retorna o número de chamadas com erro.
 *
 * @param {TelemetryStore} store
 * @returns {number}
 */
export function getErrorCount(store) {
    return store.toolCalls.filter((r) => !r.success).length;
}

/**
 * Retorna a duração média das chamadas em ms. Retorna 0 se não há chamadas.
 *
 * @param {TelemetryStore} store
 * @returns {number}
 */
export function getAverageDuration(store) {
    if (store.toolCalls.length === 0) return 0;
    const total = store.toolCalls.reduce((acc, r) => acc + r.durationMs, 0);
    return total / store.toolCalls.length;
}

/**
 * Retorna chamadas de uma ferramenta específica.
 *
 * @param {TelemetryStore} store
 * @param {string} toolName
 * @returns {ToolCallRecord[]}
 */
export function getCallsByTool(store, toolName) {
    return store.toolCalls.filter((r) => r.toolName === toolName);
}

/**
 * Retorna chamadas de uma sessão específica.
 *
 * @param {TelemetryStore} store
 * @param {string} sessionId
 * @returns {ToolCallRecord[]}
 */
export function getCallsBySession(store, sessionId) {
    return store.toolCalls.filter((r) => r.sessionId === sessionId);
}

/**
 * Retorna as N chamadas mais recentes.
 *
 * @param {TelemetryStore} store
 * @param {number} [n=10] Default is `10`
 * @returns {ToolCallRecord[]}
 */
export function getRecentCalls(store, n = 10) {
    return store.toolCalls.slice(-n);
}

/**
 * Retorna apenas as chamadas com erro.
 *
 * @param {TelemetryStore} store
 * @returns {ToolCallRecord[]}
 */
export function getErrorCalls(store) {
    return store.toolCalls.filter((r) => !r.success);
}

// ─── Sumário ──────────────────────────────────────────────────────────────────

/**
 * Retorna um sumário agregado do store (útil para healthcheck e debug).
 *
 * @param {TelemetryStore} store
 * @returns {{
 *     totalCalls: number;
 *     successCalls: number;
 *     errorCalls: number;
 *     averageDurationMs: number;
 *     activeSessions: number;
 *     totalSessions: number;
 *     topTools: { toolName: string; count: number }[];
 * }}
 */
export function getSummary(store) {
    const totalCalls = store.toolCalls.length;
    const successCalls = getSuccessCount(store);
    const errorCalls = getErrorCount(store);
    const averageDurationMs = getAverageDuration(store);
    const activeSessions = store.sessions.filter((s) => s.status === 'active').length;
    const totalSessions = store.sessions.length;

    // Contar por ferramenta
    /** @type {Record<string, number>} */
    const counts = {};
    for (const r of store.toolCalls) {
        counts[r.toolName] = (counts[r.toolName] ?? 0) + 1;
    }
    const topTools = Object.entries(counts)
        .map(([toolName, count]) => ({ toolName, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

    return { totalCalls, successCalls, errorCalls, averageDurationMs, activeSessions, totalSessions, topTools };
}

// ─── Reset ───────────────────────────────────────────────────────────────────

/**
 * Limpa todos os registros do store (útil para testes).
 *
 * @param {TelemetryStore} store
 * @returns {void}
 */
export function clearTelemetry(store) {
    store.toolCalls.length = 0;
    store.sessions.length = 0;
}
