// @ts-check
/**
 * Comando `/events` — consulta o archive duravel de eventos SSE publicos do terminal.
 *
 * @module copilot/terminal/commands/events
 */

import { listTerminalPublicStreamSourcePolicies, summarizeEmptyAfterUserInputRecovery } from '../events/index.js';
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
    terminalThemeWrappedRow,
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
 * @param {number} count
 * @param {string} singular
 * @param {string} plural
 * @returns {string}
 */
function countLabel(count, singular, plural) {
    return `${count} ${count === 1 ? singular : plural}`;
}

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
 *     rawMode: 'preview' | 'full';
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
    /** @type {'preview' | 'full'} */
    let rawMode = 'preview';
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
        } else if (token === '--full' || token === 'full' || token === 'raw=full' || token === 'format=raw-full') {
            rawMode = 'full';
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
        rawMode,
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
 * @param {{ id: string; publicEvents: string[] }} policy
 * @returns {string}
 */
function buildHumanPolicyQueryHint(policy) {
    const labels = uniqueHumanEventLabels(policy.publicEvents);
    const subject = labels.length > 0 ? labels.join(' + ') : humanPolicyId(policy.id);
    return `ver ${subject}: /events 50 · detalhe técnico: /events sources detail`;
}

/**
 * @param {string} id
 * @returns {string}
 */
function humanPolicyId(id) {
    return id.replace(/[._-]+/gu, ' ');
}

/**
 * @param {string} value
 * @returns {string}
 */
function humanPolicyOwner(value) {
    const lower = value.toLowerCase();
    if (lower.includes('turn-display')) return 'streaming da resposta';
    if (lower.includes('sdk') && lower.includes('user')) return 'pergunta ao operador';
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
 * @param {string[]} events
 * @returns {string[]}
 */
function uniqueHumanEventLabels(events) {
    return [...new Set(events.map((event) => humanEventLabel(event)).filter(Boolean))];
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
 * @param {Record<string, unknown> | null} [payload]
 * @returns {string}
 */
function humanEventLabel(event, payload = null) {
    if (event === 'assistant.message') return 'Mensagem da LLM-B';
    if (event === 'user_input.requested') return 'Pergunta ao operador';
    if (event === 'user_input.completed') return 'Resposta do operador';
    if (event === 'tool.lifecycle') return 'Ferramenta';
    if (event === 'terminal.activity' || event === 'activity.changed') return 'Atividade';
    if (event === 'terminal.runtime.wired') return 'Sessão pronta';
    if (event === 'terminal.started') return 'Terminal iniciado';
    if (event === 'dialog.loop.changed') return 'Conversa alterada';
    if (event === 'quota.warning') return 'Aviso de quota';
    if (event === 'session.model_changed') {
        const summary = typeof payload?.['operatorSummary'] === 'string' ? payload['operatorSummary'] : '';
        if (/confirmado sem troca/iu.test(summary)) return 'Modelo confirmado';
        return 'Modelo alterado';
    }
    if (event === 'session.skills_loaded') return 'Skills carregadas';
    if (event === 'session.info') {
        const infoType = typeof payload?.['infoType'] === 'string' ? payload['infoType'].trim().toLowerCase() : '';
        if (infoType === 'cancellation') return 'Cancelamento';
        if (infoType === 'configuration') return 'Configuração';
        if (infoType === 'model_retry') return 'Retry modelo';
        return 'Evento da sessão';
    }
    if (event === 'session.error') return 'Erro da sessão';
    if (event === 'session.title_changed') return 'Título da sessão';
    if (event === 'assistant.intent') return 'Intenção da LLM-B';
    if (event === 'agent.error') {
        if (payload?.['byokEnabled'] === true || typeof payload?.['byokProviderType'] === 'string') return 'Erro BYOK';
        return 'Erro do agente';
    }
    if (event === 'terminal.turn.empty_recovery') return 'Recuperação de turno';
    if (event === 'terminal.turn.empty_output') return 'Turno sem saída';
    if (event === 'terminal.turn.non_text_outcome') return 'Turno sem transcript';
    if (event === 'dialog.empty_after_user_input') return 'Continuação vazia';
    if (event === 'dialog.empty_after_user_input.auto_recovery') return 'Retomada automática';
    if (event === 'dialog.empty_after_user_input.auto_recovery_failed') return 'Retomada falhou';
    if (event === 'byok.provider.config') return 'Configuração BYOK';
    if (event === 'dialog.ready') return 'Conversa pronta';
    if (event === 'dialog.stopped') return 'Conversa parada';
    if (event === 'terminal.runtime.wire_failed') return 'Sessão falhou';
    if (event === 'skills.reloaded') return 'Skills recarregadas';
    if (event === 'elicitation.pending') return 'Formulário pendente';
    if (event === 'elicitation.completed') return 'Formulário concluído';
    if (event === 'permission.requested') return 'Permissão solicitada';
    if (event === 'permission.completed') return 'Permissão concluída';
    if (event === 'permission.mode_changed') return 'Permissões alteradas';
    if (event === 'agent.background.completed') return 'Tarefa em segundo plano concluída';
    if (event === 'agent.background.idle') return 'Tarefa em segundo plano ociosa';
    if (event === 'task.started') return 'Tarefa iniciada';
    if (event === 'task.queued') return 'Tarefa enfileirada';
    if (event === 'pending_messages.modified') return 'Fila de mensagens alterada';
    if (event === 'session.tools_updated') return 'Ferramentas da sessão atualizadas';
    if (event === 'question.answered') return 'Resposta encaminhada';
    if (event === 'assistant.reasoning_complete') return 'Raciocínio concluído';
    if (event === 'dialog.turn_start' || event === 'assistant.turn_start') return 'Turno iniciado';
    if (event === 'dialog.turn_end' || event === 'assistant.turn_end') return 'Turno concluído';
    if (event === 'sdk.lifecycle') {
        const lifecycleType = typeof payload?.['type'] === 'string' ? humanPayloadKind(payload['type']) : '';
        if (lifecycleType === 'sessão atualizada') return 'Sessão atualizada';
        if (lifecycleType === 'sessão criada') return 'Sessão criada';
        if (lifecycleType === 'sessão removida') return 'Sessão removida';
        if (lifecycleType === 'sessão em primeiro plano') return 'Sessão em primeiro plano';
        if (lifecycleType === 'sessão em segundo plano') return 'Sessão em segundo plano';
        if (lifecycleType === 'sessão encerrada') return 'Sessão encerrada';
        return 'Ciclo da sessão';
    }
    if (event === 'hook.start') return 'Rotina iniciada';
    if (event === 'hook.end') return 'Rotina concluída';
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
    if (text === 'non_user_initiated') return 'iniciado pelo agente';
    if (text === 'byok_user_message') return 'mensagem BYOK do operador';
    if (text === 'user_input_completed_continuation') return 'continuação após resposta humana';
    if (text === 'model_call') return 'chamada do modelo';
    if (text === 'recoverable_model_call') return 'erro recuperável do modelo';
    if (text === 'erroroccurred' || text === 'error_occurred') return 'erro capturado';
    if (text === 'cancellation') return 'cancelamento';
    if (text === 'empty') return 'sem saída';
    if (text === 'pre_action_empty_output') return 'turno vazio antes de ação';
    if (text === 'agent') return 'agente';
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
    if (lower.startsWith('sdk/session.info')) return 'controle da sessão';
    if (lower.startsWith('sdk/session.title_changed')) return 'controle da sessão';
    if (lower.startsWith('sdk/user_input')) return 'pergunta ao operador';
    if (lower.startsWith('sdk/assistant')) return 'LLM-B via SDK';
    if (lower.startsWith('agent/passthrough/question.answered')) return 'ponte da pergunta';
    if (lower.startsWith('agent/background')) return 'tarefa em segundo plano';
    if (lower.startsWith('agent/llm')) return 'telemetria LLM';
    if (lower.startsWith('agent/sdk.lifecycle')) return 'controle da sessão';
    if (lower.startsWith('agent/error')) return 'erro do agente';
    if (lower.startsWith('terminal-boot')) return 'terminal';
    if (lower.startsWith('terminal-dialog') || lower.startsWith('terminal-agent-wiring')) return 'diálogo';
    if (lower === 'sdk' || lower.startsWith('sdk/')) return 'SDK';
    if (lower === 'agent' || lower.startsWith('agent/')) return 'agente';
    if (lower === 'dialog' || lower.startsWith('dialog')) return 'diálogo';
    if (lower.includes('terminal')) return 'terminal';
    return text;
}

/**
 * @param {string} label
 * @param {string} summary
 * @returns {boolean}
 */
function isRedundantEventSummary(label, summary) {
    const normalizedLabel = normalizeEventSummaryText(label).toLowerCase();
    const normalizedSummary = normalizeEventSummaryText(summary).toLowerCase();
    if (!normalizedLabel || !normalizedSummary) return false;
    return (
        normalizedSummary === normalizedLabel ||
        normalizedSummary === `tipo ${normalizedLabel}` ||
        normalizedSummary === `estado ${normalizedLabel}`
    );
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
    if (text === 'ask_user_continuation') return 'continuação da pergunta humana';
    if (text === 'non_user_initiated') return 'iniciado pelo agente';
    if (text === 'byok_user_message') return 'mensagem BYOK do operador';
    if (text === 'user_input_completed_continuation') return 'continuação após resposta humana';
    if (text === 'session.created') return 'sessão criada';
    if (text === 'session.deleted') return 'sessão removida';
    if (text === 'session.updated') return 'sessão atualizada';
    if (text === 'session.foreground') return 'sessão em primeiro plano';
    if (text === 'session.background') return 'sessão em segundo plano';
    if (text === 'session.shutdown') return 'sessão encerrada';
    if (text === 'model_retry') return 'retry do modelo';
    if (text === 'byok_provider_failure') return 'falha da rota BYOK';
    if (text === 'model_call') return 'chamada do modelo';
    if (text === 'recoverable_model_call') return 'erro recuperável do modelo';
    if (text === 'erroroccurred' || text === 'error_occurred') return 'erro capturado';
    if (text === 'cancellation') return 'cancelamento';
    if (text === 'empty') return 'sem saída';
    if (text === 'pre_action_empty_output') return 'turno vazio antes de ação';
    if (text === 'agent') return 'agente';
    return text.replace(/[_-]+/gu, ' ');
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function humanEventMessage(value) {
    const text = normalizeEventSummaryText(value);
    if (!text) return '';
    if (text === 'Operation cancelled by user') return 'operação cancelada pelo operador';
    return text
        .replace(/^Disabled tools:/iu, 'Ferramentas desabilitadas:')
        .replace(/\bprovider BYOK\b/giu, 'rota BYOK')
        .replace(/\bprovider\/modelo\b/giu, 'rota/modelo')
        .replace(/\bprovider\b/giu, 'provedor')
        .replace(/\bPremium Request\b/giu, 'pedido premium');
}

/**
 * @param {Record<string, unknown>} payload
 * @returns {string}
 */
function summarizeAgentErrorPayload(payload) {
    const isByok = payload['byokEnabled'] === true || typeof payload['byokProviderType'] === 'string';
    const provider = typeof payload['byokProviderType'] === 'string' ? `provedor ${compact(payload['byokProviderType'], 28)}` : null;
    const profile = typeof payload['byokProfile'] === 'string' ? `perfil ${compact(payload['byokProfile'], 28)}` : null;
    const model = typeof payload['byokModel'] === 'string' ? `modelo ${compact(payload['byokModel'], 42)}` : null;
    const recoverable = payload['recoverable'] === true ? 'recuperável' : null;
    const handledAs = humanPayloadKind(payload['handledAs']);
    const context = humanPayloadKind(payload['errorContext']);
    const message = humanEventMessage(payload['operatorMeaning'] ?? payload['message']);
    return [
        isByok ? 'falha da rota BYOK' : null,
        provider,
        profile,
        model,
        recoverable,
        handledAs ? `tratado como ${compact(handledAs, 52)}` : null,
        context ? `contexto ${compact(context, 52)}` : null,
        message ? compact(message, 120) : null,
    ]
        .filter(Boolean)
        .join(' · ');
}

/**
 * @param {Record<string, unknown>} payload
 * @returns {string}
 */
function summarizeEmptyTurnPayload(payload) {
    const actor = humanPayloadKind(payload['actor']);
    const sourceDetail = humanPayloadKind(payload['sourceDetail']);
    const assistantMessages = typeof payload['assistantMessageCount'] === 'number' ? payload['assistantMessageCount'] : null;
    const deltaCount =
        typeof payload['deltaCount'] === 'number'
            ? payload['deltaCount']
            : typeof payload['deltaSlices'] === 'number'
              ? payload['deltaSlices']
              : null;
    const deltaChars = typeof payload['deltaChars'] === 'number' ? payload['deltaChars'] : null;
    const pendingQuestion = payload['pendingQuestionKind']
        ? `pergunta pendente ${compact(humanPayloadKind(payload['pendingQuestionKind']), 40)}`
        : 'sem pergunta humana pendente';
    return [
        actor ? `autor ${actor}` : null,
        sourceDetail ? `origem ${sourceDetail}` : null,
        assistantMessages != null ? `mensagens LLM-B ${assistantMessages}` : null,
        deltaCount != null
            ? `deltas ${deltaCount}${deltaChars != null ? `/${deltaChars} caracteres` : ''}`
            : null,
        pendingQuestion,
    ]
        .filter(Boolean)
        .join(' · ');
}

/**
 * @param {Record<string, unknown>} payload
 * @returns {string}
 */
function summarizeEmptyTurnRecoveryPayload(payload) {
    const attempt = typeof payload['attempt'] === 'number' ? payload['attempt'] : null;
    const maxAttempts = typeof payload['maxAttempts'] === 'number' ? payload['maxAttempts'] : null;
    const reason = humanPayloadKind(payload['reason']);
    const firstOutcome = humanPayloadKind(payload['firstOutcome']);
    const firstReplySource = humanPayloadKind(payload['firstReplySource']);
    return [
        attempt != null && maxAttempts != null ? `tentativa ${attempt}/${maxAttempts}` : null,
        reason ? `motivo ${reason}` : null,
        firstOutcome ? `resultado inicial ${firstOutcome}` : null,
        firstReplySource ? `origem inicial ${firstReplySource}` : null,
        'sem tool, delta ou pergunta pendente; continuação reenviada uma vez',
    ]
        .filter(Boolean)
        .join(' · ');
}

/**
 * @param {Record<string, unknown>} payload
 * @param {{ showIds?: boolean }} [opts]
 * @returns {string}
 */
function summarizeEmptyAfterUserInputPayload(payload, opts = {}) {
    const detail = typeof payload['detail'] === 'string' ? humanEventMessage(payload['detail']) : '';
    const requestId = typeof payload['requestId'] === 'string' ? payload['requestId'] : '';
    return summarizeEmptyAfterUserInputRecovery({
        detail: detail ? compact(detail, 120) : '',
        requestId: requestId ? compactTerminalDiagnosticId(requestId, 14) : '',
        ...(opts.showIds !== undefined ? { showIds: opts.showIds } : {}),
    });
}

/**
 * @param {Record<string, unknown>} payload
 * @returns {string}
 */
function summarizeEmptyAfterUserInputAutoRecoveryPayload(payload) {
    const detail = typeof payload['detail'] === 'string' ? humanEventMessage(payload['detail']) : '';
    return [
        detail ? compact(detail, 120) : 'continuação pós-pergunta terminou sem texto público',
        'retomada automática enviada uma vez',
        'sem repetir a pergunta humana',
    ]
        .filter(Boolean)
        .join(' · ');
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {Record<string, unknown>} payload
 * @param {{ nested?: boolean }} [opts]
 * @returns {string}
 */
function summarizeActivityPayload(payload, opts = {}) {
    const current = opts.nested && isRecord(payload['current']) ? payload['current'] : payload;
    const previous = opts.nested && isRecord(payload['previous']) ? payload['previous'] : null;
    const phase = humanPayloadKind(current['phase']);
    const label = humanEventMessage(current['label']);
    const detail = humanEventMessage(current['detail']);
    const tool = typeof current['toolName'] === 'string' ? getTerminalHumanToolName(current['toolName']) : '';
    const progress = typeof current['progress'] === 'number' ? `${Math.round(current['progress'])}%` : '';
    const previousLabel = previous ? humanEventMessage(previous['label']) : '';
    return [
        phase ? `fase ${compact(phase, 32)}` : null,
        label ? compact(label, 72) : null,
        tool ? `ferramenta ${compact(tool, 48)}` : null,
        detail ? compact(detail, 120) : null,
        progress ? `progresso ${progress}` : null,
        previousLabel ? `antes ${compact(previousLabel, 52)}` : null,
    ]
        .filter(Boolean)
        .join(' · ');
}

/**
 * @param {Record<string, unknown>} payload
 * @param {string} event
 * @returns {string}
 */
function summarizeHookPayload(payload, event) {
    const hookType = humanPayloadKind(payload['hookType']);
    const success =
        payload['success'] === true
            ? 'concluído'
            : payload['success'] === false
              ? 'falhou'
              : event === 'hook.start'
                ? 'iniciado'
                : '';
    const input = isRecord(payload['input']) ? payload['input'] : null;
    const toolName = typeof input?.['toolName'] === 'string' ? getTerminalHumanToolName(input['toolName']) : '';
    const reason = typeof input?.['reason'] === 'string' ? humanPayloadKind(input['reason']) : '';
    return [
        hookType ? `rotina ${compact(hookType, 48)}` : 'rotina SDK',
        success || null,
        toolName ? `ferramenta ${compact(toolName, 48)}` : null,
        reason ? `motivo ${compact(reason, 48)}` : null,
    ]
        .filter(Boolean)
        .join(' · ');
}

/**
 * @param {Record<string, unknown>} payload
 * @returns {string}
 */
function summarizeSdkLifecyclePayload(payload) {
    const type = humanPayloadKind(payload['type']);
    const label = humanEventMessage(payload['label']);
    const detail = humanEventMessage(payload['detail']);
    return [type ? `tipo ${compact(type, 48)}` : null, label ? compact(label, 72) : null, detail ? compact(detail, 96) : null]
        .filter(Boolean)
        .join(' · ');
}

/**
 * @param {Record<string, unknown>} payload
 * @param {{ showIds?: boolean; event?: string }} [opts]
 * @returns {string}
 */
function summarizePayload(payload, opts = {}) {
    if (opts.event === 'activity.changed') {
        const summary = summarizeActivityPayload(payload, { nested: true });
        if (summary) return summary;
    }
    if (opts.event === 'terminal.activity') {
        const summary = summarizeActivityPayload(payload);
        if (summary) return summary;
    }
    if (opts.event === 'hook.start' || opts.event === 'hook.end') {
        const summary = summarizeHookPayload(payload, opts.event);
        if (summary) return summary;
    }
    if (opts.event === 'sdk.lifecycle') {
        const summary = summarizeSdkLifecyclePayload(payload);
        if (summary) return summary;
    }
    if (opts.event === 'terminal.turn.empty_recovery') {
        return summarizeEmptyTurnRecoveryPayload(payload);
    }
    if (opts.event === 'dialog.empty_after_user_input') {
        return summarizeEmptyAfterUserInputPayload(payload, opts);
    }
    if (opts.event === 'dialog.empty_after_user_input.auto_recovery') {
        return summarizeEmptyAfterUserInputAutoRecoveryPayload(payload);
    }
    if (payload['byokEnabled'] === true || payload['handledAs'] || payload['errorContext']) {
        const agentErrorSummary = summarizeAgentErrorPayload(payload);
        if (agentErrorSummary) return agentErrorSummary;
    }
    if (
        payload['sourceDetail'] ||
        Object.prototype.hasOwnProperty.call(payload, 'assistantMessageCount') ||
        Object.prototype.hasOwnProperty.call(payload, 'pendingQuestionKind')
    ) {
        const emptyTurnSummary = summarizeEmptyTurnPayload(payload);
        if (emptyTurnSummary) return emptyTurnSummary;
    }
    const previousModel = payload['previousModel'];
    const newModel = payload['newModel'];
    if (typeof newModel === 'string' && newModel.trim().length > 0) {
        if (typeof payload['operatorSummary'] === 'string' && payload['operatorSummary'].trim().length > 0) {
            return compact(payload['operatorSummary'], 140);
        }
        const previous = typeof previousModel === 'string' && previousModel.trim().length > 0 ? previousModel.trim() : 'modelo anterior n/d';
        const effort = typeof payload['reasoningEffort'] === 'string' && payload['reasoningEffort'].trim().length > 0
            ? ` · raciocínio ${payload['reasoningEffort'].trim()}`
            : '';
        return `modelo ${compact(previous, 42)} → ${compact(newModel.trim(), 42)}${effort}`;
    }
    const toolName = payload['toolName'] ?? payload['tool'];
    const toolCallId = payload['toolCallId'] ?? payload['callId'];
    const requestId = payload['requestId'] ?? payload['pendingRequestId'];
    const content =
        payload['content'] ??
        payload['chunk'] ??
        payload['question'] ??
        payload['answer'] ??
        payload['message'] ??
        payload['description'] ??
        null;
    const status = payload['status'] ?? null;
    const type = payload['type'] ?? payload['infoType'] ?? null;
    const classification = payload['classification'] ?? null;
    const humanToolName = typeof toolName === 'string' ? getTerminalHumanToolName(toolName) : null;
    const showIds = Boolean(opts.showIds);
    const renderedStatus = humanStatus(status);
    const renderedType = humanPayloadKind(type);
    const renderedClassification = humanPayloadKind(classification);
    const typeIsRedundant =
        renderedType &&
        ((humanToolName && renderedType === 'I/O local') || renderedType === humanPayloadKind(payload['kind']));
    const classificationIsRedundant =
        renderedClassification &&
        (renderedClassification === renderedType ||
            (humanToolName && (renderedClassification === 'I/O local' || renderedClassification === 'ferramenta')));
    const classificationLabel = renderedType ? 'classe' : 'tipo';
    return [
        humanToolName ? `ferramenta ${compact(humanToolName, 48)}` : null,
        showIds && toolCallId ? `call ${compactTerminalDiagnosticId(String(toolCallId), 14)}` : null,
        showIds && requestId ? `req ${compactTerminalDiagnosticId(String(requestId), 14)}` : null,
        renderedStatus ? `estado ${compact(renderedStatus)}` : null,
        renderedType && !typeIsRedundant ? `tipo ${compact(renderedType)}` : null,
        renderedClassification && !classificationIsRedundant ? `${classificationLabel} ${compact(renderedClassification)}` : null,
        content ? compact(humanEventMessage(content)) : null,
    ]
        .filter(Boolean)
        .join(' · ');
}

/**
 * @param {Record<string, unknown> | null | undefined} payload
 * @param {string} event
 * @returns {{ payloadKeys: string[]; payloadPreview: string | null }}
 */
function summarizeRawPreviewPayload(payload, event) {
    if (!payload || typeof payload !== 'object') return { payloadKeys: [], payloadPreview: null };
    const payloadKeys = Object.keys(payload).slice(0, 12);
    const summary = summarizePayload(payload, { showIds: true, event });
    const payloadPreview = summary || compact(JSON.stringify(payload), 180);
    return { payloadKeys, payloadPreview: payloadPreview || null };
}

/**
 * @param {Record<string, unknown>} entry
 * @returns {Record<string, unknown>}
 */
function createRawPreviewEntry(entry) {
    const event = typeof entry['event'] === 'string' ? entry['event'] : 'event';
    const payload = /** @type {Record<string, unknown> | null | undefined} */ (entry['payload']);
    const payloadSummary = summarizeRawPreviewPayload(payload, event);
    return {
        schemaVersion: entry['schemaVersion'] ?? 1,
        timestamp: entry['timestamp'] ?? null,
        ts: entry['ts'] ?? null,
        eventId: entry['eventId'] ?? null,
        event,
        source: entry['source'] ?? null,
        eventSource: entry['eventSource'] ?? null,
        traceId: entry['traceId'] ?? null,
        turnId: entry['turnId'] ?? null,
        hubSessionId: entry['hubSessionId'] ?? null,
        ...payloadSummary,
    };
}

const RAW_PREVIEW_LIMIT = 12;

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
    if (entry.event === 'user_input.requested') transcript = 'Sistema/pergunta ao operador';
    if (entry.event === 'user_input.completed') transcript = 'Operador/resposta';
    if (!transcript) return null;
    const source = entry.eventSource ?? entry.source ?? entry.event;
    const showIds = Boolean(opts.showIds);
    const trace = showIds && entry.traceId ? ` · rastreamento ${compactTerminalDiagnosticId(entry.traceId, 18)}` : '';
    const turn = showIds && entry.turnId ? ` · turno ${compactTerminalDiagnosticId(entry.turnId, 18)}` : '';
    return `transcript ${transcript} · registro export ${humanEventSource(source)}${trace}${turn}`;
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
 * @param {{ payload?: Record<string, unknown> | null }} entry
 * @returns {boolean}
 */
function isInternalDefaultEvent(entry) {
    return entry.payload?.['internal'] === true;
}

/**
 * O resumo default de `/events` e uma trilha operacional para o operador humano.
 * Eventos de manutencao continuam no archive, em `--raw`/`--json` e em filtros explicitos.
 *
 * @param {{ event: string; payload?: Record<string, unknown> | null }} entry
 * @returns {boolean}
 */
function isRoutineDefaultEvent(entry) {
    if (entry.event === 'terminal.activity' || entry.event === 'activity.changed') return true;
    if (entry.event === 'busy') return true;
    if (entry.event === 'streaming.progress' || entry.event === 'delta') return true;
    if (entry.event === 'session.usage') return true;
    if (entry.event === 'hook.start' || entry.event === 'hook.end') return true;
    if (
        entry.event === 'dialog.turn_start' ||
        entry.event === 'dialog.turn_end' ||
        entry.event === 'assistant.turn_start' ||
        entry.event === 'assistant.turn_end'
    ) {
        return true;
    }
    if (entry.event === 'sdk.lifecycle') {
        const lifecycleType = normalizeEventSummaryText(entry.payload?.['type']).toLowerCase();
        return [
            'session.updated',
            'session.created',
            'session.deleted',
            'session.foreground',
            'session.background',
            'session.ended',
            'session.end',
        ].includes(lifecycleType);
    }
    return false;
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
            const humanEvents = uniqueHumanEventLabels(policy.publicEvents);
            const events = humanEvents.join(', ');
            const title = detailMode
                ? policy.id
                : humanEvents.slice(0, 2).join(' + ');
            println(terminalThemeText('accent', `  ${title || policy.id}`));
            println(terminalThemeRow('Responsável', humanPolicyOwnerSummary(policy), { role: 'muted' }));
            println(
                terminalThemeRow('Eventos', `${events} · ${policyCount} recentes`, {
                    role: policyCount > 0 ? 'info' : 'muted',
                }),
            );
            println(
                terminalThemeRow('Investigar', detailMode ? buildPolicyQueryHints(policy) || '/events 50' : buildHumanPolicyQueryHint(policy), {
                    role: 'command',
                }),
            );
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

    const { query, format, rawMode } = parseEventsArg(arg);
    const defaultHumanTail = format === 'text' && !hasActiveEventFilters(query);
    const archiveQuery = defaultHumanTail
        ? { ...query, limit: Math.min(500, Math.max(100, query.limit * 5)) }
        : query;
    const projection = await readTerminalSseEventArchiveTail(archiveQuery);
    const { state, entries } = projection;
    const filters = defaultHumanTail ? { ...projection.filters, limit: query.limit } : projection.filters;

    if (format === 'json') {
        println(JSON.stringify({ state, filters, entries }, null, 2));
        return;
    }
    if (format === 'raw') {
        if (rawMode === 'full') {
            for (const entry of entries) println(JSON.stringify(entry));
            return;
        }
        println('');
        println(
            terminalThemeHeadline(
                'accent',
                `Eventos SSE raw - preview ${Math.min(entries.length, RAW_PREVIEW_LIMIT)}/${entries.length}`,
            ),
        );
        println(
            terminalThemeWrappedRow(
                'Registro',
                `${compactTerminalOperatorToolText(state.path ?? '(sem arquivo)', 88)} · ${countLabel(state.events, 'evento', 'eventos')} · fila ${state.queueDepth}`,
                { role: 'muted' },
            ),
        );
        println(
            terminalThemeRow('Completo', `/events ${filters.limit} --raw full · /events ${filters.limit} --json`, {
                role: 'command',
            }),
        );
        for (const entry of entries.slice(0, RAW_PREVIEW_LIMIT)) println(JSON.stringify(createRawPreviewEntry(entry)));
        if (entries.length > RAW_PREVIEW_LIMIT) {
            println(
                terminalThemeRow('Ocultos', countLabel(entries.length - RAW_PREVIEW_LIMIT, 'evento', 'eventos'), {
                    role: 'muted',
                }),
            );
        }
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
        terminalThemeWrappedRow(
            'Registro',
            `${compactTerminalOperatorToolText(state.path ?? '(sem arquivo)', 88)} · ${countLabel(state.events, 'evento', 'eventos')} · fila ${state.queueDepth}`,
            { role: 'muted' },
        ),
    );
    println(terminalThemeRow('Filtro', filterParts.join(' · ') || 'nenhum', { role: 'muted' }));
    println(terminalThemeRow('Detalhe', '/events --raw preview · /events --raw full · /events --json · /events sources', { role: 'command' }));
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
    const visibleEntriesRaw = shouldAggregateDefaultEvents
        ? entries.filter((entry) => !isInternalDefaultEvent(entry) && !isRoutineDefaultEvent(entry))
        : entries;
    const visibleEntries =
        shouldAggregateDefaultEvents && visibleEntriesRaw.length > filters.limit
            ? visibleEntriesRaw.slice(-filters.limit)
            : visibleEntriesRaw;
    if (visibleEntries.length === 0) {
        println(
            terminalThemeRow('Resultado', 'Nenhum evento operacional visível; use /events --raw para auditoria completa.', {
                role: 'muted',
            }),
        );
        println('');
        return;
    }
    const eventRows = visibleEntries.map((entry) => {
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
        const label = humanEventLabel(entry.event, entry.payload ?? {});
        const rawSummary = summarizePayload(entry.payload ?? {}, {
            showIds: showDiagnosticIds,
            event: entry.event,
        });
        const summary = isRedundantEventSummary(label, rawSummary) ? '' : rawSummary;
        const transcriptHint = buildTranscriptExportHint(entry, { showIds: showDiagnosticIds });
        const detail = [summary, transcriptHint].filter(Boolean).join(' · ');
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
                { role: 'muted', width: 22, truncateLabel: true },
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
