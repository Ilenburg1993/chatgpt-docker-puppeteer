// @ts-check
/**
 * src/copilot/terminal/events/agent-runtime-events.js
 *
 * Tradução dos sinais já normalizados do runtime/agent para a UX local do terminal.
 *
 * Aqui entram eventos que NÃO são payload vanilla direto do SDK, mas sim sinais já estabilizados pelo runtime local,
 * como `question.pending`, tool lifecycle normalizado, compaction e subagentes.
 *
 * @module copilot/terminal/agent-runtime-events
 */

import { readConfiguredByokSummary } from '#copilot/config';
import {
    cancelTimer,
    redactSecretRecord,
    redactSecretText,
    registerInterval,
    resolveModelSelectionMismatch,
} from '#copilot/core';
import {
    EMITTER_AGENT_BACKGROUND_COMPLETED,
    EMITTER_AGENT_BACKGROUND_IDLE,
    EMITTER_ASSISTANT_INTENT,
    EMITTER_DIALOG_BOOT_RECOVERY,
    EMITTER_ERROR,
    EMITTER_LLM_USAGE,
    EMITTER_QUESTION_PENDING,
    EMITTER_SDK_COMMAND_EXECUTED,
    EMITTER_SDK_LIFECYCLE,
    EMITTER_SESSION_COMPACTION_COMPLETE,
    EMITTER_SESSION_COMPACTION_START,
    EMITTER_SESSION_ERROR,
    EMITTER_STOPPED,
    EMITTER_SUBAGENT_COMPLETED,
    EMITTER_SUBAGENT_FAILED,
    EMITTER_SUBAGENT_STARTED,
    EMITTER_TOOL_EXECUTION_COMPLETE,
    EMITTER_TOOL_EXECUTION_PARTIAL_RESULT,
    EMITTER_TOOL_EXECUTION_PROGRESS,
    EMITTER_TOOL_EXECUTION_START,
} from '#copilot/events';
import {
    classifyByokProviderFailure,
    recordByokProviderModelCallFailure,
    recordByokProviderModelCallSuccess,
} from '#copilot/model-gateway';
import { defaultErrorTracker } from '#copilot/observability';
import { getShowSessionActivity, getShowToolActivity, getShowUsage } from '../../presentation/state/index.js';
import {
    broadcastSse,
    buildUserPrompt,
    isTerminalRenderLocked,
    println,
    scheduleTerminalPromptRedraw,
    writeInlineStatus,
} from '../dialog/index.js';
import { readTerminalRuntimeState } from '../frontend/gateways/index.js';
import {
    completeTerminalTurnMaterialization,
    completeTerminalTurnTrace,
    createTerminalPendingQuestionReplayState,
    createToolCallRegistry,
    getTerminalDetailLevel,
    recordTerminalActivity,
    reviseRecentTerminalTurnTraceStatus,
    terminalThemeRow,
    terminalThemeText,
    withTerminalTurnCorrelation,
} from '../state/events/index.js';
import { formatTerminalTimeLabel } from '../state/ui/index.js';
import { printTerminalHumanQuestionCard } from './human-question-renderer.js';
import { renderTerminalIntent } from './intent-renderer.js';
import {
    compactTerminalDiagnosticId,
    compactTerminalToolText,
    getTerminalHumanToolName,
} from './tool-activity-presenter.js';
import {
    handleTerminalNativeToolComplete,
    handleTerminalNativeToolPartialResult,
    handleTerminalNativeToolProgress,
    handleTerminalNativeToolStart,
} from './tool-lifecycle-runtime.js';

const AGENT_SHELL_COMPLETED_EVENT = 'agent.shell.completed';
const AGENT_SHELL_DETACHED_COMPLETED_EVENT = 'agent.shell.detached_completed';
const AGENT_PR_CONSUMED_EVENT = 'pr.consumed';
const AGENT_PR_FALLBACK_MODEL_EVENT = 'pr.fallback_model';

const INTERNAL_BACKGROUND_DESCRIPTION_PATTERNS = [
    /^persist\b/i,
    /^read persisted state\b/i,
    /^sync resumed session history\b/i,
    /^cleanup stale sdk sessions\b/i,
    /^retry dialog loop recovery\b/i,
    /^relay question\.answered answers into hook tools resolver$/i,
    /^clear persisted pendingQuestion$/i,
    /^always_alive$/i,
];

const BACKGROUND_DESCRIPTION_LABELS = new Map([
    [
        'Relay question.answered answers into hook tools resolver',
        'Resposta humana entregue ao resolvedor da ferramenta',
    ],
    ['Clear persisted pendingQuestion', 'Pergunta pendente persistida limpa'],
    ['Persist pendingQuestion + pendingQuestionMeta + lastAskUserAt', 'Pergunta pendente salva para retomada'],
    ['Read persisted state', 'Estado persistido lido'],
    ['Sync resumed session history', 'Histórico da sessão retomada sincronizado'],
    ['Cleanup stale SDK sessions', 'Sessões SDK antigas limpas'],
    ['Retry dialog loop recovery', 'Recuperação da conversa reprogramada'],
    ['always_alive', 'Pulso da sessão permanente'],
]);

/**
 * Evita que eventos auxiliares de runtime atravessem blocos de streaming/reasoning. O conteúdo não é perdido: activity
 * e SSE continuam recebendo os eventos, e a UX live preserva a resposta do assistente como bloco coeso.
 *
 * @param {string} line
 * @returns {void}
 */
function printlnWhenRenderUnlocked(line) {
    if (isTerminalRenderLocked()) return;
    println(line);
}

/**
 * @param {Record<string, unknown>} evt
 * @param {string} source
 * @returns {Record<string, unknown> & { traceId?: string; turnId?: string; timestamp: number; source: string }}
 */
function withAgentSseEnvelope(evt, source) {
    return withTerminalTurnCorrelation({
        ...evt,
        source: typeof evt['source'] === 'string' && evt['source'].trim().length > 0 ? evt['source'] : source,
        timestamp: Date.now(),
    });
}

/**
 * @param {string} description
 * @returns {boolean}
 */
function isInternalBackgroundDescription(description) {
    const normalized = description.trim();
    return INTERNAL_BACKGROUND_DESCRIPTION_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * @param {{ description: string; failed?: boolean }} input
 * @returns {{ print: boolean; recordHistory: boolean; updateCurrent: boolean; labelPrefix: string }}
 */
function classifyBackgroundNarration({ description, failed = false }) {
    if (failed) {
        return { print: true, recordHistory: true, updateCurrent: true, labelPrefix: 'Tarefa em segundo plano' };
    }
    if (isInternalBackgroundDescription(description)) {
        return {
            print: false,
            recordHistory: false,
            updateCurrent: false,
            labelPrefix: 'Tarefa interna',
        };
    }
    return { print: true, recordHistory: true, updateCurrent: false, labelPrefix: 'Tarefa em segundo plano' };
}

/**
 * @param {string} description
 * @returns {string}
 */
function renderBackgroundDescriptionForOperator(description) {
    const normalized = description.trim();
    if (!normalized) return 'tarefa sem descrição';
    const mapped = BACKGROUND_DESCRIPTION_LABELS.get(normalized);
    if (mapped) return mapped;
    return normalized
        .replace(/\bbackground\b/giu, 'segundo plano')
        .replace(/\bagent\b/giu, 'agente')
        .replace(/\bidle\b/giu, 'ociosa')
        .replace(/\bquestion\.answered\b/giu, 'resposta humana')
        .replace(/\bpendingQuestionMeta\b/gu, 'metadados da pergunta')
        .replace(/\bpendingQuestion\b/gu, 'pergunta pendente')
        .replace(/\blastAskUserAt\b/gu, 'horário da última pergunta')
        .replace(/\bSDK\b/g, 'SDK');
}

/**
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
function compactRuntimeId(value) {
    const compacted = compactTerminalDiagnosticId(value, 18);
    return compacted && compacted.length > 0 ? compacted : null;
}

/**
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
function renderRuntimeSessionLabel(value) {
    const compacted = compactRuntimeId(value);
    return compacted ? `sessão ${compacted}` : null;
}

/**
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
function renderRuntimeTimestampLabel(value) {
    if (!value) return null;
    return formatTerminalTimeLabel(value, { mode: 'dual' });
}

/**
 * @param {string} status
 * @returns {string}
 */
function renderRuntimeStatusLabel(status) {
    if (status === 'completed' || status === 'success') return 'concluído';
    if (status === 'failed' || status === 'error') return 'falhou';
    if (status === 'running' || status === 'active') return 'em andamento';
    if (status === 'pending') return 'pendente';
    return status;
}

/**
 * @param {string | null | undefined} errorType
 * @returns {string}
 */
function renderRuntimeErrorTypeLabel(errorType) {
    const normalized = errorType?.trim().toLowerCase() ?? '';
    if (normalized === 'query') return 'consulta';
    if (normalized === 'model_call') return 'chamada de modelo';
    if (normalized === 'rate_limit') return 'limite de taxa';
    if (normalized === 'quota') return 'quota';
    if (normalized === 'provider') return 'provider';
    if (normalized === 'network') return 'rede';
    if (normalized === 'fetch') return 'rede';
    return normalized || 'erro';
}

/**
 * @param {string[]} args
 * @returns {string | null}
 */
function renderRuntimeArgsLabel(args) {
    if (args.length === 0) return null;
    return `argumentos ${args.map((arg) => compactTerminalToolText(arg, 44)).join(' ')}`;
}

/**
 * @typedef {{
 *     on: (event: string, handler: (...args: any[]) => void) => void;
 *     off: (event: string, handler: (...args: any[]) => void) => void;
 * }} AgentEventHost
 */

const TOOL_HEARTBEAT_INTERVAL_MS = 10_000;
const RECOVERABLE_MODEL_ERROR_RENDER_THROTTLE_MS = 30_000;
const RECOVERABLE_MODEL_CALL_OPERATOR_DETAIL =
    'roteamento e retry delegados ao SDK; auto é a única recuperação permitida quando aplicável; sem pedido premium confirmado';
const RECOVERABLE_BYOK_MODEL_CALL_OPERATOR_DETAIL =
    'falha de provedor BYOK; fallback para Copilot auto bloqueado por contrato; retry automático bloqueado para não prender o terminal; troque provedor/modelo via /byok use ou /byok model; sem pedido premium';

/**
 * @returns {boolean}
 */
function shouldPersistToolHeartbeatNarration() {
    return process.env['COPILOT_TERMINAL_DURABLE_TOOL_HEARTBEAT'] === 'true';
}

/**
 * @param {string} value
 * @returns {string}
 */
function renderProviderFailureMessageForOperator(value) {
    const text = String(value ?? '').replace(/\s+/gu, ' ').trim();
    if (/^Erro do SDK sem mensagem estruturada\.?$/iu.test(text)) {
        return 'falha sem mensagem estruturada do SDK';
    }
    return text
        .replace(/\bprovider\b/giu, 'provedor')
        .replace(/\bPremium Request\b/giu, 'pedido premium')
        .replace(/\s+/gu, ' ')
        .trim();
}

/**
 * @param {Record<string, unknown>} evt
 * @param {string} message
 * @returns {string}
 */
function renderRecoverableByokModelCallErrorForOperator(evt, message) {
    const operatorMessage = renderProviderFailureMessageForOperator(message);
    const provider =
        typeof evt['byokProviderType'] === 'string'
            ? evt['byokProviderType']
            : typeof evt['byokPreset'] === 'string'
              ? evt['byokPreset']
              : '-';
    const profile = typeof evt['byokProfile'] === 'string' ? evt['byokProfile'] : '-';
    const model = typeof evt['byokModel'] === 'string' ? evt['byokModel'] : '-';
    return [
        '',
        terminalThemeRow('BYOK', `falha do provedor · ${operatorMessage}`, { role: 'warn' }),
        terminalThemeRow('Ação', 'troque provedor/modelo com /byok use ou /byok model', { role: 'command' }),
        terminalThemeRow('Recuperação', 'Copilot auto bloqueado por contrato · sem pedido premium', {
            role: 'muted',
        }),
        terminalThemeRow('Contexto', `provedor ${provider} · perfil ${profile} · modelo ${model}`, {
            role: 'muted',
        }),
    ].join('\n');
}

/** @type {Readonly<Record<string, string>>} */
const SDK_LIFECYCLE_LABELS = Object.freeze({
    'session.created': 'Sessão SDK criada',
    'session.deleted': 'Sessão SDK removida',
    'session.updated': 'Sessão SDK atualizada',
    'session.foreground': 'Sessão SDK em foreground',
    'session.background': 'Sessão SDK em background',
});

const SDK_LIFECYCLE_VISIBLE_TYPES = new Set(['session.created', 'session.foreground', 'session.background']);

/**
 * @param {Record<string, unknown>} evt
 * @returns {boolean}
 */
function isByokRecoverableModelCall(evt) {
    if (evt?.['byokEnabled'] === true) return true;
    const profile = typeof evt?.['byokProfile'] === 'string' ? evt['byokProfile'].trim() : '';
    const providerType = typeof evt?.['byokProviderType'] === 'string' ? evt['byokProviderType'].trim() : '';
    return profile.length > 0 || providerType.length > 0;
}

/**
 * @param {Record<string, unknown>} evt
 * @returns {string}
 */
function resolveRecoverableModelCallOperatorDetail(evt) {
    if (!isByokRecoverableModelCall(evt)) return RECOVERABLE_MODEL_CALL_OPERATOR_DETAIL;
    const providerType = typeof evt?.['byokProviderType'] === 'string' ? evt['byokProviderType'].trim() : '';
    const profile = typeof evt?.['byokProfile'] === 'string' ? evt['byokProfile'].trim() : '';
    const model = typeof evt?.['byokModel'] === 'string' ? evt['byokModel'].trim() : '';
    const bits = [
        RECOVERABLE_BYOK_MODEL_CALL_OPERATOR_DETAIL,
        providerType ? `provedor ${providerType}` : null,
        profile ? `perfil ${profile}` : null,
        model ? `modelo ${model}` : null,
    ].filter(Boolean);
    return bits.join(' · ');
}

/**
 * Registra em `/errors` apenas falhas que realmente chegaram à superfície do operador. Eventos recuperáveis do SDK
 * continuam fora do tracker por padrão; quando o BYOK bloqueia fallback/retry e encerra o turno, o operador precisa
 * encontrá-lo em `/errors` com a mesma orientação exibida em tela.
 *
 * @param {Error} error
 * @param {{ source: string; metadata?: Record<string, unknown> }} options
 * @returns {void}
 */
function trackOperatorVisibleTerminalError(error, options) {
    try {
        defaultErrorTracker?.trackError?.(error, {
            source: options.source,
            ...(options.metadata !== undefined ? { metadata: options.metadata } : {}),
        });
    } catch {
        // O tracker de erro nunca pode quebrar a renderização do terminal.
    }
}

/**
 * @param {string} value
 * @returns {string}
 */
function sanitizeOperationalErrorMessage(value) {
    return redactSecretText(value);
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeSdkLifecycleString(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * @param {Record<string, unknown>} metadata
 * @returns {Record<string, unknown>}
 */
function sanitizeSdkLifecycleMetadata(metadata) {
    const redacted = redactSecretRecord(metadata);
    const out = /** @type {Record<string, unknown>} */ ({});
    for (const [key, value] of Object.entries(redacted)) {
        if (typeof value === 'string') {
            out[key] = value;
            continue;
        }
        if (value === null || ['number', 'boolean'].includes(typeof value)) {
            out[key] = value;
        }
    }
    return out;
}

/**
 * @param {Record<string, unknown>} evt
 * @returns {{
 *     type: string;
 *     sessionId: string | null;
 *     metadata: Record<string, unknown>;
 *     label: string;
 *     visible: boolean;
 *     detail: string;
 * }}
 */
function normalizeSdkLifecycleEvent(evt) {
    const type = normalizeSdkLifecycleString(evt?.['type']) ?? 'session.unknown';
    const sessionId = normalizeSdkLifecycleString(evt?.['sessionId']);
    const rawMetadata =
        evt?.['metadata'] && typeof evt['metadata'] === 'object'
            ? /** @type {Record<string, unknown>} */ (evt['metadata'])
            : {};
    const metadata = sanitizeSdkLifecycleMetadata(rawMetadata);
    const label = SDK_LIFECYCLE_LABELS[type] ?? 'Lifecycle SDK';
    const summary = normalizeSdkLifecycleString(metadata['summary']);
    const modifiedTime = normalizeSdkLifecycleString(metadata['modifiedTime']);
    const startTime = normalizeSdkLifecycleString(metadata['startTime']);
    const detail = [
        renderRuntimeSessionLabel(sessionId) ?? 'sessão não informada',
        summary ? `resumo ${summary}` : null,
        modifiedTime ? `modificada ${renderRuntimeTimestampLabel(modifiedTime)}` : null,
        startTime && !modifiedTime ? `iniciada ${renderRuntimeTimestampLabel(startTime)}` : null,
    ]
        .filter(Boolean)
        .join(' · ');
    return {
        type,
        sessionId,
        metadata,
        label,
        visible: SDK_LIFECYCLE_VISIBLE_TYPES.has(type),
        detail,
    };
}

/**
 * @param {{ errorType: string; message: string }} input
 * @returns {{
 *     enabled: boolean;
 *     profile: string | null;
 *     provider: string | null;
 *     model: string | null;
 *     operatorDetail: string | null;
 *     failure: import('../../model-gateway/health/provider-failure.js').ByokProviderFailure | null;
 * }}
 */
function resolveByokSessionErrorDescriptor({ errorType, message }) {
    let byok;
    try {
        byok = readConfiguredByokSummary();
    } catch {
        return { enabled: false, profile: null, provider: null, model: null, operatorDetail: null, failure: null };
    }
    if (byok.enabled !== true) {
        return { enabled: false, profile: null, provider: null, model: null, operatorDetail: null, failure: null };
    }
    const normalizedType = errorType.trim().toLowerCase();
    const failure = classifyByokProviderFailure(message);
    const providerLikeError =
        ['query', 'model_call', 'rate_limit', 'quota', 'provider', 'network', 'fetch'].includes(normalizedType) ||
        failure.kind !== 'unknown' ||
        /\b(ai model|provider|model|retry|retried|server error|rate limit|quota|timeout)\b/iu.test(message);
    if (!providerLikeError) {
        return { enabled: false, profile: null, provider: null, model: null, operatorDetail: null, failure: null };
    }
    const runtimeState = readTerminalRuntimeState();
    const provider = byok.preset ?? byok.providerType ?? null;
    const model = byok.model ?? runtimeState.model ?? null;
    const bits = [
        'erro de sessão BYOK vindo do SDK; registrado como saúde do provedor/modelo',
        failure.kind !== 'unknown' ? failure.operatorLabel : null,
        provider ? `provedor ${provider}` : null,
        byok.profile ? `perfil ${byok.profile}` : null,
        model ? `modelo ${model}` : null,
        'sem pedido premium',
        `ação: ${failure.operatorAction}`,
    ].filter(Boolean);
    return {
        enabled: true,
        profile: byok.profile ?? null,
        provider,
        model,
        operatorDetail: bits.join(' · '),
        failure,
    };
}

/**
 * @param {Record<string, unknown>} evt
 * @returns {{
 *     billedModel: string | null;
 *     configuredModel: string | null;
 *     effectiveModel: string | null;
 *     displayModel: string | null;
 *     mismatch: boolean;
 *     cost: number | null;
 * }}
 */
function normalizeUsageBilling(evt) {
    const billedModel = typeof evt?.['model'] === 'string' ? evt['model'] : null;
    const configuredModel = typeof evt?.['configuredModel'] === 'string' ? evt['configuredModel'] : null;
    const effectiveModel = typeof evt?.['effectiveModel'] === 'string' ? evt['effectiveModel'] : null;
    const mismatch = resolveModelSelectionMismatch({
        configuredModel,
        billedModel,
        effectiveModel,
        explicitMismatch: Boolean(evt?.['modelMismatch']),
    });
    return {
        billedModel,
        configuredModel,
        effectiveModel,
        displayModel: effectiveModel ?? billedModel ?? configuredModel,
        mismatch,
        cost: typeof evt?.['cost'] === 'number' ? evt['cost'] : null,
    };
}

/**
 * @param {ReturnType<typeof normalizeUsageBilling>} billing
 * @returns {string}
 */
function formatUsageDetail(billing) {
    const parts = [];
    if (billing.mismatch) {
        if (billing.configuredModel) parts.push(`modelo configurado ${billing.configuredModel}`);
        if (billing.effectiveModel) parts.push(`modelo efetivo ${billing.effectiveModel}`);
        if (billing.billedModel) parts.push(`modelo cobrado ${billing.billedModel}`);
    } else if (billing.displayModel) {
        parts.push(`modelo ${billing.displayModel}`);
    }
    if (billing.cost !== null) {
        parts.push(`custo ${billing.cost.toFixed(4)}`);
    }
    return parts.join(' · ') || 'sem metadados de billing';
}

/**
 * @param {Record<string, unknown>} evt
 * @param {ReturnType<typeof normalizeUsageBilling>} billing
 * @returns {string}
 */
function formatLlmUsageDetail(evt, billing) {
    const parts = [formatUsageDetail(billing)];
    const classification = typeof evt?.['classification'] === 'string' ? evt['classification'] : null;
    const reason = typeof evt?.['premiumRequestReason'] === 'string' ? evt['premiumRequestReason'] : null;
    const inputTokens = typeof evt?.['inputTokens'] === 'number' ? evt['inputTokens'] : null;
    const outputTokens = typeof evt?.['outputTokens'] === 'number' ? evt['outputTokens'] : null;
    if (classification) parts.push(`classe ${classification}`);
    if (reason) parts.push(`motivo ${reason}`);
    if (inputTokens !== null || outputTokens !== null) {
        parts.push(`tokens=${inputTokens ?? '?'}→${outputTokens ?? '?'}`);
    }
    return parts.filter(Boolean).join(' · ');
}

/**
 * @param {Record<string, unknown>} evt
 * @param {ReturnType<typeof normalizeUsageBilling>} billing
 * @returns {string}
 */
function formatLlmUsageOperatorDetail(evt, billing) {
    const parts = [];
    if (billing.mismatch) {
        parts.push(formatUsageDetail(billing));
    } else if (billing.displayModel) {
        parts.push(`modelo ${billing.displayModel}`);
    }
    const inputTokens = typeof evt?.['inputTokens'] === 'number' ? evt['inputTokens'] : null;
    const outputTokens = typeof evt?.['outputTokens'] === 'number' ? evt['outputTokens'] : null;
    if (inputTokens !== null || outputTokens !== null) {
        parts.push(`tokens ${inputTokens ?? '?'}→${outputTokens ?? '?'}`);
    }
    if (billing.cost !== null) {
        parts.push(`custo ${billing.cost.toFixed(4)}`);
    }
    return parts.filter(Boolean).join(' · ');
}

/**
 * @param {string} detail
 * @returns {string}
 */
function renderLlmUsageModelRowDetail(detail) {
    return String(detail ?? '').replace(/^modelo\s+/iu, '').trim();
}

/**
 * @param {{
 *     agent: AgentEventHost;
 *     rl?: import('node:readline').Interface | null;
 *     registry?: ReturnType<import('../state/index.js').createToolCallRegistry> | null;
 * }} input
 * @returns {() => void}
 */
export function setupTerminalAgentRuntimeEventListeners({ agent, rl = null, registry = null }) {
    // Garante sempre um registry session-scoped — em produção é injetado pelo event-adapters.js
    const _reg = registry ?? createToolCallRegistry();
    const pendingQuestionReplay = createTerminalPendingQuestionReplayState();
    /** @type {Map<string, number>} */
    const recoverableModelErrorPrintedAtByKey = new Map();
    const toolHeartbeatTimerId = `terminal.agent-runtime-events.tool-heartbeat:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const toolHeartbeatTimer = registerInterval(
        toolHeartbeatTimerId,
        () => {
            const inFlight = _reg.getAllInFlight();
            if (inFlight.length === 0) return;
            const now = Date.now();
            const compactDetail = getTerminalDetailLevel() === 'compact';
            for (const entry of inFlight) {
                const toolCallId = entry.toolCallId;
                if (
                    entry.suppressLiveNarration === true ||
                    entry.toolName === 'ask_user' ||
                    entry.toolName === 'request_user_input' ||
                    entry.canonicalName === 'request_user_input' ||
                    entry.presentation?.operation === 'ask'
                ) {
                    continue;
                }
                const elapsedMs = now - entry.t0;
                if (elapsedMs < TOOL_HEARTBEAT_INTERVAL_MS) continue;
                if (now - entry.lastHeartbeatAt < TOOL_HEARTBEAT_INTERVAL_MS) continue;
                _reg.touch(toolCallId, { lastHeartbeatAt: now, lastSignalAt: entry.lastSignalAt });
                const elapsed = (elapsedMs / 1000).toFixed(0);
                const sinceSignal = ((now - entry.lastSignalAt) / 1000).toFixed(0);
                const detailBase = entry.presentation?.detail ?? getTerminalHumanToolName(entry.toolName);
                const renderedName = entry.canonicalName ?? entry.toolName;
                const displayName = getTerminalHumanToolName(renderedName);
                recordTerminalActivity('tool', 'Ferramenta em andamento', {
                    detail: `${detailBase} · ${elapsed}s ativos · ${sinceSignal}s sem progresso`,
                    toolName: displayName,
                    source: 'sdk',
                    recordHistory: false,
                });
                if (getShowToolActivity()) {
                    const line =
                        `  ${terminalThemeText('muted', '↳')} ${terminalThemeText('tool', compactDetail ? compactTerminalToolText(displayName, 32) : displayName)} ${terminalThemeText('muted', `ainda trabalhando · ${elapsed}s sem novo progresso`)}`.trimEnd();
                    if (shouldPersistToolHeartbeatNarration()) {
                        println(line);
                    }
                    writeInlineStatus(line);
                }
            }
        },
        TOOL_HEARTBEAT_INTERVAL_MS,
    );
    if (typeof toolHeartbeatTimer.unref === 'function') {
        toolHeartbeatTimer.unref();
    }

    /**
     * @param {string} question
     * @param {string[]} [choices=[]] Default is `[]`
     * @param {'event' | 'replay'} [source='event'] Default is `'event'`
     * @returns {void}
     */
    function renderPendingQuestion(question, choices = [], source = 'event') {
        const decision = pendingQuestionReplay.shouldRender({ question, choices, source });
        if (!decision.render) {
            return;
        }
        if (source === 'event') {
            recordTerminalActivity('question', 'Pergunta ao operador reconciliada', {
                detail: question.slice(0, 160),
                source: 'agent',
                recordHistory: false,
                updateCurrent: false,
            });
            return;
        }
        const compactDetail = getTerminalDetailLevel() === 'compact';

        recordTerminalActivity(
            'question',
            source === 'replay' ? 'Pergunta pendente restaurada' : 'LLM-B solicitou input',
            {
                detail: question.slice(0, 160),
                source: 'agent',
            },
        );

        rl?.pause();
        println('');
        printTerminalHumanQuestionCard(println, {
            question,
            choices,
            source,
            state: source === 'replay' ? 'pergunta restaurada' : 'decisão pendente',
            compact: compactDetail,
            includeDivider: true,
            includeShortcuts: !compactDetail,
        });
        if (rl) {
            println(terminalThemeRow('Entrada', 'a próxima linha digitada será roteada como resposta humana'));
        } else {
            println(terminalThemeRow('Ação', 'Modo headless: responda via POST /inject ou pelo cliente conectado.'));
        }
        rl?.resume();
        if (rl) {
            scheduleTerminalPromptRedraw(rl, buildUserPrompt());
        }
    }

    const onQuestion = (/** @type {Record<string, unknown>} */ evt) => {
        const question = /** @type {string} */ (evt?.['question'] ?? '');
        const choices = /** @type {string[]} */ (evt?.['choices'] ?? []);
        renderPendingQuestion(question, choices, 'event');
    };

    const onStopped = () => {
        recordTerminalActivity('system', 'Agente parado', {
            detail: 'Use /restart para reiniciar.',
            severity: 'warn',
            source: 'agent',
        });
        println(terminalThemeRow('Sessão', 'Agente parado. Use /restart para reiniciar.', { role: 'warn' }));
        if (rl) {
            scheduleTerminalPromptRedraw(rl, buildUserPrompt());
        }
    };

    const onToolStart = (/** @type {Record<string, unknown>} */ evt) => {
        handleTerminalNativeToolStart({ registry: _reg, evt });
    };

    const onToolProgress = (/** @type {Record<string, unknown>} */ evt) => {
        handleTerminalNativeToolProgress({ registry: _reg, evt });
    };

    const onToolPartialResult = (/** @type {Record<string, unknown>} */ evt) => {
        handleTerminalNativeToolPartialResult({ registry: _reg, evt });
    };

    const onToolComplete = (/** @type {Record<string, unknown>} */ evt) => {
        handleTerminalNativeToolComplete({ registry: _reg, evt });
    };

    const onSessionError = (/** @type {Record<string, unknown>} */ evt) => {
        const msg = sanitizeOperationalErrorMessage(/** @type {string} */ (evt?.['message'] ?? 'unknown error'));
        const errorType = /** @type {string} */ (evt?.['errorType'] ?? 'error');
        const byokError = resolveByokSessionErrorDescriptor({ errorType, message: msg });

        if (byokError.enabled) {
            const now = Date.now();
            recordByokProviderModelCallFailure({
                routeProfile: byokError.profile,
                providerId: byokError.provider,
                providerModel: byokError.model,
                message: msg,
                errorContext:
                    byokError.failure && byokError.failure.kind !== 'unknown'
                        ? byokError.failure.errorContext
                        : `session.${errorType}`,
                failureKind: byokError.failure?.kind ?? null,
                failureStatusCode: byokError.failure?.statusCode ?? null,
                retryAfterSeconds: byokError.failure?.retryAfterSeconds ?? null,
                resetAt: byokError.failure?.resetAt ?? null,
                timestamp: now,
            });
            completeTerminalTurnMaterialization({
                timestamp: now,
                status: 'failed',
            });
            const revisedTrace = reviseRecentTerminalTurnTraceStatus({
                timestamp: now,
                status: 'failed',
            });
            if (!revisedTrace) {
                completeTerminalTurnTrace({
                    timestamp: now,
                    status: 'failed',
                });
            }
        }

        const errorTypeLabel = renderRuntimeErrorTypeLabel(errorType);
        const operatorMessage = renderProviderFailureMessageForOperator(msg);
        const detail =
            byokError.enabled && byokError.operatorDetail
                ? `Erro de ${errorTypeLabel}: ${operatorMessage} · ${byokError.operatorDetail}`
                : `Erro de ${errorTypeLabel}: ${operatorMessage}`;

        recordTerminalActivity('error', byokError.enabled ? 'Erro de sessão BYOK' : 'Erro de sessão', {
            detail,
            severity: 'error',
            source: 'agent',
        });
        trackOperatorVisibleTerminalError(new Error(detail), {
            source: byokError.enabled ? 'terminal.byok_session' : 'terminal.session',
            metadata: {
                errorType,
                byokProvider: byokError.enabled,
                byokProfile: byokError.profile,
                byokProviderType: byokError.provider,
                byokModel: byokError.model,
                operatorMeaning: byokError.operatorDetail,
            },
        });
        println(`\n${terminalThemeRow(byokError.enabled ? 'Erro BYOK' : 'Erro de sessão', detail, { role: 'error' })}`);
        broadcastSse(
            'session.error',
            withAgentSseEnvelope(
                {
                    errorType,
                    message: msg,
                    byokProvider: byokError.enabled,
                    byokProfile: byokError.profile,
                    byokProviderType: byokError.provider,
                    byokModel: byokError.model,
                    operatorMeaning: byokError.operatorDetail,
                    handledAs: byokError.enabled ? 'byok_session_error' : 'session_error',
                },
                'agent/session.error',
            ),
        );
    };

    const onAgentError = (/** @type {Record<string, unknown>} */ evt) => {
        const hookType = typeof evt?.['hookType'] === 'string' ? evt['hookType'] : null;
        const errorContext = typeof evt?.['errorContext'] === 'string' ? evt['errorContext'] : 'unknown';
        const msg = typeof evt?.['errorMessage'] === 'string' ? evt['errorMessage'] : 'unknown error';
        const operatorMessage = renderProviderFailureMessageForOperator(msg);
        const recoverable = evt?.['recoverable'] === true;
        const isRecoverableModelCall = hookType === 'errorOccurred' && errorContext === 'model_call' && recoverable;
        const isByokModelCall = isRecoverableModelCall && isByokRecoverableModelCall(evt);
        const operatorDetail = isRecoverableModelCall ? resolveRecoverableModelCallOperatorDetail(evt) : null;
        const label = isByokModelCall
            ? 'Falha do provedor BYOK'
            : isRecoverableModelCall
              ? 'Erro recuperável de modelo SDK'
              : 'Erro do agente';
        const severity = isRecoverableModelCall ? 'warn' : 'error';
        const detail = isRecoverableModelCall ? `${operatorMessage} · ${operatorDetail}` : `[${errorContext}] ${operatorMessage}`;
        const renderKey = `${errorContext}|${msg}`;
        const now = Date.now();
        const lastRenderedAt = recoverableModelErrorPrintedAtByKey.get(renderKey) ?? 0;
        const shouldPrint =
            !isRecoverableModelCall || now - lastRenderedAt >= RECOVERABLE_MODEL_ERROR_RENDER_THROTTLE_MS;
        if (isRecoverableModelCall && shouldPrint) {
            recoverableModelErrorPrintedAtByKey.set(renderKey, now);
        }

        if (isByokModelCall) {
            const failure = classifyByokProviderFailure(Object.assign(new Error(msg), { status: evt?.['status'] }));
            recordByokProviderModelCallFailure({
                routeProfile: typeof evt?.['byokProfile'] === 'string' ? evt['byokProfile'] : null,
                providerId:
                    typeof evt?.['byokProviderType'] === 'string'
                        ? evt['byokProviderType']
                        : typeof evt?.['byokPreset'] === 'string'
                          ? evt['byokPreset']
                          : null,
                providerModel: typeof evt?.['byokModel'] === 'string' ? evt['byokModel'] : null,
                message: msg,
                errorContext,
                failureKind: failure.kind,
                failureStatusCode: failure.statusCode,
                retryAfterSeconds: failure.retryAfterSeconds,
                resetAt: failure.resetAt,
                timestamp: now,
            });
            completeTerminalTurnMaterialization({
                timestamp: now,
                status: 'failed',
            });
            completeTerminalTurnTrace({
                timestamp: now,
                status: 'failed',
            });
        }

        recordTerminalActivity('error', label, {
            detail,
            severity,
            source: 'agent',
            recordHistory: !isRecoverableModelCall || shouldPrint,
            updateCurrent: true,
        });
        if (shouldPrint && !isTerminalRenderLocked()) {
            const rendered = isByokModelCall
                ? renderRecoverableByokModelCallErrorForOperator(evt, msg)
                : `\n${terminalThemeRow(isRecoverableModelCall ? 'Modelo' : 'Erro do agente', detail, {
                      role: severity,
                  })}`;
            println(rendered);
        }
        if (shouldPrint && (!isRecoverableModelCall || isByokModelCall)) {
            trackOperatorVisibleTerminalError(new Error(detail), {
                source: isByokModelCall ? 'terminal.byok_provider' : 'terminal.agent',
                metadata: {
                    hookType,
                    errorContext,
                    recoverable,
                    byokEnabled: evt?.['byokEnabled'] === true,
                    byokProviderType:
                        typeof evt?.['byokProviderType'] === 'string' ? evt['byokProviderType'] : null,
                    byokProfile: typeof evt?.['byokProfile'] === 'string' ? evt['byokProfile'] : null,
                    byokModel: typeof evt?.['byokModel'] === 'string' ? evt['byokModel'] : null,
                    operatorMeaning: operatorDetail,
                },
            });
        }
        broadcastSse(
            'agent.error',
            withAgentSseEnvelope(
                {
                    hookType,
                    errorContext,
                    recoverable,
                    message: msg,
                    byokEnabled: evt?.['byokEnabled'] === true,
                    byokProviderType: typeof evt?.['byokProviderType'] === 'string' ? evt['byokProviderType'] : null,
                    byokProfile: typeof evt?.['byokProfile'] === 'string' ? evt['byokProfile'] : null,
                    byokModel: typeof evt?.['byokModel'] === 'string' ? evt['byokModel'] : null,
                    operatorMeaning: operatorDetail,
                    suppressedDuplicate: isRecoverableModelCall && !shouldPrint,
                    handledAs: isRecoverableModelCall ? 'recoverable_model_call' : 'agent_error',
                },
                'agent/error',
            ),
        );
    };

    const onCompactionStart = () => {
        recordTerminalActivity('compaction', 'Compactando contexto', {
            detail: 'Reduzindo uso de contexto da sessão',
            source: 'agent',
        });
        println(terminalThemeRow('Contexto', 'Compactando contexto da sessão', { role: 'warn' }));
        broadcastSse('compaction.start', withAgentSseEnvelope({}, 'agent/compaction.start'));
    };

    const onCompactionComplete = (/** @type {Record<string, unknown>} */ evt) => {
        const pre = /** @type {number | undefined} */ (evt?.['preCompactionTokens']);
        const post = /** @type {number | undefined} */ (evt?.['postCompactionTokens']);
        const success = Boolean(evt?.['success']);
        recordTerminalActivity('compaction', success ? 'Compactação concluída' : 'Compactação falhou', {
            detail:
                success && pre !== undefined && post !== undefined
                    ? `${pre.toLocaleString('pt-BR')} → ${post.toLocaleString('pt-BR')} tokens`
                    : 'Falha durante compactação',
            severity: success ? 'info' : 'error',
            source: 'agent',
        });
        if (success && pre !== undefined && post !== undefined) {
            const pct = ((1 - post / pre) * 100).toFixed(0);
            println(
                terminalThemeRow(
                    'Compactação',
                    `concluída: ${pre.toLocaleString('pt-BR')} -> ${post.toLocaleString('pt-BR')} tokens (-${pct}%)`,
                    { role: 'success' },
                ),
            );
        } else if (!success) {
            println(terminalThemeRow('Compactação', 'falhou', { role: 'error' }));
        }
        broadcastSse('compaction.complete', withAgentSseEnvelope({ success, pre, post }, 'agent/compaction.complete'));
    };

    const onIntent = (/** @type {Record<string, unknown>} */ evt) => {
        const intent = /** @type {string} */ (evt?.['intent'] ?? '');
        if (intent) {
            renderTerminalIntent({
                intent,
                source: 'sdk/assistant.intent',
                tool: typeof evt?.['tool'] === 'string' ? evt['tool'] : null,
                risk: evt?.['risk'] ?? evt?.['severity'] ?? 'unknown',
            });
        }
    };

    const onSubagentStarted = (/** @type {Record<string, unknown>} */ evt) => {
        const name = /** @type {string} */ (evt?.['agentName'] ?? 'sub-agent');
        recordTerminalActivity('subagent', 'Subagente iniciado', {
            detail: name,
            source: 'agent',
        });
        println(terminalThemeRow('Subagente', `iniciado: ${name}`, { role: 'info' }));
    };

    const onSubagentCompleted = (/** @type {Record<string, unknown>} */ evt) => {
        const name = /** @type {string} */ (evt?.['agentName'] ?? 'sub-agent');
        recordTerminalActivity('subagent', 'Subagente concluído', {
            detail: name,
            source: 'agent',
        });
        println(terminalThemeRow('Subagente', `concluído: ${name}`, { role: 'success' }));
    };

    const onSubagentFailed = (/** @type {Record<string, unknown>} */ evt) => {
        const name = /** @type {string} */ (evt?.['agentName'] ?? 'sub-agent');
        const error = /** @type {string} */ (evt?.['error'] ?? 'unknown');
        recordTerminalActivity('subagent', 'Subagente falhou', {
            detail: `${name} — ${error}`,
            severity: 'error',
            source: 'agent',
        });
        printlnWhenRenderUnlocked(terminalThemeRow('Subagente', `falhou: ${name} — ${error}`, { role: 'error' }));
    };

    const onBackgroundCompleted = (/** @type {Record<string, unknown>} */ evt) => {
        const description = /** @type {string} */ (
            evt?.['description'] ?? evt?.['agentType'] ?? evt?.['agentId'] ?? 'agent'
        );
        const status = /** @type {'completed' | 'failed'} */ (evt?.['status'] ?? 'completed');
        const failed = status === 'failed';
        const narration = classifyBackgroundNarration({ description, failed });
        const operatorDescription = renderBackgroundDescriptionForOperator(description);
        const activityLabel = failed
            ? 'Tarefa em segundo plano falhou'
            : narration.labelPrefix === 'Tarefa interna'
              ? 'Tarefa interna concluída'
              : 'Tarefa em segundo plano concluída';
        recordTerminalActivity('task', activityLabel, {
            detail: `${operatorDescription} · ${renderRuntimeStatusLabel(status)}`,
            severity: failed ? 'error' : 'info',
            source: 'agent',
            recordHistory: narration.recordHistory,
            updateCurrent: narration.updateCurrent,
        });
        if (narration.print) {
            printlnWhenRenderUnlocked(
                terminalThemeRow('Tarefa', `${failed ? 'falhou' : 'concluída'} · ${operatorDescription}`, {
                    role: failed ? 'error' : 'success',
                }),
            );
        }
        broadcastSse(
            'agent.background.completed',
            withAgentSseEnvelope(
                {
                    ...evt,
                    visible: narration.print,
                    internal: !narration.recordHistory,
                },
                'agent/background.completed',
            ),
        );
    };

    const onBackgroundIdle = (/** @type {Record<string, unknown>} */ evt) => {
        const description = /** @type {string} */ (
            evt?.['description'] ?? evt?.['agentType'] ?? evt?.['agentId'] ?? 'agent'
        );
        const operatorDescription = renderBackgroundDescriptionForOperator(description);
        recordTerminalActivity('task', 'Tarefa em segundo plano ociosa', {
            detail: operatorDescription,
            source: 'agent',
            recordHistory: false,
            updateCurrent: false,
        });
        const shouldPrint = getShowSessionActivity() && !isInternalBackgroundDescription(description);
        if (shouldPrint) {
            printlnWhenRenderUnlocked(terminalThemeRow('Tarefa', `ociosa · ${operatorDescription}`));
        }
        broadcastSse(
            'agent.background.idle',
            withAgentSseEnvelope(
                {
                    ...evt,
                    visible: shouldPrint,
                    internal: !shouldPrint,
                },
                'agent/background.idle',
            ),
        );
    };

    const onShellCompleted = (/** @type {Record<string, unknown>} */ evt) => {
        const description = /** @type {string} */ (evt?.['description'] ?? evt?.['shellId'] ?? 'shell');
        const exitCode = typeof evt?.['exitCode'] === 'number' ? evt['exitCode'] : null;
        const failed = exitCode !== null && exitCode !== 0;
        const exitLabel = exitCode !== null ? ` · saída ${exitCode}` : '';
        recordTerminalActivity('task', failed ? 'Shell concluído com erro' : 'Shell concluído', {
            detail: `${description}${exitLabel}`,
            severity: failed ? 'error' : 'info',
            source: 'agent',
        });
        printlnWhenRenderUnlocked(
            failed
                ? `  \x1b[31m💻 Shell concluído com erro: ${description}${exitLabel}\x1b[0m`
                : `  \x1b[32m💻 Shell concluído: ${description}${exitLabel}\x1b[0m`,
        );
        broadcastSse(AGENT_SHELL_COMPLETED_EVENT, withAgentSseEnvelope({ ...evt }, 'agent/shell.completed'));
    };

    const onShellDetachedCompleted = (/** @type {Record<string, unknown>} */ evt) => {
        const description = /** @type {string} */ (evt?.['description'] ?? evt?.['shellId'] ?? 'shell');
        recordTerminalActivity('task', 'Shell destacada concluída', {
            detail: description,
            source: 'agent',
        });
        printlnWhenRenderUnlocked(`  \x1b[32m💻 Shell destacada concluída: ${description}\x1b[0m`);
        broadcastSse(
            AGENT_SHELL_DETACHED_COMPLETED_EVENT,
            withAgentSseEnvelope({ ...evt }, 'agent/shell.detached_completed'),
        );
    };

    const onPrConsumed = (/** @type {Record<string, unknown>} */ evt) => {
        const billing = normalizeUsageBilling(evt);
        const detail = formatUsageDetail(billing);
        const showUsage = getShowUsage();
        const shouldPersist = showUsage || billing.mismatch;
        const label = billing.mismatch
            ? 'Pedido premium classificado com divergência de modelo'
            : 'Pedido premium classificado';
        recordTerminalActivity('system', label, {
            detail,
            source: 'agent',
            severity: billing.mismatch ? 'warn' : 'info',
            recordHistory: shouldPersist,
        });
        if ((showUsage || billing.mismatch) && !isTerminalRenderLocked()) {
            println(
                terminalThemeRow('Pedido premium', detail, {
                    role: billing.mismatch ? 'warn' : 'muted',
                }),
            );
        }
        broadcastSse(AGENT_PR_CONSUMED_EVENT, withAgentSseEnvelope(evt, 'agent/pr.consumed'));
    };

    const onLlmUsage = (/** @type {Record<string, unknown>} */ evt) => {
        const premiumRequest = evt?.['premiumRequest'] === true;
        const billing = normalizeUsageBilling(evt);
        broadcastSse(EMITTER_LLM_USAGE, withAgentSseEnvelope(evt, 'agent/llm.usage'));
        if (premiumRequest) return;

        if (evt?.['byokProvider'] === true) {
            recordByokProviderModelCallSuccess({
                routeProfile: typeof evt?.['byokProfile'] === 'string' ? evt['byokProfile'] : null,
                providerId:
                    typeof evt?.['byokPreset'] === 'string'
                        ? evt['byokPreset']
                        : typeof evt?.['byokProviderType'] === 'string'
                          ? evt['byokProviderType']
                          : null,
                providerModel:
                    typeof evt?.['effectiveModel'] === 'string'
                        ? evt['effectiveModel']
                        : typeof evt?.['model'] === 'string'
                          ? evt['model']
                          : null,
                successContext: 'llm.usage',
                timestamp: typeof evt?.['ts'] === 'number' ? evt['ts'] : Date.now(),
            });
        }

        const technicalDetail = formatLlmUsageDetail(evt, billing);
        const operatorDetail = formatLlmUsageOperatorDetail(evt, billing);
        const showUsage = getShowUsage();
        const shouldPersist = showUsage || billing.mismatch;
        const label = billing.mismatch
            ? 'Uso BYOK sem pedido premium com divergência de modelo'
            : 'Uso BYOK sem pedido premium';
        recordTerminalActivity('system', label, {
            detail: operatorDetail,
            source: 'agent',
            severity: billing.mismatch ? 'warn' : 'info',
            recordHistory: shouldPersist,
        });
        if ((showUsage || billing.mismatch) && !isTerminalRenderLocked()) {
            const rowDetail = billing.mismatch ? technicalDetail : renderLlmUsageModelRowDetail(operatorDetail);
            println(
                terminalThemeRow('Uso do modelo', rowDetail || operatorDetail, {
                    role: billing.mismatch ? 'warn' : 'muted',
                }),
            );
        }
    };

    const onPrFallbackModel = (/** @type {Record<string, unknown>} */ evt) => {
        const from = typeof evt?.['from'] === 'string' ? evt['from'] : '?';
        const to = typeof evt?.['to'] === 'string' ? evt['to'] : '?';
        const detail = `${from} → ${to}`;
        recordTerminalActivity('system', 'Fallback de modelo aplicado', {
            detail,
            source: 'agent',
            severity: 'warn',
        });
        println(terminalThemeRow('Modelo', `fallback aplicado: ${detail}`, { role: 'warn' }));
        broadcastSse(AGENT_PR_FALLBACK_MODEL_EVENT, withAgentSseEnvelope(evt, 'agent/pr.fallback_model'));
    };

    const onDialogBootRecovery = (/** @type {Record<string, unknown>} */ evt) => {
        const skippedPrFallback = evt?.['skippedPrFallback'] === true;
        const prFallback = evt?.['prFallback'] === true;
        const zeroPR = evt?.['zeroPR'] === true;
        const reason = typeof evt?.['reason'] === 'string' ? evt['reason'] : zeroPR ? 'zero_pr_attach' : 'unknown';
        const error = typeof evt?.['error'] === 'string' ? evt['error'] : null;
        const detail = [
            reason,
            zeroPR
                ? 'zero-PR'
                : prFallback
                  ? 'fallback com PR'
                  : skippedPrFallback
                    ? 'fallback PR bloqueado'
                    : 'sem PR',
            error,
        ]
            .filter(Boolean)
            .join(' · ');
        recordTerminalActivity(
            'system',
            skippedPrFallback ? 'Boot recovery preservou zero-PR' : 'Boot recovery da conversa',
            {
                detail,
                source: 'dialog',
                severity: skippedPrFallback || prFallback ? 'warn' : 'info',
            },
        );
        if ((skippedPrFallback || prFallback) && !isTerminalRenderLocked()) {
            println(
                terminalThemeRow(
                    'Diálogo',
                    skippedPrFallback ? `boot recovery sem fallback PR: ${detail}` : `boot recovery com PR: ${detail}`,
                    { role: 'warn' },
                ),
            );
        }
        broadcastSse(EMITTER_DIALOG_BOOT_RECOVERY, withAgentSseEnvelope(evt, 'agent/dialog.boot_recovery'));
    };

    const onSdkLifecycle = (/** @type {Record<string, unknown>} */ evt) => {
        const normalized = normalizeSdkLifecycleEvent(evt);
        recordTerminalActivity('system', normalized.label, {
            detail: normalized.detail,
            source: 'sdk.lifecycle',
            recordHistory: normalized.visible,
            updateCurrent: normalized.visible,
        });
        if (normalized.visible && getShowSessionActivity() && !isTerminalRenderLocked()) {
            println(terminalThemeRow('Sessão SDK', `${normalized.label}: ${normalized.detail}`, { role: 'muted' }));
        }
        broadcastSse(
            EMITTER_SDK_LIFECYCLE,
            withAgentSseEnvelope(
                {
                    type: normalized.type,
                    sessionId: normalized.sessionId,
                    metadata: normalized.metadata,
                    visible: normalized.visible,
                    label: normalized.label,
                    detail: normalized.detail,
                },
                'agent/sdk.lifecycle',
            ),
        );
    };

    const onSdkCommandExecuted = (/** @type {Record<string, unknown>} */ evt) => {
        const commandName = typeof evt?.['commandName'] === 'string' ? evt['commandName'] : 'unknown';
        const localCommand = typeof evt?.['localCommand'] === 'string' ? evt['localCommand'] : null;
        const sessionId = typeof evt?.['sessionId'] === 'string' ? evt['sessionId'] : null;
        const args = Array.isArray(evt?.['args']) ? evt['args'].map((item) => String(item)).filter(Boolean) : [];
        const detail = [
            commandName,
            localCommand ? `comando local ${localCommand}` : null,
            renderRuntimeArgsLabel(args),
            renderRuntimeSessionLabel(sessionId),
        ]
            .filter(Boolean)
            .join(' · ');
        recordTerminalActivity('system', 'Comando SDK executado', {
            detail,
            source: 'sdk.command',
            recordHistory: true,
            updateCurrent: false,
        });
        if (getShowSessionActivity() && !isTerminalRenderLocked()) {
            println(terminalThemeRow('Comando SDK', detail, { role: 'muted' }));
        }
        broadcastSse(
            EMITTER_SDK_COMMAND_EXECUTED,
            withAgentSseEnvelope(
                {
                    commandName,
                    localCommand,
                    sessionId,
                    args,
                    safe: evt?.['safe'] === true,
                    description: typeof evt?.['description'] === 'string' ? evt['description'] : null,
                },
                'agent/sdk.command',
            ),
        );
    };

    agent.on(EMITTER_QUESTION_PENDING, onQuestion);
    agent.on(EMITTER_ERROR, onAgentError);
    agent.on(EMITTER_STOPPED, onStopped);
    agent.on(EMITTER_TOOL_EXECUTION_START, onToolStart);
    agent.on(EMITTER_TOOL_EXECUTION_PARTIAL_RESULT, onToolPartialResult);
    agent.on(EMITTER_TOOL_EXECUTION_PROGRESS, onToolProgress);
    agent.on(EMITTER_TOOL_EXECUTION_COMPLETE, onToolComplete);
    agent.on(EMITTER_SESSION_ERROR, onSessionError);
    agent.on(EMITTER_SESSION_COMPACTION_START, onCompactionStart);
    agent.on(EMITTER_SESSION_COMPACTION_COMPLETE, onCompactionComplete);
    agent.on(EMITTER_ASSISTANT_INTENT, onIntent);
    agent.on(EMITTER_SUBAGENT_STARTED, onSubagentStarted);
    agent.on(EMITTER_SUBAGENT_COMPLETED, onSubagentCompleted);
    agent.on(EMITTER_SUBAGENT_FAILED, onSubagentFailed);
    agent.on(EMITTER_AGENT_BACKGROUND_COMPLETED, onBackgroundCompleted);
    agent.on(EMITTER_AGENT_BACKGROUND_IDLE, onBackgroundIdle);
    agent.on(AGENT_SHELL_COMPLETED_EVENT, onShellCompleted);
    agent.on(AGENT_SHELL_DETACHED_COMPLETED_EVENT, onShellDetachedCompleted);
    agent.on(EMITTER_LLM_USAGE, onLlmUsage);
    agent.on(AGENT_PR_CONSUMED_EVENT, onPrConsumed);
    agent.on(AGENT_PR_FALLBACK_MODEL_EVENT, onPrFallbackModel);
    agent.on(EMITTER_DIALOG_BOOT_RECOVERY, onDialogBootRecovery);
    agent.on(EMITTER_SDK_LIFECYCLE, onSdkLifecycle);
    agent.on(EMITTER_SDK_COMMAND_EXECUTED, onSdkCommandExecuted);

    const runtimeState = readTerminalRuntimeState();
    if (runtimeState.pendingQuestion && runtimeState.pendingQuestionKind !== 'ready') {
        renderPendingQuestion(
            runtimeState.pendingQuestion.question,
            runtimeState.pendingQuestion.choices ?? [],
            'replay',
        );
    }

    return () => {
        cancelTimer(toolHeartbeatTimerId);
        agent.off(EMITTER_QUESTION_PENDING, onQuestion);
        agent.off(EMITTER_ERROR, onAgentError);
        agent.off(EMITTER_STOPPED, onStopped);
        agent.off(EMITTER_TOOL_EXECUTION_START, onToolStart);
        agent.off(EMITTER_TOOL_EXECUTION_PARTIAL_RESULT, onToolPartialResult);
        agent.off(EMITTER_TOOL_EXECUTION_PROGRESS, onToolProgress);
        agent.off(EMITTER_TOOL_EXECUTION_COMPLETE, onToolComplete);
        agent.off(EMITTER_SESSION_ERROR, onSessionError);
        agent.off(EMITTER_SESSION_COMPACTION_START, onCompactionStart);
        agent.off(EMITTER_SESSION_COMPACTION_COMPLETE, onCompactionComplete);
        agent.off(EMITTER_ASSISTANT_INTENT, onIntent);
        agent.off(EMITTER_SUBAGENT_STARTED, onSubagentStarted);
        agent.off(EMITTER_SUBAGENT_COMPLETED, onSubagentCompleted);
        agent.off(EMITTER_SUBAGENT_FAILED, onSubagentFailed);
        agent.off(EMITTER_AGENT_BACKGROUND_COMPLETED, onBackgroundCompleted);
        agent.off(EMITTER_AGENT_BACKGROUND_IDLE, onBackgroundIdle);
        agent.off(AGENT_SHELL_COMPLETED_EVENT, onShellCompleted);
        agent.off(AGENT_SHELL_DETACHED_COMPLETED_EVENT, onShellDetachedCompleted);
        agent.off(EMITTER_LLM_USAGE, onLlmUsage);
        agent.off(AGENT_PR_CONSUMED_EVENT, onPrConsumed);
        agent.off(AGENT_PR_FALLBACK_MODEL_EVENT, onPrFallbackModel);
        agent.off(EMITTER_DIALOG_BOOT_RECOVERY, onDialogBootRecovery);
        agent.off(EMITTER_SDK_LIFECYCLE, onSdkLifecycle);
        agent.off(EMITTER_SDK_COMMAND_EXECUTED, onSdkCommandExecuted);
    };
}
