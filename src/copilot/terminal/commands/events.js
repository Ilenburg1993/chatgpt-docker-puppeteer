// @ts-check
/**
 * Comando `/events` — consulta o archive duravel de eventos SSE publicos do terminal.
 *
 * @module copilot/terminal/commands/events
 */

import { listTerminalPublicStreamSourcePolicies } from '../events/index.js';
import { readTerminalSseEventArchiveTail } from '../state/index.js';
import { compactTerminalDiagnosticId, getTerminalHumanToolName } from '../events/tool-activity-presenter.js';

/**
 * @typedef {object} EventsContext
 * @property {(text: string) => void} println
 */

/**
 * @param {string} arg
 * @returns {{ query: { limit: number; event: string | null; traceId: string | null; turnId: string | null; source: string | null; toolCallId: string | null; requestId: string | null; hubSessionId: string | null }; format: 'text' | 'json' | 'raw' }}
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
    for (const token of tokens) {
        if (/^\d+$/u.test(token)) {
            limit = Math.min(500, Math.max(1, Number(token)));
        } else if (token === '--json' || token === 'json' || token === 'format=json') {
            format = 'json';
        } else if (token === '--raw' || token === 'raw' || token === 'format=raw') {
            format = 'raw';
        } else if (token.startsWith('event=')) {
            event = token.slice('event='.length) || null;
        } else if (token.startsWith('trace=')) {
            traceId = token.slice('trace='.length) || null;
        } else if (token.startsWith('traceId=')) {
            traceId = token.slice('traceId='.length) || null;
        } else if (token.startsWith('turn=')) {
            turnId = token.slice('turn='.length) || null;
        } else if (token.startsWith('turnId=')) {
            turnId = token.slice('turnId='.length) || null;
        } else if (token.startsWith('source=')) {
            source = token.slice('source='.length) || null;
        } else if (token.startsWith('tool=')) {
            toolCallId = token.slice('tool='.length) || null;
        } else if (token.startsWith('toolCall=')) {
            toolCallId = token.slice('toolCall='.length) || null;
        } else if (token.startsWith('toolCallId=')) {
            toolCallId = token.slice('toolCallId='.length) || null;
        } else if (token.startsWith('call=')) {
            toolCallId = token.slice('call='.length) || null;
        } else if (token.startsWith('request=')) {
            requestId = token.slice('request='.length) || null;
        } else if (token.startsWith('requestId=')) {
            requestId = token.slice('requestId='.length) || null;
        } else if (token.startsWith('req=')) {
            requestId = token.slice('req='.length) || null;
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
 * @param {{ canonicalEmitter: string; publicEvents: string[] }} policy
 * @returns {string}
 */
function buildPolicyQueryHints(policy) {
    const event = policy.publicEvents[0] ?? '';
    const eventHint = event ? `/events ${event} 50` : null;
    const sourceHint = policy.canonicalEmitter ? `/events source=${policy.canonicalEmitter} 50` : null;
    return [eventHint, sourceHint].filter(Boolean).join(' · ');
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
    if (event === 'agent.background.completed') return 'Tarefa em background concluída';
    if (event === 'agent.background.idle') return 'Background ocioso';
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
    if (text === 'success' || text === 'completed' || text === 'done') return 'concluído';
    if (text === 'failed' || text === 'failure' || text === 'error') return 'falhou';
    if (text === 'active' || text === 'running' || text === 'started') return 'em andamento';
    if (text === 'requested' || text === 'pending') return 'pendente';
    if (text === 'ask_user_continuation') return 'continuação da pergunta humana';
    if (text === 'session.updated') return 'sessão atualizada';
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
    if (lower.startsWith('sdk/user_input')) return 'SDK ask_user';
    if (lower.startsWith('sdk/assistant')) return 'SDK assistant';
    if (lower.startsWith('agent/background')) return 'agente/background';
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
    return text.replace(/\s+/gu, ' ').trim();
}

/**
 * @param {Record<string, unknown>} payload
 * @param {{ showIds?: boolean }} [opts]
 * @returns {string}
 */
function summarizePayload(payload, opts = {}) {
    const toolName = payload['toolName'] ?? payload['tool'];
    const toolCallId = payload['toolCallId'] ?? payload['callId'];
    const requestId = payload['requestId'] ?? payload['pendingRequestId'];
    const content = payload['content'] ?? payload['chunk'] ?? payload['question'] ?? payload['message'] ?? null;
    const status = payload['status'] ?? payload['type'] ?? payload['classification'] ?? null;
    const humanToolName = typeof toolName === 'string' ? getTerminalHumanToolName(toolName) : null;
    const showIds = Boolean(opts.showIds);
    const renderedStatus = humanStatus(status);
    return [
        humanToolName ? `ferramenta ${compact(humanToolName, 48)}` : null,
        showIds && toolCallId ? `call ${compactTerminalDiagnosticId(String(toolCallId), 14)}` : null,
        showIds && requestId ? `req ${compactTerminalDiagnosticId(String(requestId), 14)}` : null,
        renderedStatus ? `estado ${compact(renderedStatus)}` : null,
        content ? compact(content) : null,
    ]
        .filter(Boolean)
        .join(' · ');
}

/**
 * @param {{ event: string; source: string | null; eventSource: string | null; traceId: string | null; turnId: string | null }} entry
 * @returns {string | null}
 */
function buildTranscriptExportHint(entry) {
    /** @type {string | null} */
    let transcript = null;
    if (entry.event === 'assistant.message') transcript = 'LLM-B';
    if (entry.event === 'user_input.requested') transcript = 'Sistema/ask_user';
    if (entry.event === 'user_input.completed') transcript = 'Usuário/ask_user';
    if (!transcript) return null;
    const source = entry.eventSource ?? entry.source ?? entry.event;
    const trace = entry.traceId ? ` trace=${entry.traceId}` : '';
    const turn = entry.turnId ? ` turn=${entry.turnId}` : '';
    return `transcript ${transcript} · export envelope:${source}${trace}${turn}`;
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
        println('\n  \x1b[36m🧭 Fontes canônicas do terminal\x1b[0m');
        println(
            `  \x1b[90mjanela últimos ${projection.filters.limit} eventos · arquivo ${projection.state.path ?? '(sem arquivo)'}\x1b[0m`,
        );
        for (const policy of policies) {
            const policyCount = policy.publicEvents.reduce((sum, event) => sum + (counts.get(event) ?? 0), 0);
            println(`  \x1b[33m${policy.id}\x1b[0m \x1b[90m(${policy.class})\x1b[0m`);
            println(`    dono        \x1b[90m${policy.owner}\x1b[0m`);
            println(`    emissor     \x1b[90m${policy.canonicalEmitter}\x1b[0m`);
            println(`    eventos     \x1b[90m${policy.publicEvents.join(', ')} · recentes ${policyCount}\x1b[0m`);
            println(`    investigar  \x1b[90m${buildPolicyQueryHints(policy)}\x1b[0m`);
            println(`    aceita      \x1b[90m${policy.accepts.join(', ')}\x1b[0m`);
            println(`    suprime     \x1b[90m${policy.suppresses.join(', ')}\x1b[0m`);
            println(`    fallback    \x1b[90m${policy.fallback}\x1b[0m`);
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
        filters.traceId ? `trace ${filters.traceId}` : null,
        filters.turnId ? `turno ${filters.turnId}` : null,
        filters.source ? `fonte ${filters.source}` : null,
        filters.toolCallId ? `tool ${filters.toolCallId}` : null,
        filters.requestId ? `request ${filters.requestId}` : null,
        filters.hubSessionId ? `hub ${filters.hubSessionId}` : null,
    ].filter(Boolean);

    println(`\n  \x1b[36m🧾 Eventos SSE — visão resumida · últimas ${filters.limit}\x1b[0m`);
    println(
        `  \x1b[90marquivo ${compact(state.path ?? '(sem arquivo)', 88)} · ${state.events} evento(s) · fila ${state.queueDepth} · filtro ${filterParts.join(' ') || 'nenhum'}\x1b[0m`,
    );
    println(
        '  \x1b[90mUse /events --raw para JSONL bruto, /events --json para automação, /events sources para mapa de fontes.\x1b[0m',
    );
    if (state.error) {
        println(`  \x1b[31merro ${state.error}\x1b[0m`);
    }
    if (entries.length === 0) {
        println('  \x1b[33mNenhum evento encontrado no archive SSE.\x1b[0m\n');
        return;
    }

    for (const entry of entries) {
        const time = new Date(entry.timestamp).toLocaleTimeString('pt-BR');
        const origin = compact(humanEventSource(entry.eventSource ?? entry.source ?? '-'), 52);
        const trace = entry.traceId ? ` · trace ${entry.traceId}` : '';
        const turn = entry.turnId ? ` · turno ${entry.turnId}` : '';
        const hub = entry.hubSessionId ? ` · hub ${compactTerminalDiagnosticId(entry.hubSessionId, 14)}` : '';
        const summary = summarizePayload(entry.payload ?? {}, {
            showIds: Boolean(filters.toolCallId || filters.requestId || filters.hubSessionId),
        });
        const transcriptHint = buildTranscriptExportHint(entry);
        const detail = [summary, transcriptHint].filter(Boolean).join(' · ');
        println(
            `    \x1b[90m${time}\x1b[0m  #${entry.eventId} \x1b[33m${humanEventLabel(entry.event)}\x1b[0m  \x1b[90m${origin}${trace}${turn}${hub}\x1b[0m${detail ? ` — ${detail}` : ''}`,
        );
    }
    println('');
}
