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
 * @see module:copilot/agent/tool-audit-logger
 * @see module:copilot/lib/session
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
 * @example
 *     const store = createTelemetry({ maxRecords: 100 });
 *     recordToolCall(store, 'read_file', { durationMs: 50, success: true });
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
 * Retorna as N chamadas mais recentes, opcionalmente filtradas por idade.
 *
 * @param {TelemetryStore} store
 * @param {number} [n=10] Default is `10`
 * @param {{ sinceMs?: number }} [opts] Filtrar apenas chamadas com no máximo `sinceMs` ms de idade
 * @returns {ToolCallRecord[]}
 */
export function getRecentCalls(store, n = 10, opts = {}) {
    let calls = store.toolCalls;
    if (opts.sinceMs != null) {
        const cutoff = Date.now() - opts.sinceMs;
        calls = calls.filter((r) => r.timestamp >= cutoff);
    }
    return calls.slice(-n);
}

/**
 * Retorna apenas as chamadas com erro, opcionalmente filtradas por idade.
 *
 * @param {TelemetryStore} store
 * @param {{ sinceMs?: number }} [opts] Filtrar apenas chamadas com no máximo `sinceMs` ms de idade
 * @returns {ToolCallRecord[]}
 */
export function getErrorCalls(store, opts = {}) {
    let calls = store.toolCalls.filter((r) => !r.success);
    if (opts.sinceMs != null) {
        const cutoff = Date.now() - opts.sinceMs;
        calls = calls.filter((r) => r.timestamp >= cutoff);
    }
    return calls;
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
 *     p95ByTool: Record<string, number>;
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

    // UPG-10: p95 de latência por tool para identificar tools lentas
    /** @type {Record<string, number[]>} */
    const durationsByTool = {};
    for (const r of store.toolCalls) {
        if (!durationsByTool[r.toolName]) durationsByTool[r.toolName] = [];
        const toolDurations = durationsByTool[r.toolName];
        if (toolDurations) toolDurations.push(r.durationMs);
    }
    /** @type {Record<string, number>} */
    const p95ByTool = {};
    for (const [toolName, durations] of Object.entries(durationsByTool)) {
        const sorted = [...durations].sort((a, b) => a - b);
        const idx = Math.floor(sorted.length * 0.95);
        p95ByTool[toolName] = sorted[idx] ?? sorted[sorted.length - 1] ?? 0;
    }

    return {
        totalCalls,
        successCalls,
        errorCalls,
        averageDurationMs,
        activeSessions,
        totalSessions,
        topTools,
        p95ByTool,
    };
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

// ─── AI.3 — OTEL spans (graceful degradation) ────────────────────────────────

/**
 * Atributos de contexto para um span OTEL.
 *
 * @typedef {object} SpanAttrs
 * @property {string} [sessionId] - ID da sessão
 * @property {string} [model] - Modelo utilizado
 * @property {string} [actor] - Ator (ex: 'llm-b', 'orchestrator')
 * @property {Record<string, unknown>} [extra] - Atributos adicionais
 */

/**
 * @typedef {object} OtelSpan
 * @property {(key: string, value: string | number | boolean) => void} setAttribute
 * @property {(status: { code: number; message?: string }) => void} setStatus
 * @property {(exception: unknown) => void} recordException
 * @property {() => void} end
 */

/**
 * @typedef {object} OtelTracer
 * @property {(name: string) => OtelSpan} startSpan
 */

/** @type {OtelTracer | null} Instância do tracer OTEL (null se não disponível) */
let _tracer = null;

/**
 * Inicializa o tracer OTEL de forma segura (graceful degradation). Tentativa única no primeiro uso. Se
 * `@opentelemetry/sdk-trace-node` não estiver instalado ou falhar, o sistema opera sem traces.
 *
 * @returns {Promise<OtelTracer | null>}
 */
async function getTracer() {
    if (_tracer !== null) return _tracer;
    try {
        // Importação dinâmica para degradação graciosa quando o pacote não está instalado
        // @ts-expect-error — @opentelemetry/sdk-trace-node é opcional; graceful degradation se não instalado
        const { NodeTracerProvider } = await import('@opentelemetry/sdk-trace-node');
        const { trace } = await import('@opentelemetry/api');
        const provider = new NodeTracerProvider();
        provider.register();
        _tracer = /** @type {OtelTracer} */ (/** @type {unknown} */ (trace.getTracer('copilot-agent', '1.0.0')));
        return _tracer;
    } catch {
        // Pacote não disponível — usar fallback de span no-op
        _tracer = null;
        return null;
    }
}

// BUG-MED-12 (fix): inicializar no carregamento do módulo para eliminar race condition teórica
// Dois calls síncronos a startSpan no mesmo tick poderiam criar dois providers paralelos.
/** @type {Promise<void>} */
const _tracerInitPromise = getTracer().then(() => undefined);

/**
 * AI.3 — Executa uma função dentro de um span OTEL, registrando latência e erros. Se OTEL não estiver disponível,
 * executa a função diretamente sem overhead. Propaga erros normalmente.
 *
 * @template T
 * @param {string} name - Nome do span (ex: 'session.create', 'dialog.sendTurn')
 * @param {SpanAttrs} attrs - Atributos de contexto do span
 * @param {() => Promise<T>} fn - Função a instrumentar
 * @returns {Promise<T>}
 */
export async function startSpan(name, attrs, fn) {
    // Aguarda a inicialização do tracer (singleton iniciado no carregamento do módulo)
    await _tracerInitPromise;

    if (!_tracer) {
        // Sem OTEL disponível — executa direto
        return fn();
    }

    try {
        const { context, trace } = await import('@opentelemetry/api');
        const span = _tracer.startSpan(name);
        span.setAttribute('session.id', attrs.sessionId ?? '');
        span.setAttribute('model', attrs.model ?? '');
        span.setAttribute('actor', attrs.actor ?? '');
        if (attrs.extra) {
            for (const [k, v] of Object.entries(attrs.extra)) {
                span.setAttribute(
                    k,
                    typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? v : JSON.stringify(v),
                );
            }
        }
        const ctx = trace.setSpan(context.active(), /** @type {any} */ (span));
        const start = Date.now();
        try {
            const result = await context.with(ctx, fn);
            span.setAttribute('duration_ms', Date.now() - start);
            span.setStatus({ code: /** SpanStatusCode.OK */ 1 });
            return result;
        } catch (/** @type {any} */ err) {
            span.setAttribute('duration_ms', Date.now() - start);
            span.setStatus({ code: /** SpanStatusCode.ERROR */ 2, message: err.message });
            span.recordException(err);
            throw err;
        } finally {
            span.end();
        }
    } catch {
        // Falha no próprio OTEL — não bloquear operação principal
        return fn();
    }
}
