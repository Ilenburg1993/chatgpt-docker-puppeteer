// @ts-check
/**
 * Comando `/events` — consulta o archive duravel de eventos SSE publicos do terminal.
 *
 * @module copilot/terminal/commands/events
 */

import { listTerminalPublicStreamSourcePolicies } from '../events/index.js';
import {
    compactTerminalDiagnosticId,
    compactTerminalOperatorToolText,
    formatTerminalToolPathForOperator,
    getTerminalHumanToolName,
} from '../events/tool-activity-presenter.js';
import {
    formatTerminalIsoTimestamp,
    formatTerminalTimeLabel,
    readTerminalSseEventArchiveTail,
    terminalThemeHeadline,
    terminalThemeRow,
    terminalThemeText,
} from '../state/index.js';

/**
 * @typedef {object} EventsContext
 * @property {(text: string) => void} println
 *
 * @typedef {object} RenderedEventRow
 * @property {string} key
 * @property {string} label
 * @property {string} time
 * @property {string} origin
 * @property {string} eventId
 * @property {string} trace
 * @property {string} turn
 * @property {string} hub
 * @property {string} detail
 * @property {number} count
 */

/**
 * @param {string} arg
 * @returns {{
 *     query: {
 *         limit: number;
 *         event: string | null;
 *         traceId: string | null;
 *         turnId: string | null;
 *         source: string | null;
 *         toolCallId: string | null;
 *         requestId: string | null;
 *         hubSessionId: string | null;
 *     };
 *     format: 'text' | 'json' | 'raw';
 * }}
 */
function parseEventsArg(arg) {
    const tokens = arg.trim().split(/\s+/u).filter(Boolean);
    let limit = 20;
    /** @type {string | null} */
    let event = null;
    /** @type {string | null} */
    let traceId = null;
    /** @type {string | null} */
    let turnId = null;
    /** @type {string | null} */
    let source = null;
    /** @type {string | null} */
    let toolCallId = null;
    /** @type {string | null} */
    let requestId = null;
    /** @type {string | null} */
    let hubSessionId = null;
    /** @type {'text' | 'json' | 'raw'} */
    let format = 'text';
    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index] ?? '';
        if (!token) continue;
        const next = tokens[index + 1] ?? '';
        if (/^\d+$/u.test(token)) {
            limit = Math.min(500, Math.max(1, Number(token)));
        } else if (token === '--json' || token === 'json' || token === 'format=json') {
            format = 'json';
        } else if (token === '--raw' || token === 'raw' || token === 'format=raw') {
            format = 'raw';
        } else if (token === 'event' && next) {
            event = next;
            index += 1;
        } else if (token.startsWith('event=')) {
            event = token.slice('event='.length) || null;
        } else if (token === 'trace' && next) {
            traceId = next;
            index += 1;
        } else if (token.startsWith('trace=')) {
            traceId = token.slice('trace='.length) || null;
        } else if (token.startsWith('traceId=')) {
            traceId = token.slice('traceId='.length) || null;
        } else if (token === 'turn' && next) {
            turnId = next;
            index += 1;
        } else if (token.startsWith('turn=')) {
            turnId = token.slice('turn='.length) || null;
        } else if (token.startsWith('turnId=')) {
            turnId = token.slice('turnId='.length) || null;
        } else if (token === 'source' && next) {
            source = next;
            index += 1;
        } else if (token.startsWith('source=')) {
            source = token.slice('source='.length) || null;
        } else if ((token === 'tool' || token === 'call') && next) {
            toolCallId = next;
            index += 1;
        } else if (token.startsWith('tool=')) {
            toolCallId = token.slice('tool='.length) || null;
        } else if (token.startsWith('toolCall=')) {
            toolCallId = token.slice('toolCall='.length) || null;
        } else if (token.startsWith('toolCallId=')) {
            toolCallId = token.slice('toolCallId='.length) || null;
        } else if (token.startsWith('call=')) {
            toolCallId = token.slice('call='.length) || null;
        } else if ((token === 'request' || token === 'req') && next) {
            requestId = next;
            index += 1;
        } else if (token.startsWith('request=')) {
            requestId = token.slice('request='.length) || null;
        } else if (token.startsWith('requestId=')) {
            requestId = token.slice('requestId='.length) || null;
        } else if (token.startsWith('req=')) {
            requestId = token.slice('req='.length) || null;
        } else if (token === 'hub' && next) {
            hubSessionId = next;
            index += 1;
        } else if (token.startsWith('hub=')) {
            hubSessionId = token.slice('hub='.length) || null;
        } else if (token.startsWith('hubSession=')) {
            hubSessionId = token.slice('hubSession='.length) || null;
        } else if (token.startsWith('hubSessionId=')) {
            hubSessionId = token.slice('hubSessionId='.length) || null;
        } else if (!event) {
            event = token;
        }
    }
    return {
        query: { limit, event, traceId, turnId, source, toolCallId, requestId, hubSessionId },
        format,
    };
}

/**
 * @param {string} arg
 * @returns {boolean}
 */
function isEventsSourcesArg(arg) {
    const first = arg.trim().split(/\s+/u).filter(Boolean)[0] ?? '';
    return first === 'sources' || first === 'source-map' || first === 'authority';
}

/**
 * @param {string} arg
 * @returns {number}
 */
function parseSourcesLimit(arg) {
    const tokens = arg.trim().split(/\s+/u).filter(Boolean).slice(1);
    for (const token of tokens) {
        if (/^\d+$/u.test(token)) return Math.min(500, Math.max(1, Number(token)));
        if (token.startsWith('limit=') && /^\d+$/u.test(token.slice('limit='.length))) {
            return Math.min(500, Math.max(1, Number(token.slice('limit='.length))));
        }
    }
    return 200;
}

/**
 * @param {string} arg
 * @returns {boolean}
 */
function isEventsSourcesDetailArg(arg) {
    return arg
        .trim()
        .split(/\s+/u)
        .filter(Boolean)
        .some((token) => token === 'detail' || token === 'full' || token === '--detail' || token === '--full');
}

/**
 * @param {{ canonicalEmitter: string; publicEvents: string[] }} policy
 * @returns {string}
 */
function buildPolicyQueryHints(policy) {
    const event = policy.publicEvents[0] ?? '';
    const eventHint = event ? `/events ${event} 50` : null;
    const sourceHint = policy.canonicalEmitter ? `/events source ${policy.canonicalEmitter} 50` : null;
    return [eventHint, sourceHint].filter(Boolean).join(' · ');
}

/**
 * @param {string} value
 * @returns {string}
 */
function humanPolicyOwner(value) {
    const lower = value.toLowerCase();
    if (lower.includes('turn-display')) return 'streaming da resposta';
    if (lower.includes('sdk') && lower.includes('user')) return 'pergunta humana SDK';
    if (lower.includes('sdk') && lower.includes('assistant')) return 'mensagens da LLM-B';
    if (lower.includes('agent') && lower.includes('background')) return 'tarefas em segundo plano';
    if (lower.includes('quota')) return 'quota e limites';
    if (lower.includes('byok')) return 'model-gateway/BYOK';
    if (lower.includes('terminal')) return 'terminal';
    if (lower.includes('dialog')) return 'conversa';
    return value.replace(/[._/-]+/gu, ' ');
}

/**
 * @param {{ canonicalEmitter: string; owner: string }} policy
 * @returns {string}
 */
function humanPolicyOwnerSummary(policy) {
    const owner = humanPolicyOwner(policy.owner);
    const emitter = humanEventSource(policy.canonicalEmitter);
    return owner === emitter ? owner : `${owner} · ${emitter}`;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function compact(value, max = 100) {
    const text = normalizeEventSummaryText(value);
    return text.length > max ? `${text.slice(0, Math.max(0, max - 3))}...` : text;
}

/**
 * @param {string} event
 * @returns {string}
 */
function humanEventLabel(event) {
    if (event === 'assistant.message') return 'Mensagem da LLM-B';
    if (event === 'user_input.requested') return 'Pergunta ao operador';
    if (event === 'user_input.completed') return 'Resposta do operador';
    if (event === 'tool.lifecycle') return 'Ferramenta';
    if (event === 'terminal.activity' || event === 'activity.changed') return 'Atividade';
    if (event === 'terminal.runtime.wired') return 'Runtime pronto';
    if (event === 'terminal.started') return 'Terminal iniciado';
    if (event === 'dialog.loop.changed') return 'Conversa alterada';
    if (event === 'quota.warning') return 'Aviso de quota';
    if (event === 'session.model_changed') return 'Modelo alterado';
    if (event === 'session.skills_loaded') return 'Skills carregadas';
    if (event === 'session.info') return 'Info da sessão';
    if (event === 'session.error') return 'Erro da sessão';
    if (event === 'byok.provider.config') return 'Configuração BYOK';
    if (event === 'dialog.ready') return 'Conversa pronta';
    if (event === 'dialog.stopped') return 'Conversa parada';
    if (event === 'terminal.runtime.wire_failed') return 'Runtime falhou';
    if (event === 'skills.reloaded') return 'Skills recarregadas';
    if (event === 'elicitation.pending') return 'Formulário pendente';
    if (event === 'elicitation.completed') return 'Formulário concluído';
    if (event === 'permission.requested') return 'Permissão solicitada';
    if (event === 'permission.completed') return 'Permissão concluída';
    if (event === 'permission.mode_changed') return 'Permissões alteradas';
    if (event === 'agent.background.completed') return 'Tarefa em segundo plano concluída';
    if (event === 'agent.background.idle') return 'Tarefa em segundo plano ociosa';
    if (event === 'question.answered') return 'Resposta do operador';
    if (event === 'assistant.reasoning_complete') return 'Raciocínio concluído';
    if (event === 'dialog.turn_start' || event === 'assistant.turn_start') return 'Turno iniciado';
    if (event === 'dialog.turn_end' || event === 'assistant.turn_end') return 'Turno concluído';
    if (event === 'sdk.lifecycle') return 'Sessão SDK';
    if (event === 'hook.start') return 'Hook iniciado';
    if (event === 'hook.end') return 'Hook concluído';
    if (event === 'llm.usage' || event === 'session.usage') return 'Uso LLM';
    if (event === 'streaming.progress' || event === 'delta') return 'Streaming';
    if (event === 'busy') return 'Ocupado';
    return event.replace(/[._-]+/gu, ' ');
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function humanStatus(value) {
    const text = normalizeEventSummaryText(value).toLowerCase();
    if (!text) return '';
    if (text === 'io' || text === 'io_op') return 'I/O local';
    if (text === 'success' || text === 'completed' || text === 'done') return 'concluído';
    if (text === 'failed' || text === 'failure' || text === 'error') return 'falhou';
    if (text === 'active' || text === 'running' || text === 'started') return 'em andamento';
    if (text === 'requested' || text === 'pending') return 'pendente';
    if (text === 'ask_user_continuation') return 'continuação da pergunta humana';
    if (text === 'session.created') return 'sessão criada';
    if (text === 'session.deleted') return 'sessão removida';
    if (text === 'session.updated') return 'sessão atualizada';
    if (text === 'session.foreground') return 'sessão em primeiro plano';
    if (text === 'session.background') return 'sessão em segundo plano';
    return text.replace(/[_-]+/gu, ' ');
}

/**
 * @param {string | null | undefined} source
 * @returns {string}
 */
function humanEventSource(source) {
    const text = normalizeEventSummaryText(source ?? '');
    const lower = text.toLowerCase();
    if (!text) return '-';
    if (lower === 'io' || lower.startsWith('io/')) return 'I/O local';
    if (lower.startsWith('sdk/user_input')) return 'pergunta humana SDK';
    if (lower.startsWith('sdk/assistant')) return 'SDK assistant';
    if (lower.startsWith('agent/background')) return 'tarefa em segundo plano';
    if (lower.startsWith('agent/llm')) return 'agente/usage';
    if (lower.startsWith('terminal-boot')) return 'terminal';
    if (lower.startsWith('terminal-dialog') || lower.startsWith('terminal-agent-wiring')) return 'diálogo';
    if (lower === 'sdk' || lower.startsWith('sdk/')) return 'SDK';
    if (lower === 'agent' || lower.startsWith('agent/')) return 'agente';
    if (lower === 'dialog' || lower.startsWith('dialog')) return 'diálogo';
    if (lower.includes('terminal')) return 'terminal';
    return text;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeEventSummaryText(value) {
    const text = typeof value === 'string' ? value : value == null ? '' : String(value);
    return compactTerminalOperatorToolText(text.replace(/\s+/gu, ' ').trim(), 180);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function humanPayloadKind(value) {
    const text = normalizeEventSummaryText(value).toLowerCase();
    if (!text) return '';
    if (text === 'io' || text === 'io_op') return 'I/O local';
    if (text === 'tool' || text === 'tool_lifecycle') return 'ferramenta';
    if (text === 'background' || text === 'background_task') return 'tarefa em segundo plano';
    return text.replace(/[_-]+/gu, ' ');
}

/**
 * @param {Record<string, unknown>} payload
 * @param {{ showIds?: boolean }} [opts]
 * @returns {string}
 */
function summarizePayload(payload, opts = {}) {
    const previousModel = payload['previousModel'];
    const newModel = payload['newModel'];
    if (typeof newModel === 'string' && newModel.trim().length > 0) {
        const previous = typeof previousModel === 'string' && previousModel.trim().length > 0 ? previousModel.trim() : 'modelo anterior n/d';
        const effort = typeof payload['reasoningEffort'] === 'string' && payload['reasoningEffort'].trim().length > 0
            ? ` · raciocínio ${payload['reasoningEffort'].trim()}`
            : '';
        return `modelo ${compact(previous, 42)} → ${compact(newModel.trim(), 42)}${effort}`;
    }
    const toolName = payload['toolName'] ?? payload['tool'];
    const toolCallId = payload['toolCallId'] ?? payload['callId'];
    const requestId = payload['requestId'] ?? payload['pendingRequestId'];
    const content = payload['content'] ?? payload['chunk'] ?? payload['question'] ?? payload['message'] ?? null;
    const status = payload['status'] ?? null;
    const type = payload['type'] ?? null;
    const classification = payload['classification'] ?? null;
    const humanToolName = typeof toolName === 'string' ? getTerminalHumanToolName(toolName) : null;
    const showIds = Boolean(opts.showIds);
    const renderedStatus = humanStatus(status);
    const renderedType = humanPayloadKind(type);
    const renderedClassification = humanPayloadKind(classification);
    return [
        humanToolName ? `ferramenta ${compact(humanToolName, 48)}` : null,
        showIds && toolCallId ? `call ${compactTerminalDiagnosticId(String(toolCallId), 14)}` : null,
        showIds && requestId ? `req ${compactTerminalDiagnosticId(String(requestId), 14)}` : null,
        renderedStatus ? `estado ${compact(renderedStatus)}` : null,
        renderedType ? `tipo ${compact(renderedType)}` : null,
        renderedClassification ? `classe ${compact(renderedClassification)}` : null,
        content ? compact(content) : null,
    ]
        .filter(Boolean)
        .join(' · ');
}

/**
 * @param {{
 *     event: string;
 *     source: string | null;
 *     eventSource: string | null;
 *     traceId: string | null;
 *     turnId: string | null;
 * }} entry
 * @param {{ showIds?: boolean }} [opts]
 * @returns {string | null}
 */
function buildTranscriptExportHint(entry, opts = {}) {
    /** @type {string | null} */
    let transcript = null;
    if (entry.event === 'assistant.message') transcript = 'LLM-B';
    if (entry.event === 'user_input.requested') transcript = 'Sistema/pergunta humana';
    if (entry.event === 'user_input.completed') transcript = 'Operador/pergunta humana';
    if (!transcript) return null;
    const source = entry.eventSource ?? entry.source ?? entry.event;
    const showIds = Boolean(opts.showIds);
    const trace = showIds && entry.traceId ? ` · rastreamento ${compactTerminalDiagnosticId(entry.traceId, 18)}` : '';
    const turn = showIds && entry.turnId ? ` · turno ${compactTerminalDiagnosticId(entry.turnId, 18)}` : '';
    return `transcript ${transcript} · export envelope ${humanEventSource(source)}${trace}${turn}`;
}

/**
 * @param {Record<string, unknown>} filters
 * @returns {boolean}
 */
function hasActiveEventFilters(filters) {
    return Boolean(
        filters['event'] ||
            filters['traceId'] ||
            filters['turnId'] ||
            filters['source'] ||
            filters['toolCallId'] ||
            filters['requestId'] ||
            filters['hubSessionId'],
    );
}

/**
 * @param {EventsContext} ctx
 * @param {string} [arg]
 * @returns {Promise<void>}
 */
export async function cmdEvents({ println }, arg = '') {
    if (isEventsSourcesArg(arg)) {
        const policies = listTerminalPublicStreamSourcePolicies();
        const limit = parseSourcesLimit(arg);
        const detailMode = isEventsSourcesDetailArg(arg);
        const projection = await readTerminalSseEventArchiveTail({
            limit,
            event: null,
            traceId: null,
            turnId: null,
            source: null,
            toolCallId: null,
            requestId: null,
            hubSessionId: null,
        });
        const counts = new Map(projection.entries.map((entry) => [entry.event, 0]));
        for (const entry of projection.entries) {
            counts.set(entry.event, (counts.get(entry.event) ?? 0) + 1);
        }
        println('');
        println(terminalThemeHeadline('accent', detailMode ? 'Fontes do Terminal - Detalhe' : 'Fontes do Terminal'));
        println(
            terminalThemeRow(
                'Janela',
                `${projection.filters.limit} eventos recentes · arquivo ${formatTerminalToolPathForOperator(projection.state.path ?? '(sem arquivo)')}`,
                { role: 'muted' },
            ),
        );
        if (!detailMode) {
            println(terminalThemeRow('Detalhe', '/events sources detail', { role: 'command' }));
        }
        for (const policy of policies) {
            const policyCount = policy.publicEvents.reduce((sum, event) => sum + (counts.get(event) ?? 0), 0);
            const events = policy.publicEvents.map(humanEventLabel).join(', ');
            const title = detailMode ? policy.id : policy.publicEvents.map(humanEventLabel).slice(0, 2).join(' + ');
            println(terminalThemeText('accent', `  ${title || policy.id}`));
            println(terminalThemeRow('Responsável', humanPolicyOwnerSummary(policy), { role: 'muted' }));
            println(
                terminalThemeRow('Eventos', `${events} · ${policyCount} recentes`, {
                    role: policyCount > 0 ? 'info' : 'muted',
                }),
            );
            println(terminalThemeRow('Investigar', buildPolicyQueryHints(policy) || '/events 50', { role: 'command' }));
            if (detailMode) {
                println(terminalThemeRow('ID', policy.id, { role: 'muted' }));
                println(terminalThemeRow('Classe', policy.class, { role: 'muted' }));
                println(terminalThemeRow('Dono técnico', policy.owner, { role: 'muted' }));
                println(terminalThemeRow('Emissor', policy.canonicalEmitter, { role: 'muted' }));
                println(terminalThemeRow('Aceita', policy.accepts.join(', ') || '-', { role: 'muted' }));
                println(terminalThemeRow('Suprime', policy.suppresses.join(', ') || '-', { role: 'muted' }));
                println(terminalThemeRow('Fallback', policy.fallback, { role: 'muted' }));
            }
        }
        println('');
        return;
    }

    const { query, format } = parseEventsArg(arg);
    const projection = await readTerminalSseEventArchiveTail(query);
    const { state, entries, filters } = projection;

    if (format === 'json') {
        println(JSON.stringify({ state, filters, entries }, null, 2));
        return;
    }
    if (format === 'raw') {
        for (const entry of entries) println(JSON.stringify(entry));
        return;
    }

    const filterParts = [
        filters.event ? `evento ${filters.event}` : null,
        filters.traceId ? `rastreamento ${filters.traceId}` : null,
        filters.turnId ? `turno ${filters.turnId}` : null,
        filters.source ? `fonte ${filters.source}` : null,
        filters.toolCallId ? `tool ${filters.toolCallId}` : null,
        filters.requestId ? `request ${filters.requestId}` : null,
        filters.hubSessionId ? `hub ${filters.hubSessionId}` : null,
    ].filter(Boolean);

    println('');
    println(terminalThemeHeadline('accent', `Eventos SSE - últimas ${filters.limit}`));
    println(
        terminalThemeRow(
            'Registro',
            `${compactTerminalOperatorToolText(state.path ?? '(sem arquivo)', 88)} · ${state.events} evento(s) · fila ${state.queueDepth}`,
            { role: 'muted' },
        ),
    );
    println(terminalThemeRow('Filtro', filterParts.join(' · ') || 'nenhum', { role: 'muted' }));
    println(terminalThemeRow('Detalhe', '/events --raw · /events --json · /events sources', { role: 'command' }));
    if (state.error) {
        println(terminalThemeRow('Erro', state.error, { role: 'error' }));
    }
    if (entries.length === 0) {
        println(terminalThemeRow('Resultado', 'Nenhum evento encontrado no archive SSE.', { role: 'warn' }));
        println('');
        return;
    }

    const showDiagnosticIds = Boolean(
        filters.traceId || filters.turnId || filters.toolCallId || filters.requestId || filters.hubSessionId,
    );
    const now = Date.now();
    const shouldAggregateDefaultEvents = !showDiagnosticIds && !hasActiveEventFilters(/** @type {Record<string, unknown>} */ (filters));
    const eventRows = entries.map((entry) => {
        const time = showDiagnosticIds
            ? formatTerminalIsoTimestamp(entry.timestamp, { precision: 'seconds' })
            : formatTerminalTimeLabel(entry.timestamp, { now, mode: 'dual' });
        const origin = compact(humanEventSource(entry.eventSource ?? entry.source ?? '-'), 52);
        const eventId = showDiagnosticIds && entry.eventId ? ` · #${entry.eventId}` : '';
        const trace =
            showDiagnosticIds && entry.traceId
                ? ` · rastreamento ${compactTerminalDiagnosticId(entry.traceId, 18)}`
                : '';
        const turn =
            showDiagnosticIds && entry.turnId ? ` · turno ${compactTerminalDiagnosticId(entry.turnId, 18)}` : '';
        const hub =
            showDiagnosticIds && entry.hubSessionId
                ? ` · hub ${compactTerminalDiagnosticId(entry.hubSessionId, 14)}`
                : '';
        const summary = summarizePayload(entry.payload ?? {}, {
            showIds: showDiagnosticIds,
        });
        const transcriptHint = buildTranscriptExportHint(entry, { showIds: showDiagnosticIds });
        const detail = [summary, transcriptHint].filter(Boolean).join(' · ');
        const label = humanEventLabel(entry.event);
        return {
            key: `${label}\u0000${origin}\u0000${summary}\u0000${transcriptHint ?? ''}`,
            label,
            time,
            origin,
            eventId,
            trace,
            turn,
            hub,
            detail,
            count: 1,
        };
    });
    const rows = shouldAggregateDefaultEvents ? aggregateEventRows(eventRows) : eventRows;

    for (const row of rows) {
        const countLabel = row.count > 1 ? ` · ×${row.count}` : '';
        println(
            terminalThemeRow(
                row.label,
                `${row.time}${countLabel}${row.eventId} · ${row.origin}${row.trace}${row.turn}${row.hub}${row.detail ? ` · ${row.detail}` : ''}`,
                { role: 'muted', width: 22 },
            ),
        );
    }
    println('');
}

/**
 * @param {RenderedEventRow[]} rows
 * @returns {RenderedEventRow[]}
 */
function aggregateEventRows(rows) {
    /** @type {Map<string, RenderedEventRow>} */
    const groups = new Map();
    for (const row of rows) {
        const existing = groups.get(row.key);
        if (!existing) {
            groups.set(row.key, { ...row });
            continue;
        }
        existing.count += 1;
        existing.time = row.time;
    }
    return [...groups.values()];
}
