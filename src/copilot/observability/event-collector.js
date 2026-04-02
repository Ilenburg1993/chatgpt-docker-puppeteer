// @ts-check
/**
 * src/copilot/observability/event-collector.js
 *
 * Captura sistemática de eventos da sessão Copilot SDK para telemetria, observabilidade e persistência.
 *
 * O SDK emite 70+ tipos de eventos via `session.on()`. Este módulo:
 *
 * - Registra handlers para os eventos de maior valor (tool calls, tokens, erros, sessão)
 * - Alimenta o TelemetryStore com dados de execução
 * - Re-emite eventos no HookBus para SSE em tempo real
 * - Persiste eventos de alto valor em `src/copilot/logs/events.jsonl` (assíncrono)
 * - Rastreia pendings de tool calls para calcular latência
 *
 * Uso: const collector = createEventCollector({ telemetry, hookBus }); const unsubs = collector.attach(session,
 * sessionId); // Ao encerrar a sessão: unsubs.forEach(u => u());
 *
 * @module copilot/observability/event-collector
 */

import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from './logger.js';

// ─── Paths ────────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = process.env['COPILOT_LOG_DIR']
    ? path.resolve(process.env['COPILOT_LOG_DIR'])
    : path.resolve(__dirname, '../logs');
const EVENTS_FILE = path.join(LOGS_DIR, 'events.jsonl');
const MAX_EVENTS_BYTES = Number(process.env['COPILOT_EVENTS_MAX_BYTES']) || 5 * 1024 * 1024; // 5 MB

// ─── Fila de escrita assíncrona ───────────────────────────────────────────────

/** @type {string[]} */
const _writeQueue = [];
let _flushScheduled = false;

/**
 * Agenda flush assíncrono de eventos para disco.
 *
 * @returns {void}
 */
function scheduleFlush() {
    if (_flushScheduled) return;
    _flushScheduled = true;
    setImmediate(async () => {
        _flushScheduled = false;
        const batch = _writeQueue.splice(0);
        if (!batch.length) return;
        try {
            await mkdir(LOGS_DIR, { recursive: true });
            await appendFile(EVENTS_FILE, batch.join(''), 'utf8');
        } catch {
            // Falha silenciosa — telemetria não deve bloquear
        }
    });
}

/**
 * Persiste um evento em events.jsonl (filtragem por max bytes é simplificada — sem rotação aqui).
 *
 * @param {Record<string, unknown>} entry
 * @returns {void}
 */
function persistEvent(entry) {
    _writeQueue.push(JSON.stringify({ _collected: new Date().toISOString(), ...entry }) + '\n');
    scheduleFlush();
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

/**
 * @typedef {import('#copilot/lib/telemetry').TelemetryStore} TelemetryStore
 *
 * @typedef {import('#copilot/hooks/bus').HookBus} HookBus
 *
 * @typedef {import('./metrics.js').MetricsStore} MetricsStore
 *
 * @typedef {import('./error-tracker.js').ErrorTracker} ErrorTracker
 */

/**
 * @typedef {object} EventCollectorOptions
 * @property {MetricsStore | null} [metrics] - Store de métricas para alimentar contadores e histogramas.
 * @property {ErrorTracker | null} [errorTracker] - Tracker para erros de sessão SDK.
 * @property {HookBus | null} [hookBus] - Bus para re-emitir eventos como hooks (opcional).
 * @property {boolean} [persist] - Se true, persiste eventos relevantes em events.jsonl (padrão: true).
 * @property {readonly string[]} [persistTypes] - Tipos de eventos a persistir (padrão: lista canônica).
 */

/**
 * @typedef {object} EventCollector
 * @property {(session: import('@github/copilot-sdk').CopilotSession, sessionId: string) => (() => void)[]} attach
 *
 *   - Registra handlers na sessão e retorna lista de unsubscribers.
 */

// ─── Tipos globais de máxima relevância para telemetria ──────────────────────

const DEFAULT_PERSIST_TYPES = Object.freeze([
    'tool.execution_start',
    'tool.execution_complete',
    'assistant.usage',
    'session.usage_info',
    'session.error',
    'session.truncation',
    'session.compaction_start',
    'session.compaction_complete',
    'permission.requested',
    'permission.completed',
    'hook.start',
    'hook.end',
    'session.task_complete',
    'assistant.turn_end',
    'session.shutdown',
    'session.info',
    'skill.invoked',
    'subagent.completed',
    'subagent.failed',
]);

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Cria um EventCollector configurado.
 *
 * @example
 *     const collector = createEventCollector({ telemetry, hookBus: defaultBus });
 *     const unsubs = collector.attach(session, sessionId);
 *
 * @param {EventCollectorOptions} [opts={}] Default is `{}`
 * @returns {EventCollector}
 */
export function createEventCollector(opts = {}) {
    const {
        metrics = null,
        errorTracker = null,
        hookBus = null,
        persist = true,
        persistTypes = DEFAULT_PERSIST_TYPES,
    } = opts;

    /**
     * Mapa de toolCallId → { toolName, startTs } para calcular latência.
     *
     * @type {Map<string, { toolName: string; mcpServerName: string | null; startTs: number }>}
     */
    const _pending = new Map();

    /**
     * Registra handlers nos eventos da sessão SDK e retorna lista de unsubscribers.
     *
     * @param {import('@github/copilot-sdk').CopilotSession} session - Sessão SDK ativa.
     * @param {string} sessionId - ID da sessão (para context em logs e eventos).
     * @returns {(() => void)[]} Lista de funções de unsubscribe para cleanup.
     */
    function attach(session, sessionId) {
        /** @type {(() => void)[]} */
        const unsubs = [];

        // ── tool.execution_start ──────────────────────────────────────────────
        unsubs.push(
            session.on('tool.execution_start', (event) => {
                const { toolCallId, toolName, mcpServerName } = event.data;
                _pending.set(toolCallId, {
                    toolName,
                    mcpServerName: mcpServerName ?? null,
                    startTs: Date.now(),
                });
                if (persist && persistTypes.includes('tool.execution_start')) {
                    persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
                }
            }),
        );

        // ── tool.execution_complete ───────────────────────────────────────────
        unsubs.push(
            session.on('tool.execution_complete', (event) => {
                const { toolCallId, success } = event.data;
                const pending = _pending.get(toolCallId);
                _pending.delete(toolCallId);
                const durationMs = pending ? Date.now() - pending.startTs : 0;
                const toolName = pending?.toolName ?? toolCallId;

                // Alimentar MetricsStore com latência e contadores
                metrics?.recordToolCall(toolName, durationMs, success);

                // Re-emitir no HookBus
                hookBus?.emitHook('post_tool_use', sessionId, { toolName, success }, { durationMs });

                if (persist && persistTypes.includes('tool.execution_complete')) {
                    persistEvent({
                        type: event.type,
                        sessionId,
                        ts: event.timestamp,
                        toolName,
                        durationMs,
                        success: event.data.success,
                    });
                }

                log(
                    'DEBUG',
                    `[event-collector] tool.execution_complete: ${toolName} (${durationMs}ms, ${success ? 'ok' : 'err'}) session=${sessionId}`,
                );
            }),
        );

        // ── assistant.usage (tokens) ──────────────────────────────────────────
        unsubs.push(
            session.on('assistant.usage', (event) => {
                const { model, inputTokens, outputTokens, duration } = event.data;

                // Alimentar MetricsStore com token usage por modelo
                metrics?.recordUsage(model ?? 'unknown', inputTokens ?? 0, outputTokens ?? 0);

                if (persist && persistTypes.includes('assistant.usage')) {
                    persistEvent({
                        type: event.type,
                        sessionId,
                        ts: event.timestamp,
                        model,
                        inputTokens,
                        outputTokens,
                        duration,
                    });
                }
                hookBus?.emitHook(
                    'post_tool_use',
                    sessionId,
                    { _eventType: 'assistant.usage', model, inputTokens, outputTokens },
                    null,
                );
                log(
                    'DEBUG',
                    `[event-collector] assistant.usage: model=${model} in=${inputTokens ?? 0} out=${outputTokens ?? 0} session=${sessionId}`,
                );
            }),
        );

        // ── session.error ─────────────────────────────────────────────────────
        unsubs.push(
            session.on('session.error', (event) => {
                const { errorType, message } = event.data;

                // Alimentar ErrorTracker com contexto de sessão
                errorTracker?.trackError(new Error(message ?? String(errorType)), {
                    source: 'sdk:session.error',
                    sessionId,
                    metadata: { errorType },
                });

                metrics?.recordSessionError();

                if (persist && persistTypes.includes('session.error')) {
                    persistEvent({ type: event.type, sessionId, ts: event.timestamp, errorType, message });
                }
                log('WARN', `[event-collector] session.error: type=${errorType} msg=${message} session=${sessionId}`);
            }),
        );

        // ── session.usage_info ────────────────────────────────────────────────
        unsubs.push(
            session.on('session.usage_info', (event) => {
                if (persist && persistTypes.includes('session.usage_info')) {
                    persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
                }
            }),
        );

        // ── session.truncation ────────────────────────────────────────────────
        unsubs.push(
            session.on('session.truncation', (event) => {
                if (persist && persistTypes.includes('session.truncation')) {
                    persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
                }
                log('INFO', `[event-collector] session.truncation: session=${sessionId}`);
            }),
        );

        // ── session.compaction_start / complete ───────────────────────────────
        unsubs.push(
            session.on('session.compaction_start', (event) => {
                if (persist) persistEvent({ type: event.type, sessionId, ts: event.timestamp });
                log('INFO', `[event-collector] compaction_start session=${sessionId}`);
            }),
        );
        unsubs.push(
            session.on('session.compaction_complete', (event) => {
                if (persist) persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
                log('INFO', `[event-collector] compaction_complete session=${sessionId}`);
            }),
        );

        // ── permission.requested / completed ─────────────────────────────────
        unsubs.push(
            session.on('permission.requested', (event) => {
                if (persist && persistTypes.includes('permission.requested')) {
                    persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
                }
            }),
        );
        unsubs.push(
            session.on('permission.completed', (event) => {
                if (persist && persistTypes.includes('permission.completed')) {
                    persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
                }
            }),
        );

        // ── hook.start / hook.end ─────────────────────────────────────────────
        unsubs.push(
            session.on('hook.start', (event) => {
                if (persist) persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
            }),
        );
        unsubs.push(
            session.on('hook.end', (event) => {
                if (persist) persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
            }),
        );

        // ── session.task_complete ─────────────────────────────────────────────
        unsubs.push(
            session.on('session.task_complete', (event) => {
                if (persist) persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
                log('INFO', `[event-collector] session.task_complete session=${sessionId}`);
            }),
        );

        // ── skill.invoked ─────────────────────────────────────────────────────
        unsubs.push(
            session.on('skill.invoked', (event) => {
                if (persist) persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
            }),
        );

        // ── subagent.completed / failed ───────────────────────────────────────
        unsubs.push(
            session.on('subagent.completed', (event) => {
                if (persist) persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
            }),
        );
        unsubs.push(
            session.on('subagent.failed', (event) => {
                if (persist) persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
                log('WARN', `[event-collector] subagent.failed session=${sessionId}`);
            }),
        );

        log('DEBUG', `[event-collector] ${unsubs.length} handlers registrados para session=${sessionId}`);

        return unsubs;
    }

    return { attach };
}

// ─── Singleton default ────────────────────────────────────────────────────────

/** Instância default do event collector. Configurada via `initEventCollector()`. */
let _defaultCollector = createEventCollector({ persist: true });

/**
 * Inicializa o singleton defaultCollector com métricas, errorTracker e hookBus.
 *
 * Deve ser chamado uma vez no boot do agente, antes do primeiro `.attach()`.
 *
 * @param {EventCollectorOptions} opts
 * @returns {void}
 */
export function initEventCollector(opts) {
    _defaultCollector = createEventCollector(opts);
}

/**
 * Collector singleton — usar após `initEventCollector()`.
 *
 * @type {EventCollector}
 */
export const defaultEventCollector = {
    attach: (...args) => _defaultCollector.attach(...args),
};

/** Tamanho máximo do arquivo de eventos (bytes). */
export { MAX_EVENTS_BYTES };
