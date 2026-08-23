// @ts-check
/**
 * Comando `/events` — consulta o archive duravel de eventos SSE publicos do terminal.
 *
 * @module copilot/terminal/commands/events
 */

import { redactSecretRecord } from '#copilot/infra/public/observability/redaction';
import {
    classifyRuntimeSdkRateLimitScope,
    describeSdkRecoveryPolicy,
    getSdkRecoveryPolicy,
} from '../../presentation/sdk/index.js';
import {
    EMPTY_AFTER_USER_INPUT_DEFAULT_DETAIL,
    listTerminalPublicStreamSourcePolicies,
    summarizeEmptyAfterUserInputRecovery,
} from '../events/index.js';
import { renderTerminalLlmUsageClassification, renderTerminalLlmUsageReason } from '../events/presenters/index.js';
import {
    compactTerminalDiagnosticId,
    compactTerminalOperatorToolText,
    formatTerminalToolPathForOperator,
    getTerminalHumanToolName,
} from '../events/presenters/tools/index.js';
import {
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
 *     jsonMode: 'full' | 'compact';
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
    /** @type {'full' | 'compact'} */
    let jsonMode = 'full';
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
        } else if (
            token === '--compact' ||
            token === 'compact' ||
            token === 'json=compact' ||
            token === 'format=json-compact'
        ) {
            jsonMode = 'compact';
            if (format !== 'raw') format = 'json';
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
        jsonMode,
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
    const visibleLabels = labels.slice(0, 3);
    const suffix = labels.length > visibleLabels.length ? ` +${labels.length - visibleLabels.length}` : '';
    const subject = visibleLabels.length > 0 ? `${visibleLabels.join(' + ')}${suffix}` : humanPolicyId(policy.id);
    return `ver ${subject}: /events 50`;
}

/**
 * @param {string[]} events
 * @param {{ detailMode: boolean }} opts
 * @returns {string}
 */
function renderEventsSourcePolicyEventList(events, opts) {
    const labels = uniqueHumanEventLabels(events);
    const visibleLabels = opts.detailMode ? labels : labels.slice(0, 3);
    const suffix = labels.length > visibleLabels.length ? ` +${labels.length - visibleLabels.length}` : '';
    return visibleLabels.length > 0 ? `${visibleLabels.join(', ')}${suffix}` : '-';
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
    if (event === 'user.message') return 'Mensagem do operador';
    if (event === 'user_input.requested') return 'Pergunta ao operador';
    if (event === 'user_input.completed') return 'Resposta do operador';
    if (event === 'tool.lifecycle') return 'Ferramenta';
    if (event === 'tool.user_requested') return 'Ferramenta solicitada';
    if (event === 'tool.execution_start') return 'Ferramenta iniciada';
    if (event === 'tool.execution_progress') return 'Ferramenta em andamento';
    if (event === 'tool.execution_partial_result') return 'Resultado parcial';
    if (event === 'tool.execution_complete') return 'Ferramenta concluída';
    if (event === 'external_tool.requested') return 'Ferramenta externa solicitada';
    if (event === 'external_tool.completed') return 'Ferramenta externa concluída';
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
    if (event === 'dialog.empty_after_user_input.auto_recovery') return 'Continuação automática';
    if (event === 'dialog.empty_after_user_input.auto_recovery_failed') return 'Continuação falhou';
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
    if (event === 'session.permissions_changed') return 'Permissões da sessão';
    if (event === 'model.call_failure') return 'Falha do modelo';
    if (event === 'hook.progress') return 'Rotina em andamento';
    if (event === 'session.canvas.opened') return 'Canvas aberto';
    if (event === 'session.canvas.registry_changed') return 'Canvas disponíveis';
    if (event === 'mcp_app.tool_call_complete') return 'MCP App concluído';
    if (event === 'session.autopilot_objective_changed') return 'Objetivo autopiloto';
    if (event === 'extension_context') return 'Contexto de extensão';
    if (event === 'session.custom_agents_updated') return 'Agentes customizados';
    if (event === 'session.custom_notification') return 'Notificação customizada';
    if (event === 'session.extensions.attachments_pushed') return 'Anexos de extensão';
    if (event === 'session.remote_steerable_changed') return 'Controle remoto';
    if (event === 'session.schedule_created') return 'Agendamento criado';
    if (event === 'session.schedule_cancelled') return 'Agendamento cancelado';
    if (event === 'new_inbox_message') return 'Mensagem recebida';
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
    if (event === 'text') return 'Conteúdo de texto';
    if (event === 'image') return 'Imagem';
    if (event === 'audio') return 'Áudio';
    if (event === 'blob') return 'Blob';
    if (event === 'resource') return 'Recurso';
    if (event === 'resource_link') return 'Link de recurso';
    if (event === 'file') return 'Arquivo';
    if (event === 'directory') return 'Diretório';
    if (event === 'selection') return 'Seleção';
    if (event === 'object') return 'Objeto';
    if (event === 'function') return 'Função';
    if (event === 'terminal') return 'Terminal';
    if (event === 'github_reference') return 'Referência GitHub';
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
    const usageLabel = renderTerminalLlmUsageClassification(text) || renderTerminalLlmUsageReason(text);
    if (usageLabel) return usageLabel;
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
    if (lower.startsWith('sdk/session.permissions_changed')) return 'controle de permissões';
    if (lower.startsWith('sdk/model.call_failure')) return 'modelo via SDK';
    if (lower.startsWith('sdk/hook.progress')) return 'rotinas do SDK';
    if (lower.startsWith('sdk/session.canvas')) return 'canvas via SDK';
    if (lower.startsWith('sdk/mcp_app') || lower.startsWith('sdk/mcp-app')) return 'MCP App via SDK';
    if (lower.startsWith('sdk/extension_context')) return 'extensão via SDK';
    if (lower.startsWith('sdk/new_inbox_message')) return 'caixa de entrada via SDK';
    if (
        lower.startsWith('sdk/session.autopilot') ||
        lower.startsWith('sdk/session.custom') ||
        lower.startsWith('sdk/session.extensions.attachments') ||
        lower.startsWith('sdk/session.remote_steerable') ||
        lower.startsWith('sdk/session.schedule')
    ) {
        return 'extensões/sessão via SDK';
    }
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
    if (text === 'text') return 'texto';
    if (text === 'image') return 'imagem';
    if (text === 'audio') return 'áudio';
    if (text === 'blob') return 'blob';
    if (text === 'resource') return 'recurso';
    if (text === 'resource_link') return 'link de recurso';
    if (text === 'file') return 'arquivo';
    if (text === 'directory') return 'diretório';
    if (text === 'selection') return 'seleção';
    if (text === 'object') return 'objeto';
    if (text === 'function') return 'função';
    if (text === 'terminal') return 'terminal';
    if (text === 'github_reference') return 'referência GitHub';
    if (text === 'background' || text === 'background_task') return 'tarefa em segundo plano';
    if (text === 'runtime' || text === 'runtime_root') return 'ambiente';
    if (
        text === 'runtime_config' ||
        text === 'runtime.config' ||
        text === 'runtime config' ||
        text === 'runtime-config'
    ) {
        return 'configuração do ambiente';
    }
    if (text === 'preflight') return 'checagem';
    if (text === 'premium interactions' || text === 'premium_interactions') return 'billing legacy por request';
    const usageLabel = renderTerminalLlmUsageClassification(text) || renderTerminalLlmUsageReason(text);
    if (usageLabel) return usageLabel;
    if (text === 'session.created') return 'sessão criada';
    if (text === 'session.deleted') return 'sessão removida';
    if (text === 'session.updated') return 'sessão atualizada';
    if (text === 'session.foreground') return 'sessão em primeiro plano';
    if (text === 'session.background') return 'sessão em segundo plano';
    if (text === 'session.shutdown') return 'sessão encerrada';
    if (text === 'configuration') return 'configuração';
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
        .replace(/\bPremium Requests?\b/giu, 'billing legacy por request');
}

/**
 * @param {Record<string, unknown>} payload
 * @returns {string}
 */
function summarizeAgentErrorPayload(payload) {
    const isByok = payload['byokEnabled'] === true || typeof payload['byokProviderType'] === 'string';
    const provider =
        typeof payload['byokProviderType'] === 'string' ? `provedor ${compact(payload['byokProviderType'], 28)}` : null;
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
    const assistantMessages =
        typeof payload['assistantMessageCount'] === 'number' ? payload['assistantMessageCount'] : null;
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
        deltaCount != null ? `deltas ${deltaCount}${deltaChars != null ? `/${deltaChars} caracteres` : ''}` : null,
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
        detail ? compact(detail, 120) : EMPTY_AFTER_USER_INPUT_DEFAULT_DETAIL,
        'continuação automática enviada uma vez',
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
 * @param {Record<string, unknown>} activity
 * @returns {boolean}
 */
function isAssistantTurnCompletionActivity(activity) {
    const label = normalizeEventSummaryText(activity['label']).toLowerCase();
    return label.includes('turno do assistente conclu');
}

/**
 * @param {Record<string, unknown> | null} previous
 * @returns {boolean}
 */
function isPublicAssistantActivity(previous) {
    if (!previous) return false;
    const text = `${previous['phase'] ?? ''} ${previous['label'] ?? ''} ${previous['detail'] ?? ''}`.toLowerCase();
    return (
        text.includes('streaming') ||
        text.includes('mensagem da llm-b recebida') ||
        text.includes('resposta conclu') ||
        text.includes('transmitindo resposta')
    );
}

/**
 * @param {Record<string, unknown>} current
 * @param {Record<string, unknown> | null} previous
 * @returns {string}
 */
function humanActivityLabel(current, previous) {
    if (!isAssistantTurnCompletionActivity(current)) return humanEventMessage(current['label']);
    if (isPublicAssistantActivity(previous)) return 'resposta pública finalizada';
    if (previous) return 'continuação do pedido';
    return 'etapa da LLM-B encerrada';
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
    const label = humanActivityLabel(current, previous);
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
    return [
        type ? `tipo ${compact(type, 48)}` : null,
        label ? compact(label, 72) : null,
        detail ? compact(detail, 96) : null,
    ]
        .filter(Boolean)
        .join(' · ');
}

/**
 * @param {Record<string, unknown>} payload
 * @returns {string}
 */
function summarizeTerminalRuntimePayload(payload) {
    const phase = humanPayloadKind(payload['phase']);
    const duration = typeof payload['durationMs'] === 'number' ? `${Math.round(payload['durationMs'])}ms` : '';
    const ok =
        payload['preflightOk'] === true ? 'checagem ok' : payload['preflightOk'] === false ? 'checagem falhou' : '';
    return [phase ? `fase ${compact(phase, 48)}` : null, ok || null, duration || null].filter(Boolean).join(' · ');
}

/**
 * @param {Record<string, unknown>} payload
 * @returns {string}
 */
function summarizeTerminalStartedPayload(payload) {
    const mode = humanPayloadKind(payload['operationMode']);
    const model = humanEventMessage(payload['model']);
    const tools = typeof payload['mcpToolCount'] === 'number' ? `${payload['mcpToolCount']} MCP` : '';
    const dialog =
        payload['dialogLoopActive'] === true
            ? 'diálogo ativo'
            : payload['dialogLoopActive'] === false
              ? 'diálogo inativo'
              : '';
    const preflight = isRecord(payload['bootPreflight']) ? payload['bootPreflight'] : null;
    const preflightLabel = humanPayloadKind('preflight');
    const preflightStatus =
        preflight?.['ok'] === true
            ? `${preflightLabel} ok`
            : preflight?.['ok'] === false
              ? `${preflightLabel} falhou`
              : '';
    return [
        mode || null,
        model ? `modelo ${compact(model, 48)}` : null,
        tools || null,
        dialog || null,
        preflightStatus || null,
    ]
        .filter(Boolean)
        .join(' · ');
}

/**
 * @param {Record<string, unknown>} payload
 * @returns {string}
 */
function summarizeQuotaPayload(payload) {
    const quotaId = humanPayloadKind(payload['quotaId']);
    const snapshot = isRecord(payload['snapshot']) ? payload['snapshot'] : null;
    const hasQuota =
        snapshot?.['hasQuota'] === true ? 'quota disponível' : snapshot?.['hasQuota'] === false ? 'sem quota' : '';
    const remaining =
        typeof snapshot?.['remainingPercentage'] === 'number'
            ? `restante ${Math.round(snapshot['remainingPercentage'])}%`
            : '';
    const reset = typeof snapshot?.['resetDate'] === 'string' ? `reset ${compact(snapshot['resetDate'], 32)}` : '';
    return [quotaId ? compact(quotaId, 48) : 'quota', hasQuota || null, remaining || null, reset || null]
        .filter(Boolean)
        .join(' · ');
}

/**
 * @param {Record<string, unknown>} payload
 * @returns {string}
 */
function summarizeBackgroundPayload(payload) {
    const status = humanStatus(payload['status']) || (payload['pendingCount'] === 0 ? 'ocioso' : '');
    const label = humanEventMessage(payload['label'] ?? payload['description']);
    const duration = typeof payload['durationMs'] === 'number' ? `${Math.round(payload['durationMs'])}ms` : '';
    const pending = typeof payload['pendingCount'] === 'number' ? `pendentes ${payload['pendingCount']}` : '';
    return [status ? `estado ${status}` : null, label ? compact(label, 96) : null, duration || null, pending || null]
        .filter(Boolean)
        .join(' · ');
}

/**
 * @param {Record<string, unknown>} payload
 * @returns {Record<string, unknown>}
 */
function payloadDataOrSelf(payload) {
    return isRecord(payload['data']) ? /** @type {Record<string, unknown>} */ (payload['data']) : payload;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function humanMime(value) {
    const text = normalizeEventSummaryText(value);
    if (!text) return '';
    return text.replace(/^application\/octet-stream$/iu, 'binário');
}

/**
 * @param {Record<string, unknown>} item
 * @returns {string}
 */
function summarizeStructuredContentItem(item) {
    const type = humanPayloadKind(item['type']) || 'conteúdo';
    const title = humanEventMessage(item['title'] ?? item['displayName'] ?? item['name']);
    const mime = humanMime(item['mimeType']);
    const uri = humanEventMessage(item['uri'] ?? (isRecord(item['resource']) ? item['resource']['uri'] : null));
    const exitCode = typeof item['exitCode'] === 'number' ? `exit ${item['exitCode']}` : '';
    const text = typeof item['text'] === 'string' ? `${item['text'].length} caracteres` : '';
    const size = typeof item['size'] === 'number' ? `${Math.round(item['size'])} bytes` : '';
    return [
        type,
        title ? compact(title, 44) : null,
        mime || null,
        uri ? compact(uri, 52) : null,
        exitCode || null,
        text || null,
        size || null,
    ]
        .filter(Boolean)
        .join(' ');
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function summarizeStructuredContentList(value) {
    if (!Array.isArray(value) || value.length === 0) return '';
    const items = value
        .map((item) => (isRecord(item) ? summarizeStructuredContentItem(item) : humanPayloadKind(item)))
        .filter(Boolean)
        .slice(0, 4);
    const suffix = value.length > items.length ? ` +${value.length - items.length}` : '';
    return items.length ? `${countLabel(value.length, 'conteúdo', 'conteúdos')}: ${items.join(', ')}${suffix}` : '';
}

/**
 * @param {Record<string, unknown>} attachment
 * @returns {string}
 */
function summarizeAttachmentItem(attachment) {
    const type = humanPayloadKind(attachment['type']) || 'anexo';
    const title = humanEventMessage(
        attachment['displayName'] ??
            attachment['title'] ??
            attachment['path'] ??
            attachment['filePath'] ??
            attachment['url'],
    );
    const mime = humanMime(attachment['mimeType']);
    const referenceType = humanPayloadKind(attachment['referenceType']);
    const number = typeof attachment['number'] === 'number' ? `#${attachment['number']}` : '';
    return [type, title ? compact(title, 54) : null, referenceType || null, number || null, mime || null]
        .filter(Boolean)
        .join(' ');
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function summarizeAttachmentList(value) {
    if (!Array.isArray(value) || value.length === 0) return '';
    const items = value
        .map((item) => (isRecord(item) ? summarizeAttachmentItem(item) : humanPayloadKind(item)))
        .filter(Boolean)
        .slice(0, 4);
    const suffix = value.length > items.length ? ` +${value.length - items.length}` : '';
    return items.length ? `${countLabel(value.length, 'anexo', 'anexos')}: ${items.join(', ')}${suffix}` : '';
}

/**
 * @param {Record<string, unknown>} payload
 * @returns {string}
 */
function summarizeMultimodalPayload(payload) {
    const data = payloadDataOrSelf(payload);
    const result = isRecord(data['result']) ? /** @type {Record<string, unknown>} */ (data['result']) : data;
    const contentBlocks = summarizeStructuredContentList(
        result['contents'] ?? result['contentBlocks'] ?? data['contents'],
    );
    const attachments = summarizeAttachmentList(data['attachments']);
    const uiResource = isRecord(result['uiResource']) ? summarizeStructuredContentItem(result['uiResource']) : '';
    return [contentBlocks, attachments, uiResource ? `UI ${uiResource}` : null].filter(Boolean).join(' · ');
}

/**
 * @param {Record<string, unknown>} data
 * @returns {{ status: number | null; message: string; code?: string; errorType?: string }}
 */
function createModelCallFailureErrorFingerprint(data) {
    const status = typeof data['statusCode'] === 'number' ? data['statusCode'] : null;
    const message =
        typeof data['errorMessage'] === 'string' && data['errorMessage'].trim().length > 0
            ? data['errorMessage']
            : typeof data['message'] === 'string'
              ? data['message']
              : '';
    return {
        status,
        message,
        ...(typeof data['code'] === 'string' ? { code: data['code'] } : {}),
        ...(typeof data['errorType'] === 'string' ? { errorType: data['errorType'] } : {}),
    };
}

/**
 * @param {ReturnType<typeof getSdkRecoveryPolicy>['kind']} kind
 * @param {unknown} fingerprint
 * @returns {string}
 */
function humanModelCallFailureKind(kind, fingerprint) {
    if (kind === 'rate_limit') {
        const scope = classifyRuntimeSdkRateLimitScope(fingerprint);
        if (scope === 'session') return 'limite de sessão';
        if (scope === 'weekly_model') return 'limite semanal/modelo';
        return 'rate limit';
    }
    if (kind === 'quota_exhausted') return 'quota esgotada';
    if (kind === 'account') return 'conta/cobrança';
    if (kind === 'auth') return 'autenticação';
    if (kind === 'model_unsupported') return 'modelo incompatível';
    if (kind === 'network') return 'rede';
    if (kind === 'timeout') return 'timeout';
    return 'não classificada';
}

/**
 * @param {Record<string, unknown>} payload
 * @returns {string}
 */
function summarizeModelCallFailurePayload(payload) {
    const data = payloadDataOrSelf(payload);
    const model = typeof data['model'] === 'string' ? data['model'] : '';
    const source = humanPayloadKind(data['source']);
    const statusCode = typeof data['statusCode'] === 'number' ? `HTTP ${data['statusCode']}` : '';
    const durationMs = typeof data['durationMs'] === 'number' ? `${Math.round(data['durationMs'])}ms` : '';
    const message = humanEventMessage(data['errorMessage']);
    const fingerprint = createModelCallFailureErrorFingerprint(data);
    const policy = getSdkRecoveryPolicy(fingerprint, 'session');
    const recoveryMessage = describeSdkRecoveryPolicy(policy, fingerprint);
    const failureKind = humanModelCallFailureKind(policy.kind, fingerprint);
    const requestId =
        typeof data['serviceRequestId'] === 'string'
            ? compactTerminalDiagnosticId(data['serviceRequestId'], 16)
            : typeof data['providerCallId'] === 'string'
              ? compactTerminalDiagnosticId(data['providerCallId'], 16)
              : '';
    return [
        model ? `modelo ${compact(model, 48)}` : null,
        source ? `origem ${compact(source, 32)}` : null,
        `classe ${failureKind}`,
        statusCode || null,
        durationMs || null,
        message ? compact(message, 96) : null,
        recoveryMessage.actionHint ? compact(recoveryMessage.actionHint, 96) : null,
        requestId ? `request ${requestId}` : null,
    ]
        .filter(Boolean)
        .join(' · ');
}

/**
 * @param {Record<string, unknown>} payload
 * @returns {string}
 */
function summarizePermissionsChangedPayload(payload) {
    const data = payloadDataOrSelf(payload);
    const current = data['allowAllPermissions'];
    const previous = data['previousAllowAllPermissions'];
    if (typeof current === 'boolean' && typeof previous === 'boolean') {
        if (current === previous) return current ? 'aprovação ampla já ativa' : 'aprovação ampla segue desativada';
        return current ? 'aprovação ampla ativada' : 'aprovação ampla desativada';
    }
    if (typeof current === 'boolean') return current ? 'aprovação ampla ativa' : 'aprovação ampla desativada';
    return 'estado de permissões alterado';
}

/**
 * @param {Record<string, unknown>} payload
 * @returns {string}
 */
function summarizeCanvasOpenedPayload(payload) {
    const data = payloadDataOrSelf(payload);
    const title = humanEventMessage(data['title']);
    const extensionName = humanEventMessage(data['extensionName']);
    const availability = humanStatus(data['availability']);
    const status = humanEventMessage(data['status']);
    const reopen = data['reopen'] === true ? 'reabertura' : '';
    return [
        title ? compact(title, 72) : 'canvas sem título',
        extensionName ? `extensão ${compact(extensionName, 48)}` : null,
        availability ? `estado ${compact(availability, 32)}` : null,
        status ? compact(status, 72) : null,
        reopen || null,
    ]
        .filter(Boolean)
        .join(' · ');
}

/**
 * @param {Record<string, unknown>} payload
 * @returns {string}
 */
function summarizeCanvasRegistryChangedPayload(payload) {
    const data = payloadDataOrSelf(payload);
    const canvases = Array.isArray(data['canvases']) ? data['canvases'] : [];
    const names = canvases
        .map((canvas) => (isRecord(canvas) ? humanEventMessage(canvas['displayName'] ?? canvas['canvasId']) : ''))
        .filter(Boolean)
        .slice(0, 3);
    const suffix = canvases.length > names.length ? ` +${canvases.length - names.length}` : '';
    return [
        `${countLabel(canvases.length, 'canvas disponível', 'canvas disponíveis')}`,
        names.length ? `${names.join(', ')}${suffix}` : null,
    ]
        .filter(Boolean)
        .join(' · ');
}

/**
 * @param {Record<string, unknown>} payload
 * @returns {string}
 */
function summarizeMcpAppToolCallCompletePayload(payload) {
    const data = payloadDataOrSelf(payload);
    const appName = humanEventMessage(data['appName'] ?? data['app'] ?? data['extensionName'] ?? data['serverName']);
    const toolName = humanEventMessage(data['toolName'] ?? data['name']);
    const status = humanStatus(data['status'] ?? data['resultType']);
    const title = humanEventMessage(data['title'] ?? data['displayName']);
    const uri = humanEventMessage(data['uri'] ?? data['resourceUri']);
    return [
        appName ? `app ${compact(appName, 48)}` : 'MCP App',
        toolName ? `tool ${compact(toolName, 48)}` : null,
        status ? `estado ${compact(status, 32)}` : null,
        title ? compact(title, 72) : null,
        uri ? `recurso ${compact(uri, 52)}` : null,
    ]
        .filter(Boolean)
        .join(' · ');
}

/**
 * @param {Record<string, unknown>} payload
 * @param {string} event
 * @returns {string}
 */
function summarizeSdkExtensionSignalPayload(payload, event) {
    const nested = payloadDataOrSelf(payload);
    const data = nested === payload ? payload : { ...payload, ...nested };
    if (event === 'session.autopilot_objective_changed') {
        const objective = humanEventMessage(data['objective'] ?? data['title'] ?? data['summary']);
        return objective ? `objetivo ${compact(objective, 96)}` : 'objetivo atualizado';
    }
    if (event === 'extension_context') {
        const extensionName = humanEventMessage(data['extensionName'] ?? data['extension'] ?? data['name']);
        const contextType = humanPayloadKind(data['contextType'] ?? data['kind'] ?? data['type']);
        return [extensionName ? `extensão ${compact(extensionName, 48)}` : 'contexto recebido', contextType || null]
            .filter(Boolean)
            .join(' · ');
    }
    if (event === 'session.custom_agents_updated') {
        const agents = Array.isArray(data['agents'])
            ? data['agents']
            : Array.isArray(data['customAgents'])
              ? data['customAgents']
              : [];
        const count = typeof data['count'] === 'number' ? data['count'] : agents.length;
        const names = agents
            .map((agent) =>
                isRecord(agent) ? humanEventMessage(agent['name'] ?? agent['displayName'] ?? agent['id']) : '',
            )
            .filter(Boolean)
            .slice(0, 3);
        return [
            `${countLabel(count, 'agente', 'agentes')}`,
            names.length ? names.map((name) => compact(name, 32)).join(', ') : null,
        ]
            .filter(Boolean)
            .join(' · ');
    }
    if (event === 'session.custom_notification') {
        const title = humanEventMessage(data['title']);
        const message = humanEventMessage(data['message']);
        const level = humanStatus(data['level'] ?? data['severity']);
        return [
            title ? compact(title, 48) : null,
            message ? compact(message, 96) : null,
            level ? `nível ${level}` : null,
        ]
            .filter(Boolean)
            .join(' · ');
    }
    if (event === 'session.extensions.attachments_pushed') {
        const attachments = Array.isArray(data['attachments']) ? data['attachments'] : [];
        const count = typeof data['count'] === 'number' ? data['count'] : attachments.length;
        const extensionName = humanEventMessage(data['extensionName'] ?? data['extension']);
        return [
            `${countLabel(count, 'anexo', 'anexos')}`,
            extensionName ? `extensão ${compact(extensionName, 48)}` : null,
        ]
            .filter(Boolean)
            .join(' · ');
    }
    if (event === 'session.remote_steerable_changed') {
        const enabled = data['enabled'] ?? data['remoteSteerable'];
        if (enabled === true) return 'controle remoto ativado';
        if (enabled === false) return 'controle remoto desativado';
        return 'controle remoto alterado';
    }
    if (event === 'session.schedule_created' || event === 'session.schedule_cancelled') {
        const title = humanEventMessage(data['title'] ?? data['name']);
        const scheduleId = humanEventMessage(data['scheduleId'] ?? data['id']);
        const cadence = humanEventMessage(data['cadence'] ?? data['cron'] ?? data['when']);
        return [
            title
                ? compact(title, 64)
                : event === 'session.schedule_created'
                  ? 'agendamento criado'
                  : 'agendamento cancelado',
            scheduleId ? `id ${compact(scheduleId, 24)}` : null,
            cadence ? compact(cadence, 48) : null,
        ]
            .filter(Boolean)
            .join(' · ');
    }
    if (event === 'new_inbox_message') {
        const message = humanEventMessage(data['message'] ?? data['subject'] ?? data['title']);
        const sender = humanEventMessage(data['sender'] ?? data['from']);
        return [sender ? `de ${compact(sender, 40)}` : null, message ? compact(message, 96) : 'mensagem recebida']
            .filter(Boolean)
            .join(' · ');
    }
    return '';
}

/**
 * @param {Record<string, unknown>} payload
 * @param {{ showIds?: boolean; event?: string }} [opts]
 * @returns {string}
 */
function summarizePayload(payload, opts = {}) {
    if (opts.event === 'terminal.runtime.wired') {
        const summary = summarizeTerminalRuntimePayload(payload);
        if (summary) return summary;
    }
    if (opts.event === 'terminal.started') {
        const summary = summarizeTerminalStartedPayload(payload);
        if (summary) return summary;
    }
    if (opts.event === 'quota.warning') {
        const summary = summarizeQuotaPayload(payload);
        if (summary) return summary;
    }
    if (opts.event === 'agent.background.completed' || opts.event === 'agent.background.idle') {
        const summary = summarizeBackgroundPayload(payload);
        if (summary) return summary;
    }
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
    if (opts.event === 'model.call_failure') {
        const summary = summarizeModelCallFailurePayload(payload);
        if (summary) return summary;
    }
    if (opts.event === 'session.permissions_changed') {
        const summary = summarizePermissionsChangedPayload(payload);
        if (summary) return summary;
    }
    if (opts.event === 'session.canvas.opened') {
        const summary = summarizeCanvasOpenedPayload(payload);
        if (summary) return summary;
    }
    if (opts.event === 'session.canvas.registry_changed') {
        const summary = summarizeCanvasRegistryChangedPayload(payload);
        if (summary) return summary;
    }
    if (opts.event === 'mcp_app.tool_call_complete') {
        const summary = summarizeMcpAppToolCallCompletePayload(payload);
        if (summary) return summary;
    }
    if (
        opts.event === 'session.autopilot_objective_changed' ||
        opts.event === 'extension_context' ||
        opts.event === 'session.custom_agents_updated' ||
        opts.event === 'session.custom_notification' ||
        opts.event === 'session.extensions.attachments_pushed' ||
        opts.event === 'session.remote_steerable_changed' ||
        opts.event === 'session.schedule_created' ||
        opts.event === 'session.schedule_cancelled' ||
        opts.event === 'new_inbox_message'
    ) {
        const summary = summarizeSdkExtensionSignalPayload(payload, opts.event);
        if (summary) return summary;
    }
    if (opts.event === 'hook.progress' && typeof payloadDataOrSelf(payload)['message'] === 'string') {
        return compact(humanEventMessage(payloadDataOrSelf(payload)['message']), 140);
    }
    if (opts.event === 'tool.execution_complete' || opts.event === 'user.message') {
        const summary = summarizeMultimodalPayload(payload);
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
        const previous =
            typeof previousModel === 'string' && previousModel.trim().length > 0
                ? previousModel.trim()
                : 'modelo anterior n/d';
        const effort =
            typeof payload['reasoningEffort'] === 'string' && payload['reasoningEffort'].trim().length > 0
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
        renderedClassification && !classificationIsRedundant
            ? `${classificationLabel} ${compact(renderedClassification)}`
            : null,
        content ? compact(humanEventMessage(content)) : null,
    ]
        .filter(Boolean)
        .join(' · ');
}

/**
 * @param {Record<string, unknown> | null | undefined} payload
 * @param {string} event
 * @param {{ preferPublicPayload?: boolean }} [opts]
 * @returns {{ payloadKeys: string[]; payloadPreview: string | null }}
 */
function summarizeRawPreviewPayload(payload, event, opts = {}) {
    if (!payload || typeof payload !== 'object') return { payloadKeys: [], payloadPreview: null };
    const redactedPayload = redactSecretRecord(payload);
    const payloadKeys = Object.keys(redactedPayload).slice(0, 12);
    if (opts.preferPublicPayload === true && event === 'delta' && typeof redactedPayload['publicChunk'] === 'string') {
        const publicChunk = redactedPayload['publicChunk'];
        return {
            payloadKeys,
            payloadPreview: publicChunk.trim() ? compact(publicChunk, 180) : '(delta público vazio)',
        };
    }
    const summary = summarizePayload(redactedPayload, { showIds: true, event });
    const payloadPreview = summary || compact(JSON.stringify(redactedPayload), 180);
    return { payloadKeys, payloadPreview: payloadPreview || null };
}

/**
 * @param {Record<string, unknown>} entry
 * @returns {Record<string, unknown>}
 */
function redactRawEventEntry(entry) {
    return redactSecretRecord(entry);
}

/**
 * @param {unknown} value
 * @param {string[]} fieldNames
 * @param {number} [depth=0] Default is `0`
 * @returns {string | null}
 */
function findCompactPayloadString(value, fieldNames, depth = 0) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 2) return null;
    const record = /** @type {Record<string, unknown>} */ (value);
    for (const fieldName of fieldNames) {
        const fieldValue = record[fieldName];
        if (typeof fieldValue === 'string' && fieldValue.length > 0) return fieldValue;
    }
    for (const nestedKey of ['data', 'payload', 'request', 'invocation', 'context', 'toolCall', 'permission']) {
        const found = findCompactPayloadString(record[nestedKey], fieldNames, depth + 1);
        if (found) return found;
    }
    return null;
}

/**
 * @param {Record<string, unknown>} entry
 * @param {{ preferPublicPayload?: boolean }} [opts]
 * @returns {Record<string, unknown>}
 */
function createRawPreviewEntry(entry, opts = {}) {
    const event = typeof entry['event'] === 'string' ? entry['event'] : 'event';
    const payload = /** @type {Record<string, unknown> | null | undefined} */ (entry['payload']);
    const payloadSummary = summarizeRawPreviewPayload(payload, event, opts);
    const toolCallId = findCompactPayloadString(payload, ['toolCallId', 'tool_call_id', 'callId']);
    const requestId = findCompactPayloadString(payload, ['requestId', 'request_id', 'pendingRequestId']);
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
        toolCallId,
        requestId,
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
 * O resumo default de `/events` e uma trilha operacional para o operador humano. Eventos de manutencao continuam no
 * archive, em `--raw`/`--json` e em filtros explicitos.
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
            println(terminalThemeRow('Mais detalhes', '/events sources detail', { role: 'command' }));
        }
        println(
            terminalThemeRow('Formatos', '/events --json compact · /events --raw preview · /events --raw full', {
                role: 'command',
            }),
        );
        println(
            terminalThemeRow('Segurança', 'payload público redigido; compacto usa preview e ids de filtro', {
                role: 'muted',
            }),
        );
        for (const policy of policies) {
            const policyCount = policy.publicEvents.reduce((sum, event) => sum + (counts.get(event) ?? 0), 0);
            const humanEvents = uniqueHumanEventLabels(policy.publicEvents);
            const events = renderEventsSourcePolicyEventList(policy.publicEvents, { detailMode });
            const title = detailMode ? policy.id : humanEvents.slice(0, 2).join(' + ');
            println(terminalThemeText('accent', `  ${title || policy.id}`));
            println(terminalThemeRow('Responsável', humanPolicyOwnerSummary(policy), { role: 'muted' }));
            println(
                terminalThemeRow('Eventos', `${events} · ${policyCount} recentes`, {
                    role: policyCount > 0 ? 'info' : 'muted',
                }),
            );
            println(
                terminalThemeRow(
                    'Investigar',
                    detailMode ? buildPolicyQueryHints(policy) || '/events 50' : buildHumanPolicyQueryHint(policy),
                    {
                        role: 'command',
                    },
                ),
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

    const { query, format, jsonMode, rawMode } = parseEventsArg(arg);
    const defaultHumanTail = format === 'text' && !hasActiveEventFilters(query);
    const archiveQuery = defaultHumanTail ? { ...query, limit: Math.min(500, Math.max(100, query.limit * 5)) } : query;
    const projection = await readTerminalSseEventArchiveTail(archiveQuery);
    const { state, entries } = projection;
    const filters = defaultHumanTail ? { ...projection.filters, limit: query.limit } : projection.filters;

    if (format === 'json') {
        const jsonEntries =
            jsonMode === 'compact'
                ? entries.map((entry) => createRawPreviewEntry(entry, { preferPublicPayload: true }))
                : entries;
        println(JSON.stringify(redactSecretRecord({ state, filters, entries: jsonEntries }), null, 2));
        return;
    }
    if (format === 'raw') {
        if (rawMode === 'full') {
            for (const entry of entries) println(JSON.stringify(redactRawEventEntry(entry)));
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
            terminalThemeRow(
                'Completo',
                `/events ${filters.limit} --raw full · JSON leve /events ${filters.limit} --json compact · JSON full /events ${filters.limit} --json`,
                { role: 'command' },
            ),
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
    println(
        terminalThemeRow(
            'Mais detalhes',
            '/events --raw preview · /events --raw full · /events --json compact · /events sources',
            {
                role: 'command',
            },
        ),
    );
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
    const shouldAggregateDefaultEvents =
        !showDiagnosticIds && !hasActiveEventFilters(/** @type {Record<string, unknown>} */ (filters));
    const visibleEntriesRaw = shouldAggregateDefaultEvents
        ? entries.filter((entry) => !isInternalDefaultEvent(entry) && !isRoutineDefaultEvent(entry))
        : entries;
    const visibleEntries =
        shouldAggregateDefaultEvents && visibleEntriesRaw.length > filters.limit
            ? visibleEntriesRaw.slice(-filters.limit)
            : visibleEntriesRaw;
    if (visibleEntries.length === 0) {
        println(
            terminalThemeRow(
                'Resultado',
                'Nenhum evento operacional visível; use /events --raw para auditoria completa.',
                {
                    role: 'muted',
                },
            ),
        );
        println('');
        return;
    }
    const eventRows = visibleEntries.map((entry) => {
        const time = showDiagnosticIds
            ? formatTerminalTimeLabel(entry.timestamp, { now, mode: 'dual' })
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
