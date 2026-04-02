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

import { globalAuditBuffer } from '#copilot/hooks/audit';
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
 * @typedef {import('./metrics.js').MetricsStore} TelemetryStore
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
 * @property {boolean} [captureUserContent] - Se true, persiste content de user.message (OFF por padrão — risco PII).
 * @property {boolean} [captureAssistantContent] - Se true, persiste conteúdo de assistant.message (OFF por padrão).
 */

/**
 * @typedef {{ toolName: string; mcpServerName: string | null; startTs: number; toolArgs: Record<string, unknown> }} PendingToolEntry
 *
 *
 * @typedef {{ turnId: string; startTs: number }} PendingTurnEntry
 */

/**
 * @typedef {object} EventCollector
 * @property {(session: import('@github/copilot-sdk').CopilotSession, sessionId: string) => (() => void)[]} attach
 *
 *   - Registra handlers na sessão e retorna lista de unsubscribers.
 */

// ─── Tipos globais de máxima relevância para telemetria ──────────────────────

const DEFAULT_PERSIST_TYPES = Object.freeze([
    // ── Tool calls ──────────────────────────────────────────────────────────
    'tool.execution_start',
    'tool.execution_complete',
    'tool.user_requested',
    // ── Assistant ───────────────────────────────────────────────────────────
    'assistant.usage',
    'assistant.turn_start',
    'assistant.turn_end',
    'assistant.message',
    'assistant.intent',
    // ── Usuário ─────────────────────────────────────────────────────────────
    'user.message',
    // ── Sessão ──────────────────────────────────────────────────────────────
    'session.start',
    'session.resume',
    'session.usage_info',
    'session.error',
    'session.truncation',
    'session.compaction_start',
    'session.compaction_complete',
    'session.tools_updated',
    'session.mcp_servers_loaded',
    'session.mode_changed',
    'session.model_change',
    'session.plan_changed',
    'session.background_tasks_changed',
    'session.workspace_file_changed',
    'session.context_changed',
    'session.handoff',
    'session.skills_loaded',
    'session.extensions_loaded',
    'session.mcp_server_status_changed',
    // ── Permissões, hooks, interações ──────────────────────────────────────
    'permission.requested',
    'permission.completed',
    'elicitation.requested',
    'elicitation.completed',
    'user_input.requested',
    'user_input.completed',
    'hook.start',
    'hook.end',
    'session.task_complete',
    'session.shutdown',
    'session.info',
    'session.warning',
    'skill.invoked',
    // ── Sub-agentes ─────────────────────────────────────────────────────────
    'subagent.started',
    'subagent.completed',
    'subagent.failed',
    'subagent.selected',
    'subagent.deselected',
    // ── MCP / OAuth ─────────────────────────────────────────────────────────
    'mcp.oauth_required',
    'mcp.oauth_completed',
    // ── External tools / Comandos / Plan mode ──────────────────────────────
    'external_tool.requested',
    'external_tool.completed',
    'command.execute',
    'command.queued',
    'command.completed',
    'exit_plan_mode.requested',
    'exit_plan_mode.completed',
    // ── Fase BF: novos tipos ────────────────────────────────────────────────
    'assistant.reasoning',
    'session.title_changed',
    'session.workspace_file_changed',
    'system.message',
    // ── Aborto ──────────────────────────────────────────────────────────────
    'abort',
    // ── Sistema ─────────────────────────────────────────────────────────────
    'system.notification',
    // ── Fase BH: rewind e snapshot_rewind ──────────────────────────────────
    'session.snapshot_rewind',
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
        captureUserContent = false,
        captureAssistantContent = false,
    } = opts;

    /**
     * Mapa de toolCallId → entrada pendente com toolName, mcpServerName, startTs e toolArgs capturados de
     * `tool.execution_start` para uso em `tool.execution_complete`.
     *
     * @type {Map<string, PendingToolEntry>}
     */
    const _pending = new Map();

    /**
     * Mapa de turnId → startTs para calcular duração do turno em `assistant.turn_end`.
     *
     * @type {Map<string, number>}
     */
    const _turnStart = new Map();

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
                // Fase AN: preservar arguments para uso no execution_complete
                _pending.set(toolCallId, {
                    toolName,
                    mcpServerName: mcpServerName ?? null,
                    startTs: Date.now(),
                    toolArgs: /** @type {Record<string, unknown>} */ (event.data.arguments ?? {}),
                });
                if (persist && persistTypes.includes('tool.execution_start')) {
                    persistEvent({
                        type: event.type,
                        sessionId,
                        ts: event.timestamp,
                        toolName,
                        toolCallId,
                        mcpServerName: mcpServerName ?? null,
                        toolArgs: event.data.arguments ?? {},
                        parentToolCallId: event.data.parentToolCallId ?? null,
                    });
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

                // Fase AN: usar toolArgs reais capturados em execution_start
                globalAuditBuffer.push({
                    toolName,
                    toolArgs: pending?.toolArgs ?? {},
                    toolResult: event.data.result?.content ?? null,
                    sessionId,
                    ts: event.timestamp ?? new Date().toISOString(),
                    durationMs,
                });

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

        // ── assistant.usage (tokens + quota + cost) — Fase AO ────────────────
        unsubs.push(
            session.on('assistant.usage', (event) => {
                const {
                    model,
                    inputTokens,
                    outputTokens,
                    cacheReadTokens,
                    cacheWriteTokens,
                    duration,
                    cost,
                    reasoningEffort,
                    initiator,
                    apiCallId,
                    providerCallId,
                    parentToolCallId,
                    quotaSnapshots,
                    copilotUsage,
                } = event.data;

                // Alimentar MetricsStore com token usage por modelo (incluindo cache tokens)
                metrics?.recordUsage(
                    model ?? 'unknown',
                    inputTokens ?? 0,
                    outputTokens ?? 0,
                    cacheReadTokens ?? 0,
                    cacheWriteTokens ?? 0,
                );

                // Fase AO.3: rastrear reasoning effort por distribuição
                if (reasoningEffort) {
                    metrics?.recordCounter(`reasoning.effort.${reasoningEffort}`);
                }

                // Fase AO.2: alerta de quota baixa (< 10% restante)
                if (quotaSnapshots) {
                    for (const [quotaId, snapshot] of Object.entries(quotaSnapshots)) {
                        if (snapshot.remainingPercentage < 0.1) {
                            metrics?.recordCounter('quota.low_warning');
                            log(
                                'WARN',
                                `[event-collector] quota baixa: quotaId=${quotaId} remaining=${(snapshot.remainingPercentage * 100).toFixed(1)}% resetDate=${snapshot.resetDate ?? 'n/a'} session=${sessionId}`,
                            );
                        }
                    }
                }

                if (persist && persistTypes.includes('assistant.usage')) {
                    persistEvent({
                        type: event.type,
                        sessionId,
                        ts: event.timestamp,
                        model,
                        inputTokens,
                        outputTokens,
                        cacheReadTokens,
                        cacheWriteTokens,
                        duration,
                        cost,
                        reasoningEffort,
                        initiator,
                        apiCallId,
                        providerCallId,
                        parentToolCallId,
                        quotaSnapshots,
                        totalNanoAiu: copilotUsage?.totalNanoAiu ?? null,
                    });
                }
                hookBus?.emitHook(
                    'post_tool_use',
                    sessionId,
                    {
                        _eventType: 'assistant.usage',
                        model,
                        inputTokens,
                        outputTokens,
                        cacheReadTokens,
                        cacheWriteTokens,
                    },
                    null,
                );
                log(
                    'DEBUG',
                    `[event-collector] assistant.usage: model=${model} in=${inputTokens ?? 0} out=${outputTokens ?? 0} cacheR=${cacheReadTokens ?? 0} cacheW=${cacheWriteTokens ?? 0} cost=${cost ?? 'n/a'} effort=${reasoningEffort ?? 'n/a'} session=${sessionId}`,
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

        // ── session.tools_updated / mcp_servers_loaded ────────────────────────
        unsubs.push(
            session.on('session.tools_updated', (event) => {
                if (persist) persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
                log('DEBUG', `[event-collector] session.tools_updated session=${sessionId}`);
            }),
        );
        unsubs.push(
            session.on('session.mcp_servers_loaded', (event) => {
                if (persist) persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
                log('DEBUG', `[event-collector] session.mcp_servers_loaded session=${sessionId}`);
            }),
        );

        // ── session.mode_changed / model_change / plan_changed ────────────────
        unsubs.push(
            session.on('session.mode_changed', (event) => {
                if (persist) persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
                log('INFO', `[event-collector] session.mode_changed session=${sessionId}`);
            }),
        );
        unsubs.push(
            session.on('session.model_change', (event) => {
                if (persist) persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
                log('INFO', `[event-collector] session.model_change session=${sessionId}`);
            }),
        );
        unsubs.push(
            session.on('session.plan_changed', (event) => {
                if (persist) persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
            }),
        );

        // ── session.background_tasks_changed ─────────────────────────────────
        unsubs.push(
            session.on('session.background_tasks_changed', (event) => {
                if (persist) persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
            }),
        );

        // ── session.warning / session.idle / session.shutdown ─────────────────
        unsubs.push(
            session.on('session.warning', (event) => {
                if (persist) persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
                log('WARN', `[event-collector] session.warning session=${sessionId}`);
            }),
        );
        unsubs.push(
            session.on('session.idle', (event) => {
                if (persist) persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
                log('DEBUG', `[event-collector] session.idle session=${sessionId}`);
            }),
        );
        unsubs.push(
            session.on('session.shutdown', (event) => {
                if (persist) persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
                log('INFO', `[event-collector] session.shutdown session=${sessionId}`);
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

        // ── subagent.started / completed / failed / deselected ────────────────
        unsubs.push(
            session.on('subagent.started', (event) => {
                metrics?.recordCounter('subagent.started');
                if (persist) persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
                log('DEBUG', `[event-collector] subagent.started session=${sessionId}`);
            }),
        );
        unsubs.push(
            session.on('subagent.completed', (event) => {
                metrics?.recordCounter('subagent.completed');
                if (persist) persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
            }),
        );
        unsubs.push(
            session.on('subagent.failed', (event) => {
                metrics?.recordCounter('subagent.failed');
                if (persist) persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
                log('WARN', `[event-collector] subagent.failed session=${sessionId}`);
            }),
        );
        unsubs.push(
            session.on('subagent.deselected', (event) => {
                metrics?.recordCounter('subagent.deselected');
                if (persist) persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
            }),
        );

        // ── elicitation.requested / completed ────────────────────────────────
        unsubs.push(
            session.on('elicitation.requested', (event) => {
                metrics?.recordCounter('elicitation.requested');
                if (persist && persistTypes.includes('elicitation.requested')) {
                    persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
                }
                log('DEBUG', `[event-collector] elicitation.requested session=${sessionId}`);
            }),
        );
        unsubs.push(
            session.on('elicitation.completed', (event) => {
                metrics?.recordCounter('elicitation.completed');
                if (persist && persistTypes.includes('elicitation.completed')) {
                    persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
                }
            }),
        );

        // ── user_input.requested / completed ────────────────────────────────
        unsubs.push(
            session.on('user_input.requested', (event) => {
                metrics?.recordCounter('user_input.requested');
                if (persist && persistTypes.includes('user_input.requested')) {
                    persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
                }
            }),
        );
        unsubs.push(
            session.on('user_input.completed', (event) => {
                metrics?.recordCounter('user_input.completed');
                if (persist && persistTypes.includes('user_input.completed')) {
                    persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
                }
            }),
        );

        // ── tool.execution_progress (ephemeral — não persistir) ──────────────
        unsubs.push(
            session.on('tool.execution_progress', (event) => {
                // Evento efêmero de progresso — emitido pelo hookBus para SSE sem persistência
                hookBus?.emitHook(
                    'post_tool_use',
                    sessionId,
                    {
                        _eventType: 'tool.execution_progress',
                        toolCallId: event.data.toolCallId,
                        progressMessage: event.data.progressMessage,
                    },
                    null,
                );
            }),
        );

        // ── assistant.turn_start / turn_end — Fase AR.2 ──────────────────────
        unsubs.push(
            session.on('assistant.turn_start', (event) => {
                const { turnId } = event.data;
                if (turnId) _turnStart.set(turnId, Date.now());
                if (persist) persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
            }),
        );

        // Fase AR.2: turn_end calcula duração correlacionando com turn_start
        unsubs.push(
            session.on('assistant.turn_end', (event) => {
                const { turnId } = event.data;
                const startTs = turnId ? _turnStart.get(turnId) : undefined;
                if (turnId) _turnStart.delete(turnId);
                const durationMs = startTs ? Date.now() - startTs : 0;
                metrics?.recordDialogTurn(durationMs, true);
                if (persist && persistTypes.includes('assistant.turn_end')) {
                    persistEvent({ type: event.type, sessionId, ts: event.timestamp, turnId, durationMs });
                }
                log('DEBUG', `[event-collector] turn_end: ${turnId ?? 'n/a'} (${durationMs}ms) session=${sessionId}`);
            }),
        );

        // ── assistant.message + intent — Fase AQ.2 / AQ.3 ───────────────────
        unsubs.push(
            session.on('assistant.message', (event) => {
                const { messageId, content } = event.data;
                metrics?.recordCounter('assistant.message');
                if (persist && persistTypes.includes('assistant.message')) {
                    persistEvent({
                        type: event.type,
                        sessionId,
                        ts: event.timestamp,
                        messageId,
                        // captureAssistantContent=false por padrão (não persiste conteúdo completo)
                        ...(captureAssistantContent ? { content } : { contentLength: content?.length ?? 0 }),
                    });
                }
            }),
        );

        unsubs.push(
            session.on('assistant.intent', (event) => {
                const { intent } = event.data;
                metrics?.recordCounter(`assistant.intent.${intent ?? 'unknown'}`);
                if (persist && persistTypes.includes('assistant.intent')) {
                    persistEvent({ type: event.type, sessionId, ts: event.timestamp, intent });
                }
            }),
        );

        // ── user.message — Fase AQ.1 ─────────────────────────────────────────
        unsubs.push(
            session.on('user.message', (event) => {
                const { content, attachments } = event.data;
                metrics?.recordCounter('user.message');
                if ((attachments?.length ?? 0) > 0) {
                    metrics?.recordCounter('user.message.with_attachments');
                }
                if (persist && persistTypes.includes('user.message')) {
                    persistEvent({
                        type: event.type,
                        sessionId,
                        ts: event.timestamp,
                        // captureUserContent=false por padrão (não persiste conteúdo — risco PII)
                        ...(captureUserContent ? { content } : { contentLength: content?.length ?? 0 }),
                        attachmentCount: attachments?.length ?? 0,
                        attachmentTypes:
                            attachments?.map((/** @type {{ type?: string }} */ a) => a.type ?? 'unknown') ?? [],
                    });
                }
            }),
        );

        // ── abort — Fase AR.1 ─────────────────────────────────────────────────
        unsubs.push(
            session.on('abort', (event) => {
                metrics?.recordCounter('turn.aborted');
                metrics?.recordSessionError();
                if (persist && persistTypes.includes('abort')) {
                    persistEvent({ type: event.type, sessionId, ts: event.timestamp, reason: event.data.reason });
                }
                log('WARN', `[event-collector] turn aborted: ${event.data.reason ?? 'unknown'} session=${sessionId}`);
            }),
        );

        // ── session.start / resume — Fase AP ─────────────────────────────────
        unsubs.push(
            session.on('session.start', (event) => {
                const { sessionId: sdkSessionId, copilotVersion, selectedModel, reasoningEffort, context } = event.data;
                metrics?.recordSessionStart();
                metrics?.recordCounter(`model.${selectedModel ?? 'unknown'}`);
                if (persist && persistTypes.includes('session.start')) {
                    persistEvent({
                        type: event.type,
                        sessionId,
                        ts: event.timestamp,
                        sdkSessionId,
                        copilotVersion,
                        selectedModel,
                        reasoningEffort,
                        context,
                    });
                }
                log(
                    'INFO',
                    `[event-collector] session.start model=${selectedModel ?? 'n/a'} branch=${context?.branch ?? 'n/a'} session=${sessionId}`,
                );
            }),
        );

        unsubs.push(
            session.on('session.resume', (event) => {
                const { eventCount, selectedModel, reasoningEffort, context, alreadyInUse } = event.data;
                metrics?.recordCounter('session.resumed');
                if (alreadyInUse) metrics?.recordCounter('session.already_in_use');
                if (persist && persistTypes.includes('session.resume')) {
                    persistEvent({
                        type: event.type,
                        sessionId,
                        ts: event.timestamp,
                        eventCount,
                        selectedModel,
                        reasoningEffort,
                        alreadyInUse,
                        context,
                    });
                }
                log(
                    'INFO',
                    `[event-collector] session.resume eventCount=${eventCount ?? 0} alreadyInUse=${alreadyInUse ?? false} session=${sessionId}`,
                );
            }),
        );

        // ── session.context_changed + session.handoff — Fase AT ──────────────
        unsubs.push(
            session.on('session.context_changed', (event) => {
                const { branch, repository, cwd } = event.data;
                if (persist && persistTypes.includes('session.context_changed')) {
                    persistEvent({
                        type: event.type,
                        sessionId,
                        ts: event.timestamp,
                        branch: branch ?? null,
                        repository: repository ?? null,
                        cwd: cwd ?? null,
                    });
                }
                log('INFO', `[event-collector] context_changed branch=${branch ?? 'n/a'} session=${sessionId}`);
            }),
        );

        unsubs.push(
            session.on('session.handoff', (event) => {
                const { handoffTime, sourceType, summary, remoteSessionId } = event.data;
                metrics?.recordCounter('session.handoff');
                metrics?.recordCounter(`session.handoff.source.${sourceType ?? 'unknown'}`);
                if (persist && persistTypes.includes('session.handoff')) {
                    persistEvent({
                        type: event.type,
                        sessionId,
                        ts: event.timestamp,
                        handoffTime,
                        sourceType,
                        summary: summary ?? null,
                        remoteSessionId: remoteSessionId ?? null,
                    });
                }
                log('INFO', `[event-collector] session.handoff source=${sourceType} session=${sessionId}`);
            }),
        );

        // ── session.skills_loaded + extensions_loaded — Fase AU ──────────────
        unsubs.push(
            session.on('session.skills_loaded', (event) => {
                const { skills } = event.data;
                const enabledCount = skills.filter((/** @type {{ enabled?: boolean }} */ s) => s.enabled).length;
                metrics?.recordCounter('session.skills_loaded');
                metrics?.recordCounter('skills.enabled', enabledCount);
                if (persist && persistTypes.includes('session.skills_loaded')) {
                    persistEvent({
                        type: event.type,
                        sessionId,
                        ts: event.timestamp,
                        totalSkills: skills.length,
                        enabledSkills: enabledCount,
                        skills: skills.map(
                            (/** @type {{ name?: string; enabled?: boolean; source?: string }} */ s) => ({
                                name: s.name,
                                enabled: s.enabled,
                                source: s.source,
                            }),
                        ),
                    });
                }
                log(
                    'INFO',
                    `[event-collector] skills_loaded: ${enabledCount}/${skills.length} enabled session=${sessionId}`,
                );
            }),
        );

        unsubs.push(
            session.on('session.extensions_loaded', (event) => {
                const { extensions } = event.data;
                const runningCount = extensions.filter(
                    (/** @type {{ status?: string }} */ e) => e.status === 'running',
                ).length;
                if (persist && persistTypes.includes('session.extensions_loaded')) {
                    persistEvent({
                        type: event.type,
                        sessionId,
                        ts: event.timestamp,
                        total: extensions.length,
                        running: runningCount,
                        extensions: extensions.map((/** @type {{ id?: string; status?: string }} */ e) => ({
                            id: e.id,
                            status: e.status,
                        })),
                    });
                }
                log(
                    'INFO',
                    `[event-collector] extensions_loaded: ${runningCount}/${extensions.length} running session=${sessionId}`,
                );
            }),
        );

        // ── session.mcp_server_status_changed — Fase AV ──────────────────────
        unsubs.push(
            session.on('session.mcp_server_status_changed', (event) => {
                const { serverName, status } = event.data;
                metrics?.recordCounter(`mcp.server.status.${status}`);
                if (status === 'failed') {
                    metrics?.recordCounter('mcp.server.failed');
                    log('WARN', `[event-collector] MCP server failed: ${serverName} session=${sessionId}`);
                } else if (status === 'connected') {
                    metrics?.recordCounter('mcp.server.connected');
                    log('INFO', `[event-collector] MCP server connected: ${serverName} session=${sessionId}`);
                }
                if (persist && persistTypes.includes('session.mcp_server_status_changed')) {
                    persistEvent({ type: event.type, sessionId, ts: event.timestamp, serverName, status });
                }
            }),
        );

        // ── tool.user_requested — Fase AW (alto valor) ───────────────────────
        unsubs.push(
            session.on('tool.user_requested', (event) => {
                const { toolCallId, toolName } = event.data;
                metrics?.recordCounter('tool.user_requested');
                if (persist && persistTypes.includes('tool.user_requested')) {
                    persistEvent({
                        type: event.type,
                        sessionId,
                        ts: event.timestamp,
                        toolCallId,
                        toolName,
                        toolArgs: event.data.arguments ?? {},
                    });
                }
                log('DEBUG', `[event-collector] tool.user_requested: ${toolName} session=${sessionId}`);
            }),
        );

        // ── system.notification — Fase AS.1 ──────────────────────────────────
        unsubs.push(
            session.on('system.notification', (event) => {
                const { kind } = event.data;
                metrics?.recordCounter(`system.notification.${kind.type}`);
                if (kind.type === 'agent_completed') {
                    metrics?.recordCounter(`background_agent.${'status' in kind ? kind.status : 'unknown'}`);
                }
                if (persist && persistTypes.includes('system.notification')) {
                    persistEvent({
                        type: event.type,
                        sessionId,
                        ts: event.timestamp,
                        notificationKind: kind.type,
                        status: 'status' in kind ? kind.status : undefined,
                    });
                }
                log('INFO', `[event-collector] system.notification: ${kind.type} session=${sessionId}`);
            }),
        );

        // ── subagent.selected — Fase AW ───────────────────────────────────────
        unsubs.push(
            session.on('subagent.selected', (event) => {
                metrics?.recordCounter('subagent.selected');
                if (persist && persistTypes.includes('subagent.selected')) {
                    persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
                }
            }),
        );

        // ── mcp.oauth_required / mcp.oauth_completed — Fase AS.2 ─────────────
        unsubs.push(
            session.on('mcp.oauth_required', (event) => {
                const { serverName } = event.data;
                metrics?.recordCounter('mcp.oauth_required');
                if (persist && persistTypes.includes('mcp.oauth_required')) {
                    persistEvent({ type: event.type, sessionId, ts: event.timestamp, serverName });
                }
                log('WARN', `[event-collector] mcp.oauth_required: ${serverName} session=${sessionId}`);
            }),
        );

        unsubs.push(
            session.on('mcp.oauth_completed', (event) => {
                const { requestId } = event.data;
                metrics?.recordCounter('mcp.oauth_completed');
                if (persist && persistTypes.includes('mcp.oauth_completed')) {
                    persistEvent({ type: event.type, sessionId, ts: event.timestamp, requestId });
                }
            }),
        );

        // ── external_tool.requested — Fase AW (com trace context W3C) ────────
        unsubs.push(
            session.on('external_tool.requested', (event) => {
                const { requestId, toolName, traceparent, tracestate } = event.data;
                metrics?.recordCounter('external_tool.requested');
                if (persist && persistTypes.includes('external_tool.requested')) {
                    persistEvent({
                        type: event.type,
                        sessionId,
                        ts: event.timestamp,
                        requestId,
                        toolName,
                        toolArgs: event.data.arguments ?? {},
                        traceparent: traceparent ?? null,
                        tracestate: tracestate ?? null,
                    });
                }
                log(
                    'DEBUG',
                    `[event-collector] external_tool.requested: ${toolName ?? requestId} session=${sessionId}`,
                );
            }),
        );

        // ── command.execute — Fase AW ─────────────────────────────────────────
        unsubs.push(
            session.on('command.execute', (event) => {
                const { commandName, args } = event.data;
                metrics?.recordCounter(`command.execute.${commandName ?? 'unknown'}`);
                if (persist && persistTypes.includes('command.execute')) {
                    persistEvent({ type: event.type, sessionId, ts: event.timestamp, commandName, args });
                }
                log('DEBUG', `[event-collector] command.execute: /${commandName ?? '?'} session=${sessionId}`);
            }),
        );

        // ── exit_plan_mode.requested — Fase AW ───────────────────────────────
        unsubs.push(
            session.on('exit_plan_mode.requested', (event) => {
                const { summary, actions, recommendedAction } = event.data;
                metrics?.recordCounter('exit_plan_mode.requested');
                if (persist && persistTypes.includes('exit_plan_mode.requested')) {
                    persistEvent({
                        type: event.type,
                        sessionId,
                        ts: event.timestamp,
                        summaryLength: summary?.length ?? 0,
                        actions,
                        recommendedAction,
                    });
                }
                log(
                    'INFO',
                    `[event-collector] exit_plan_mode.requested recommended=${recommendedAction ?? 'n/a'} session=${sessionId}`,
                );
            }),
        );

        log('DEBUG', `[event-collector] ${unsubs.length} handlers registrados para session=${sessionId} (pre-BF)`);

        // ── Fase BF: Novos handlers para eventos previamente não cobertos ──────────────────────────────

        // assistant.reasoning — raciocínio completo (não delta); persiste hash de comprimento + reasoningId
        unsubs.push(
            session.on('assistant.reasoning', (event) => {
                const { reasoningId, content } = event.data;
                metrics?.recordCounter('assistant.reasoning');
                if (persist && persistTypes.includes('assistant.reasoning')) {
                    persistEvent({
                        type: event.type,
                        sessionId,
                        ts: event.timestamp,
                        reasoningId,
                        contentLength: content?.length ?? 0,
                    });
                }
                log(
                    'DEBUG',
                    `[event-collector] assistant.reasoning id=${reasoningId ?? '?'} len=${content?.length ?? 0}`,
                );
            }),
        );

        // session.title_changed — persiste novo título da sessão
        unsubs.push(
            session.on('session.title_changed', (event) => {
                const { title } = event.data;
                metrics?.recordCounter('session.title_changed');
                if (persist) {
                    persistEvent({ type: event.type, sessionId, ts: event.timestamp, title });
                }
                log('INFO', `[event-collector] session.title_changed title="${title ?? ''}" session=${sessionId}`);
            }),
        );

        // session.workspace_file_changed — persiste path + operação (create/update/delete)
        unsubs.push(
            session.on('session.workspace_file_changed', (event) => {
                const { path, operation } = event.data;
                metrics?.recordCounter(`session.workspace_file_changed.${operation ?? 'unknown'}`);
                if (persist && persistTypes.includes('session.workspace_file_changed')) {
                    persistEvent({ type: event.type, sessionId, ts: event.timestamp, path, operation });
                }
                log(
                    'DEBUG',
                    `[event-collector] session.workspace_file_changed op=${operation ?? '?'} path=${path ?? '?'}`,
                );
            }),
        );

        // system.message — persiste role + promptVersion para rastreamento de system prompts
        unsubs.push(
            session.on('system.message', (event) => {
                const { role, metadata } = event.data;
                const promptVersion = metadata?.promptVersion;
                metrics?.recordCounter('system.message');
                if (persist && persistTypes.includes('system.message')) {
                    persistEvent({ type: event.type, sessionId, ts: event.timestamp, role, promptVersion });
                }
                log('DEBUG', `[event-collector] system.message role=${role ?? '?'} v=${promptVersion ?? '?'}`);
            }),
        );

        // pending_messages.modified — contador apenas (conteúdo efêmero)
        unsubs.push(
            session.on('pending_messages.modified', () => {
                metrics?.recordCounter('pending_messages.modified');
            }),
        );

        // exit_plan_mode.completed — persiste requestId
        unsubs.push(
            session.on('exit_plan_mode.completed', (event) => {
                const { requestId } = event.data;
                metrics?.recordCounter('exit_plan_mode.completed');
                if (persist && persistTypes.includes('exit_plan_mode.completed')) {
                    persistEvent({ type: event.type, sessionId, ts: event.timestamp, requestId });
                }
                log('DEBUG', `[event-collector] exit_plan_mode.completed requestId=${requestId ?? '?'}`);
            }),
        );

        // external_tool.completed — persiste requestId
        unsubs.push(
            session.on('external_tool.completed', (event) => {
                const { requestId } = event.data;
                metrics?.recordCounter('external_tool.completed');
                if (persist && persistTypes.includes('external_tool.completed')) {
                    persistEvent({ type: event.type, sessionId, ts: event.timestamp, requestId });
                }
                log('DEBUG', `[event-collector] external_tool.completed requestId=${requestId ?? '?'}`);
            }),
        );

        // command.queued — persiste requestId
        unsubs.push(
            session.on('command.queued', (event) => {
                const { requestId } = event.data;
                metrics?.recordCounter('command.queued');
                if (persist && persistTypes.includes('command.queued')) {
                    persistEvent({ type: event.type, sessionId, ts: event.timestamp, requestId });
                }
                log('DEBUG', `[event-collector] command.queued requestId=${requestId ?? '?'}`);
            }),
        );

        // command.completed — persiste requestId
        unsubs.push(
            session.on('command.completed', (event) => {
                const { requestId } = event.data;
                metrics?.recordCounter('command.completed');
                if (persist && persistTypes.includes('command.completed')) {
                    persistEvent({ type: event.type, sessionId, ts: event.timestamp, requestId });
                }
                log('DEBUG', `[event-collector] command.completed requestId=${requestId ?? '?'}`);
            }),
        );

        // commands.changed — contador apenas (lista de comandos disponíveis mudou)
        unsubs.push(
            session.on('commands.changed', (event) => {
                const { commands } = event.data;
                const count = Array.isArray(commands) ? commands.length : 0;
                metrics?.recordCounter('commands.changed');
                log('DEBUG', `[event-collector] commands.changed count=${count}`);
            }),
        );

        // tool.execution_partial_result — contador apenas (streaming incremental de tool, não persistir)
        unsubs.push(
            session.on('tool.execution_partial_result', () => {
                metrics?.recordCounter('tool.execution_partial_result');
            }),
        );

        // ── assistant.streaming_delta (ephemeral — gauge de bytes, não persistir) ──────────────
        unsubs.push(
            session.on('assistant.streaming_delta', (event) => {
                metrics?.recordCounter('assistant.streaming_delta');
                const total = /** @type {number | undefined} */ (event.data?.totalResponseSizeBytes);
                if (typeof total === 'number') {
                    // recordCounter com bucket de tamanho: count por faixa de 100KB
                    metrics?.recordCounter(`streaming.response_size.bucket_${Math.floor(total / 102400)}`);
                }
            }),
        );

        // ── session.snapshot_rewind (ephemeral — persiste metadados de rewind) ────────────────
        unsubs.push(
            session.on('session.snapshot_rewind', (event) => {
                metrics?.recordCounter('session.snapshot_rewind');
                const removed = /** @type {number | undefined} */ (event.data?.eventsRemoved);
                log(
                    'INFO',
                    `[event-collector] session.snapshot_rewind: eventosRemovidos=${removed ?? '?'}, alvo=${event.data?.upToEventId ?? '?'}`,
                );
                if (persist && persistTypes.includes('session.snapshot_rewind')) {
                    persistEvent({
                        type: 'session.snapshot_rewind',
                        sessionId,
                        ts: event.timestamp,
                        upToEventId: event.data?.upToEventId,
                        eventsRemoved: removed,
                    });
                }
            }),
        );

        // ── session.info — informações operacionais da sessão ────────────────────────────────
        unsubs.push(
            session.on('session.info', (event) => {
                metrics?.recordCounter('session.info');
                const infoType = /** @type {string | undefined} */ (event.data?.infoType);
                const logLevel = infoType === 'authentication' || infoType === 'model' ? 'WARN' : 'DEBUG';
                log(logLevel, `[event-collector] session.info[${infoType ?? '?'}]: ${event.data?.message ?? ''}`);
                if (persist && persistTypes.includes('session.info')) {
                    persistEvent({
                        type: 'session.info',
                        sessionId,
                        ts: event.timestamp,
                        infoType,
                        message: event.data?.message,
                        url: event.data?.url,
                    });
                }
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
