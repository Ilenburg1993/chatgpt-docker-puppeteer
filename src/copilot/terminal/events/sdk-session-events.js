// @ts-check
/**
 * src/copilot/terminal/events/sdk-session-events.js
 *
 * Tradução dos sinais vanilla da sessão SDK para UX local do terminal.
 *
 * Responsabilidade:
 *
 * - registrar listeners orientados a operador para eventos vanilla do SDK;
 * - refletir esses sinais em `activity-state`, stdout local e SSE;
 * - manter a projeção observada de `mode/plan` do SDK no estado do terminal.
 *
 * Não pertence a `frontend/` porque aqui a preocupação já é de render/notificação, não de projeção crua de runtime.
 *
 * @module copilot/terminal/sdk-session-events
 */

import {
    EMITTER_ASSISTANT_MESSAGE,
    EMITTER_ASSISTANT_REASONING_COMPLETE,
    EMITTER_ASSISTANT_TURN_END,
    EMITTER_ASSISTANT_TURN_START,
    EMITTER_AUTO_MODE_SWITCH_COMPLETED,
    EMITTER_AUTO_MODE_SWITCH_REQUESTED,
    EMITTER_CAPABILITIES_CHANGED,
    EMITTER_COMMANDS_CHANGED,
    EMITTER_ELICITATION_COMPLETED,
    EMITTER_ELICITATION_PENDING,
    EMITTER_EXIT_PLAN_MODE_COMPLETED,
    EMITTER_EXIT_PLAN_MODE_REQUESTED,
    EMITTER_EXTERNAL_TOOL_COMPLETED,
    EMITTER_EXTERNAL_TOOL_REQUESTED,
    EMITTER_HOOK_END,
    EMITTER_HOOK_START,
    EMITTER_MCP_OAUTH_COMPLETED,
    EMITTER_MCP_OAUTH_REQUIRED,
    EMITTER_MCP_SERVER_STATUS_CHANGED,
    EMITTER_PENDING_MESSAGES_MODIFIED,
    EMITTER_PERMISSION_COMPLETED,
    EMITTER_PERMISSION_MODE_CHANGED,
    EMITTER_PERMISSION_REQUESTED,
    EMITTER_SAMPLING_COMPLETED,
    EMITTER_SAMPLING_REQUESTED,
    EMITTER_SESSION_BACKGROUND_TASKS_CHANGED,
    EMITTER_SESSION_CONTEXT_CHANGED,
    EMITTER_SESSION_EXTENSIONS_LOADED,
    EMITTER_SESSION_HANDOFF,
    EMITTER_SESSION_INFO,
    EMITTER_SESSION_MCP_SERVERS_LOADED,
    EMITTER_SESSION_MODE_CHANGED,
    EMITTER_SESSION_MODEL_CHANGED,
    EMITTER_SESSION_PLAN_CHANGED,
    EMITTER_SESSION_SHUTDOWN,
    EMITTER_SESSION_SKILLS_LOADED,
    EMITTER_SESSION_SNAPSHOT_REWIND,
    EMITTER_SESSION_TASK_COMPLETE,
    EMITTER_SESSION_TITLE_CHANGED,
    EMITTER_SESSION_TOOLS_UPDATED,
    EMITTER_SESSION_TRUNCATION,
    EMITTER_SESSION_WARNING,
    EMITTER_SESSION_WORKSPACE_FILE_CHANGED,
    EMITTER_TOOL_USER_REQUESTED,
    EMITTER_USER_INPUT_COMPLETED,
    EMITTER_USER_INPUT_REQUESTED,
} from '#copilot/events';
import { SqliteModelGatewayCatalogStore } from '#copilot/model-gateway';
import { DialogProtocol } from '../../dialog/protocol.js';
import {
    consumeRuntimeInterventionMailbox,
    enqueueRuntimeInterventionMailbox,
    getBusy,
    getShowSessionActivity,
    readRuntimeInterventionMailboxSummary,
    setLastSdkPlanOperation,
    setSdkSessionMode,
} from '../../presentation/state/index.js';
import { broadcastSse, println } from '../dialog/index.js';
import {
    answerTerminalPendingQuestion,
    classifyTerminalPermissionDecision,
    loginTerminalSdkMcpOauth,
    readTerminalToolRegistrySnapshot,
} from '../frontend/gateways/index.js';
import { observeTerminalModelChangeProjection } from '../frontend/projections/index.js';
import {
    beginTerminalTurnMaterialization,
    beginTerminalTurnTrace,
    completeTerminalTurnMaterialization,
    completeTerminalTurnTrace,
    createToolCallRegistry,
    getTerminalAssistantMessageMaterializationDecision,
    getTerminalDetailLevel,
    markTerminalActivityIdle,
    recordTerminalActivity,
    appendTerminalTranscriptTurn,
    recordTerminalElicitationCompleted,
    recordTerminalElicitationPending,
    recordTerminalPermissionCompleted,
    recordTerminalPermissionModeChanged,
    recordTerminalPermissionRequested,
    recordTerminalTurnAssistantMessage,
    recordTerminalTurnFileActivity,
    recordTerminalTurnUserInputActivity,
    recordTerminalUserInputCompleted,
    recordTerminalUserInputRequested,
    shouldSuppressTerminalAssistantMessageAsUserInputEcho,
    terminalThemeBadge,
    terminalThemeText,
    withTerminalTurnCorrelation,
} from '../state/events/index.js';
import { drainMailboxToTurnIfIdle } from '../wiring/mailbox/index.js';
import { renderTerminalAssistantTranscript } from './assistant-transcript-renderer.js';
import {
    handleTerminalExternalToolCompleted,
    handleTerminalExternalToolRequested,
    handleTerminalToolUserRequested,
    reconcileTerminalInFlightToolsAtTurnEnd,
} from './tool-lifecycle-runtime.js';
import { buildTerminalToolActivityPresentation, compactTerminalDiagnosticId } from './tool-activity-presenter.js';

/**
 * @param {string} previousModel
 * @param {string} newModel
 * @param {string | null} reasoningEffort
 * @returns {Promise<void>}
 */
async function recordModelGatewaySdkSessionConfirmation(previousModel, newModel, reasoningEffort) {
    const store = new SqliteModelGatewayCatalogStore();
    const handoffs = await store.readSdkSessionHandoffRecords({ limit: 10 });
    const matched = handoffs.find((handoff) => handoff['targetModel'] === newModel) ?? null;
    const latest = matched ?? handoffs[0] ?? null;
    const status = matched ? 'matched_handoff' : latest ? 'model_mismatch' : 'observed';
    await store.writeSdkSessionConfirmationRecords([
        {
            confirmationId: `sdk-model-changed:${Date.now()}:${process.pid}:${newModel}`,
            handoffId: typeof latest?.['handoffId'] === 'string' ? latest['handoffId'] : null,
            decisionId: typeof latest?.['decisionId'] === 'string' ? latest['decisionId'] : null,
            previousModel,
            confirmedModel: newModel,
            reasoningEffort,
            status,
            observedAt: new Date().toISOString(),
            source: 'terminal-sdk-session-model-changed',
        },
    ]);
}

/**
 * @typedef {{
 *     on: (event: string, handler: (...args: any[]) => void) => void;
 *     off: (event: string, handler: (...args: any[]) => void) => void;
 * }} AgentEventHost
 */

/**
 * @param {unknown} evt
 * @returns {Record<string, unknown>}
 */
function eventObject(evt) {
    return evt && typeof evt === 'object' ? /** @type {Record<string, unknown>} */ (evt) : {};
}

/**
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
function stringOr(value, fallback) {
    return typeof value === 'string' && value.length > 0 ? value : fallback;
}

/**
 * @param {string} value
 * @param {number} [max=36] Default is `36`
 * @returns {string}
 */
function compactSummaryText(value, max = 36) {
    return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * @param {string | null | undefined} value
 * @returns {boolean}
 */
function isLikelyInternalId(value) {
    if (!value) return false;
    const text = value.trim();
    return (
        /^chatcmpl-tool-[a-z0-9-]+$/iu.test(text) ||
        /^toolu_[a-z0-9]+$/iu.test(text) ||
        /^call_[a-z0-9_-]+$/iu.test(text) ||
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(text)
    );
}

/**
 * @param {string} operation
 * @returns {string}
 */
function renderTurnTraceOperationLabel(operation) {
    if (operation === 'ask') return 'PERGUNTA';
    if (operation === 'intent') return 'INTENÇÃO';
    if (operation === 'read') return 'LER';
    if (operation === 'write') return 'CRIAR';
    if (operation === 'edit') return 'EDITAR';
    if (operation === 'copy') return 'COPIAR';
    if (operation === 'move') return 'MOVER';
    if (operation === 'delete') return 'EXCLUIR';
    if (operation === 'list') return 'LISTAR';
    if (operation === 'run') return 'EXEC';
    if (operation === 'inspect') return 'VER';
    return 'AÇÃO';
}

/**
 * @param {number} value
 * @param {string} singular
 * @param {string} plural
 * @returns {string}
 */
function pluralPt(value, singular, plural) {
    return `${value} ${value === 1 ? singular : plural}`;
}

/**
 * @param {string | null | undefined} requestId
 * @returns {string}
 */
function renderSdkRequestLabel(requestId) {
    const compacted = compactTerminalDiagnosticId(requestId, 18);
    return compacted ? `pedido ${compacted}` : 'pedido não informado';
}

/**
 * @param {string | null | undefined} requestId
 * @returns {string}
 */
function renderSdkOptionalRequestDetail(requestId) {
    const compacted = compactTerminalDiagnosticId(requestId, 18);
    return compacted ? ` · pedido ${compacted}` : '';
}

/**
 * @param {string | null | undefined} mode
 * @returns {string}
 */
function renderPermissionModeLabel(mode) {
    if (mode === 'approve_all') return 'aprovação automática';
    if (mode === 'audit_only') return 'auditoria sem prompts';
    if (mode === 'selective') return 'aprovação seletiva';
    return mode ?? 'modo não informado';
}

/**
 * @param {string | null | undefined} result
 * @param {boolean | null} granted
 * @returns {string}
 */
function renderPermissionDecisionLabel(result, granted) {
    if (granted === true || result === 'approved') return 'aprovada';
    if (result === 'denied-by-rules') return 'negada por regras';
    if (result === 'denied-by-permission-request-hook') return 'negada por política';
    if (result === 'denied-by-content-exclusion-policy') return 'negada por exclusão de conteúdo';
    if (granted === false) return 'não aprovada';
    return result ?? 'concluída';
}

/**
 * @param {boolean} wasFreeform
 * @returns {string}
 */
function renderUserInputAnswerModeLabel(wasFreeform) {
    return wasFreeform ? 'resposta livre' : 'escolha estruturada';
}

/**
 * Envelope único para eventos vanilla do SDK expostos via SSE do terminal.
 *
 * @template {Record<string, unknown>} T
 * @param {T} payload
 * @param {string} source
 * @returns {T & { source: string; timestamp: number; traceId?: string; turnId?: string }}
 */
function withSdkSessionSseEnvelope(payload, source) {
    return withTerminalTurnCorrelation({
        ...payload,
        source,
        timestamp: typeof payload['timestamp'] === 'number' ? payload['timestamp'] : Date.now(),
    });
}

/**
 * @param {import('../state/turn-trace-state.js').TerminalTurnTraceSnapshot | null} trace
 * @returns {void}
 */
function renderTurnTraceSummary(trace) {
    if (!trace || (trace.tools.length === 0 && trace.files.length === 0)) {
        return;
    }
    const compactDetail = getTerminalDetailLevel() === 'compact';
    const toolItems = trace.tools.slice(0, compactDetail ? 2 : 3).map((tool) => {
        const targetCandidate = tool.path ?? tool.target ?? null;
        const target = isLikelyInternalId(targetCandidate) ? null : targetCandidate;
        const presentation = buildTerminalToolActivityPresentation(
            {
                toolName: tool.toolName,
                operation: tool.operation,
                args: target ? { path: tool.path ?? target } : {},
            },
            tool.toolName,
        );
        const displayName = presentation.displayToolName;
        const operationLabel = renderTurnTraceOperationLabel(tool.operation);
        const label = compactDetail
            ? `${operationLabel} ${compactSummaryText(target ?? displayName, 28)}`
            : `${operationLabel} ${displayName}${target ? ` · ${compactSummaryText(target, 46)}` : ''}`;
        return terminalThemeText('tool', label);
    });
    const fileItems = trace.files.slice(0, compactDetail ? 2 : 3).map((file) => {
        const label = compactDetail
            ? compactSummaryText(file.path, 24)
            : `${renderTurnTraceOperationLabel(file.operation)} ${compactSummaryText(file.path, 42)}`;
        return terminalThemeText('info', label);
    });
    const headline = [
        trace.tools.length > 0 ? pluralPt(trace.tools.length, 'ação', 'ações') : null,
        trace.files.length > 0 ? pluralPt(trace.files.length, 'arquivo', 'arquivos') : null,
    ]
        .filter(Boolean)
        .join(' · ');

    println(`  ${terminalThemeBadge('info', 'TURNO')} ${terminalThemeText('muted', headline)}`);
    if (toolItems.length > 0) {
        println(
            `   ${terminalThemeBadge('tool', 'AÇÕES')} ${toolItems.join(terminalThemeText('muted', '  ·  '))}`,
        );
    }
    if (fileItems.length > 0) {
        println(
            `   ${terminalThemeBadge('fileRead', 'ARQUIVOS')} ${fileItems.join(terminalThemeText('muted', '  ·  '))}`,
        );
    }
}

/**
 * @param {{
 *     agent: AgentEventHost;
 *     refreshPromptIfIdle: () => void;
 *     registry?: ReturnType<import('../state/events/index.js').createToolCallRegistry> | null;
 * }} input
 * @returns {() => void}
 */
export function setupTerminalSdkSessionEventListeners({ agent, refreshPromptIfIdle, registry = null }) {
    // Garante sempre um registry session-scoped — em produção é injetado pelo event-adapters.js
    const _reg = registry ?? createToolCallRegistry();
    /**
     * Requests de protocolo suprimidas para não poluir UI de ask_user. Bounded+TTL para evitar crescimento sem limite
     * em sessões muito longas.
     *
     * @type {Map<string, number>}
     */
    const suppressedProtocolRequestIds = new Map();

    const SUPPRESSED_PROTOCOL_TTL_MS = 10 * 60_000;
    const SUPPRESSED_PROTOCOL_MAX = 512;
    const USER_INPUT_TRANSCRIPT_TTL_MS = 30 * 60_000;
    const USER_INPUT_TRANSCRIPT_MAX = 1024;
    let permissionHelpPrinted = false;
    /** @type {Map<string, number>} */
    const userInputTranscriptKeys = new Map();

    /**
     * @param {number} [now]
     * @returns {void}
     */
    function pruneSuppressedProtocolRequestIds(now = Date.now()) {
        for (const [requestId, ts] of suppressedProtocolRequestIds.entries()) {
            if (now - ts > SUPPRESSED_PROTOCOL_TTL_MS) {
                suppressedProtocolRequestIds.delete(requestId);
            }
        }
        if (suppressedProtocolRequestIds.size > SUPPRESSED_PROTOCOL_MAX) {
            const overflow = suppressedProtocolRequestIds.size - SUPPRESSED_PROTOCOL_MAX;
            let removed = 0;
            for (const requestId of suppressedProtocolRequestIds.keys()) {
                suppressedProtocolRequestIds.delete(requestId);
                removed++;
                if (removed >= overflow) break;
            }
        }
    }

    /**
     * @param {string} key
     * @param {number} [now]
     * @returns {boolean}
     */
    function claimUserInputTranscriptKey(key, now = Date.now()) {
        for (const [existingKey, ts] of userInputTranscriptKeys.entries()) {
            if (now - ts > USER_INPUT_TRANSCRIPT_TTL_MS) {
                userInputTranscriptKeys.delete(existingKey);
            }
        }
        if (userInputTranscriptKeys.has(key)) return false;
        userInputTranscriptKeys.set(key, now);
        if (userInputTranscriptKeys.size > USER_INPUT_TRANSCRIPT_MAX) {
            const overflow = userInputTranscriptKeys.size - USER_INPUT_TRANSCRIPT_MAX;
            let removed = 0;
            for (const existingKey of userInputTranscriptKeys.keys()) {
                userInputTranscriptKeys.delete(existingKey);
                removed++;
                if (removed >= overflow) break;
            }
        }
        return true;
    }

    /**
     * @param {{
     *     phase: 'requested' | 'completed';
     *     requestId: string | null;
     *     question: string;
     *     choices?: string[];
     *     allowFreeform?: boolean;
     *     answer?: string;
     *     wasFreeform?: boolean;
     *     toolCallId?: string | null;
     *     envelope: Record<string, unknown>;
     * }} input
     * @returns {void}
     */
    function appendUserInputTranscriptTurn(input) {
        const timestamp =
            typeof input.envelope['timestamp'] === 'number' && Number.isFinite(input.envelope['timestamp'])
                ? input.envelope['timestamp']
                : Date.now();
        const baseKey =
            input.requestId ??
            (typeof input.toolCallId === 'string' && input.toolCallId.trim() ? input.toolCallId.trim() : null) ??
            `${input.phase}:${input.question}:${input.answer ?? ''}`;
        const key = `${input.phase}:${baseKey}`;
        if (!claimUserInputTranscriptKey(key, timestamp)) return;
        if (input.phase === 'requested') {
            const choices = Array.isArray(input.choices) ? input.choices : [];
            const options = choices.length > 0 ? `\nOpcoes: ${choices.join(' | ')}` : '';
            appendTerminalTranscriptTurn({
                role: 'system',
                rawRole: 'ask_user',
                content: `ask_user solicitou resposta humana:\n${input.question}${options}`,
                source: 'sdk/user_input.requested',
                timestamp,
                metadata: {
                    envelope: input.envelope,
                    requestId: input.requestId,
                    toolCallId: input.toolCallId ?? null,
                    choices,
                    allowFreeform: input.allowFreeform !== false,
                    terminalInteractionKind: 'ask_user',
                    terminalInteractionPhase: 'requested',
                },
            });
            return;
        }
        const answer = typeof input.answer === 'string' ? input.answer.trim() : '';
        if (!answer) return;
        appendTerminalTranscriptTurn({
            role: 'user',
            rawRole: 'ask_user_answer',
            content: `Resposta ao ask_user:\n${answer}`,
            source: 'sdk/user_input.completed',
            timestamp,
            metadata: {
                envelope: input.envelope,
                requestId: input.requestId,
                question: input.question,
                wasFreeform: input.wasFreeform === true,
                terminalInteractionKind: 'ask_user',
                terminalInteractionPhase: 'completed',
            },
        });
    }

    /**
     * @param {'critical' | 'important' | 'verbose'} level
     * @returns {boolean}
     */
    function shouldPrintSessionNarration(level) {
        if (level === 'critical' || level === 'important') {
            return true;
        }
        return getShowSessionActivity();
    }

    /**
     * @param {unknown} evt
     * @returns {string}
     */
    function extractAssistantMessageContent(evt) {
        const data = eventObject(evt);
        const nested = eventObject(data['data']);
        const content =
            data['content'] ??
            nested['content'] ??
            data['message'] ??
            nested['message'] ??
            data['text'] ??
            nested['text'];
        return typeof content === 'string' ? content : '';
    }

    /**
     * @param {string} content
     * @returns {{ content: string; kind: ReturnType<typeof DialogProtocol.classify> } | null}
     */
    function normalizeAssistantTranscriptContent(content) {
        const trimmed = content.trim();
        if (!trimmed) return null;
        const kind = DialogProtocol.classify(trimmed);
        if (kind === 'ready' || kind === 'stopped') return null;
        if (kind === 'reply') {
            const reply = DialogProtocol.extractReply(trimmed);
            return reply ? { content: reply, kind } : null;
        }
        return { content: trimmed, kind };
    }

    const onAssistantTurnStart = (/** @type {{ turnId?: string | null }} */ evt) => {
        const turnId = evt?.turnId ?? null;
        beginTerminalTurnMaterialization({ turnId, source: 'sdk/assistant.turn_start' });
        beginTerminalTurnTrace({ turnId });
        broadcastSse(
            'assistant.turn_start',
            withSdkSessionSseEnvelope({ turnId }, 'sdk/assistant.turn_start'),
        );
    };

    const onAssistantTurnEnd = (/** @type {{ turnId?: string | null }} */ evt) => {
        const turnId = evt?.turnId ?? null;
        reconcileTerminalInFlightToolsAtTurnEnd({ registry: _reg, reason: 'assistant.turn_end' });
        const trace = completeTerminalTurnTrace({ turnId });
        recordTerminalActivity('turn', 'Turno do assistente concluído', {
            detail: turnId ? `turno ${compactTerminalDiagnosticId(turnId, 18) ?? turnId}` : 'resposta concluída',
            source: 'sdk',
            recordHistory: false,
        });
        renderTurnTraceSummary(trace);
        broadcastSse('assistant.turn_end', withSdkSessionSseEnvelope({ turnId }, 'sdk/assistant.turn_end'));
        // Drenar entradas stranded do mailbox zero-PR: se o modelo completou sem chamar ask_user,
        // as entradas não serão consumidas automaticamente. Usar setImmediate para aguardar
        // setBusy(false) do engine.js antes de verificar o estado de ociosidade.
        setImmediate(() => {
            drainMailboxToTurnIfIdle('turn_end');
        });
        refreshPromptIfIdle();
    };

    const onAssistantMessage = (/** @type {unknown} */ evt) => {
        const data = eventObject(evt);
        if (typeof data['agentId'] === 'string' && data['agentId'].trim().length > 0) {
            return;
        }
        const normalized = normalizeAssistantTranscriptContent(extractAssistantMessageContent(evt));
        if (!normalized) return;
        if (
            shouldSuppressTerminalAssistantMessageAsUserInputEcho({
                content: normalized.content,
                runtimeId: typeof data['runtimeId'] === 'string' ? data['runtimeId'] : null,
            })
        ) {
            recordTerminalActivity('question', 'Eco de resposta humana suprimido', {
                detail: normalized.content.slice(0, 160),
                source: 'sdk/assistant.message',
                recordHistory: false,
            });
            return;
        }
        const assistantMessageEnvelope = withSdkSessionSseEnvelope(
            {
                content: normalized.content,
                protocolKind: normalized.kind,
            },
            'sdk/assistant.message',
        );
        broadcastSse('assistant.message', assistantMessageEnvelope);
        if (getBusy()) {
            recordTerminalTurnAssistantMessage({
                content: normalized.content,
                kind: normalized.kind,
                source: 'sdk/assistant.message',
            });
            return;
        }
        const assistantMessageTurnId =
            typeof assistantMessageEnvelope.turnId === 'string' || typeof assistantMessageEnvelope.turnId === 'number'
                ? assistantMessageEnvelope.turnId
                : typeof data['turnId'] === 'string' || typeof data['turnId'] === 'number'
                  ? data['turnId']
                  : null;
        const materializationDecision = getTerminalAssistantMessageMaterializationDecision({
            content: normalized.content,
            turnId: assistantMessageTurnId,
        });
        if (materializationDecision.action === 'suppress') {
            completeTerminalTurnMaterialization({
                directReply: normalized.content,
                directSource: 'sdk/assistant.message',
            });
            recordTerminalActivity('turn', 'assistant.message reconciliado sem novo bloco visual', {
                detail: `${normalized.kind} · ${materializationDecision.reason}`,
                source: 'sdk/assistant.message',
                severity: 'info',
                recordHistory: false,
                updateCurrent: false,
            });
            return;
        }
        if (materializationDecision.action === 'render_suffix') {
            completeTerminalTurnMaterialization({
                directReply: normalized.content,
                directSource: 'sdk/assistant.message',
            });
            recordTerminalActivity('streaming', 'assistant.message completou delta público', {
                detail: `${normalized.kind} · ${materializationDecision.reason}`,
                source: 'sdk/assistant.message',
                severity: 'info',
                recordHistory: false,
            });
            const rendered = renderTerminalAssistantTranscript({
                content: materializationDecision.suffix,
                title: 'Complemento da LLM-B',
                source: 'sdk/assistant.message',
                status: 'completed',
                detail: materializationDecision.reason,
                metadata: {
                    assistantMessageEnvelope,
                    materializationDecision,
                },
            });
            if (rendered) refreshPromptIfIdle();
            return;
        }
        recordTerminalActivity('turn', 'Mensagem da LLM-B recebida', {
            detail: `${normalized.kind}${normalized.content ? ` · ${normalized.content.slice(0, 160)}` : ''}`,
            source: 'sdk',
            recordHistory: false,
        });
        const rendered = renderTerminalAssistantTranscript({
            content: normalized.content,
            title: normalized.kind === 'reply' ? 'Resposta fora do turno ativo' : 'Mensagem',
            source: 'sdk/assistant.message',
            status: 'message',
            detail: normalized.kind,
            metadata: {
                assistantMessageEnvelope,
            },
        });
        if (rendered) refreshPromptIfIdle();
    };

    const onSessionInfo = (/** @type {{ infoType?: string; message?: string; url?: string }} */ evt) => {
        const infoType = evt?.infoType ?? 'info';
        const message = evt?.message ?? '(sem mensagem)';
        const modelRetry = infoType === 'model_retry';
        recordTerminalActivity(
            modelRetry ? 'error' : 'system',
            modelRetry ? 'Retry de modelo em andamento' : `Info SDK · ${infoType}`,
            {
                detail: message,
                source: 'sdk',
                severity: modelRetry ? 'warn' : 'info',
                recordHistory: modelRetry,
            },
        );
        if (shouldPrintSessionNarration('verbose')) {
            println(`  \x1b[90mℹ️  [${infoType}] ${message}\x1b[0m`);
            if (evt?.url) println(`  \x1b[90m    ${evt.url}\x1b[0m`);
        }
        broadcastSse(
            'session.info',
            withTerminalTurnCorrelation({
                infoType,
                message,
                url: evt?.url,
                source: 'sdk/session.info',
                timestamp: Date.now(),
            }),
        );
    };

    const onElicitationPending = (/** @type {Record<string, unknown>} */ evt) => {
        const entry = recordTerminalElicitationPending(evt);
        recordTerminalActivity('question', 'Elicitation SDK pendente', {
            detail: `${entry.mode}: ${entry.message.slice(0, 160)}`,
            source: 'sdk',
            severity: 'warn',
        });
        println(`\n  \x1b[36m[sdk elicitation]\x1b[0m \x1b[33m${entry.id}\x1b[0m — ${entry.message}`);
        if (entry.url) println(`  \x1b[36m${entry.url}\x1b[0m`);
        println(
            entry.actionable
                ? '  \x1b[90m/elicitation show latest  ·  /elicitation respond latest accept {"answer":"..."}\x1b[0m'
                : '  \x1b[90m/elicitation show latest  ·  /elicitation list\x1b[0m',
        );
        broadcastSse(
            'elicitation.pending',
            withSdkSessionSseEnvelope({ ...entry }, 'sdk/elicitation.pending'),
        );
        refreshPromptIfIdle();
    };

    const onElicitationCompleted = (/** @type {Record<string, unknown>} */ evt) => {
        const entry = recordTerminalElicitationCompleted(evt);
        const data = eventObject(evt);
        const requestId = stringOr(data['requestId'], entry?.id ?? 'unknown');
        recordTerminalActivity('question', 'Elicitation SDK concluída', {
            detail: renderSdkRequestLabel(requestId),
            source: 'sdk',
            recordHistory: Boolean(entry),
        });
        if (entry) {
            println(`  \x1b[32m✓ Elicitation concluída:\x1b[0m \x1b[90m${renderSdkRequestLabel(entry.id)}\x1b[0m`);
        }
        broadcastSse(
            'elicitation.completed',
            withSdkSessionSseEnvelope({ ...data }, 'sdk/elicitation.completed'),
        );
        refreshPromptIfIdle();
    };

    const onPermissionRequested = (/** @type {Record<string, unknown>} */ evt) => {
        const entry = recordTerminalPermissionRequested(evt);
        recordTerminalActivity('question', 'Permissão SDK solicitada', {
            detail: `${entry.permissionType}${renderSdkOptionalRequestDetail(entry.requestId)}`,
            source: 'sdk',
            severity: 'warn',
        });
        println(
            `\n  \x1b[33m🔐 Permissão solicitada:\x1b[0m ${entry.permissionType}${entry.requestId ? ` \x1b[90m· ${renderSdkRequestLabel(entry.requestId)}\x1b[0m` : ''}`,
        );
        if (!permissionHelpPrinted) {
            println('  \x1b[90mAcompanhe a decisão com /permission list, /status ou /activity.\x1b[0m');
            permissionHelpPrinted = true;
        }
        broadcastSse(
            'permission.requested',
            withSdkSessionSseEnvelope({ ...entry }, 'sdk/permission.requested'),
        );
        refreshPromptIfIdle();
    };

    const onPermissionCompleted = (/** @type {Record<string, unknown>} */ evt) => {
        const entry = recordTerminalPermissionCompleted(evt);
        const data = eventObject(evt);
        const granted = data['granted'] ?? data['approved'] ?? entry?.granted;
        const decision = classifyTerminalPermissionDecision(
            entry?.result ?? null,
            typeof granted === 'boolean' ? granted : null,
        );

        // Detecta autoaprovação/autonegação por regras/política do hook
        const wasDeniedByPolicy =
            entry?.result === 'denied-by-rules' ||
            entry?.result === 'denied-by-permission-request-hook' ||
            entry?.result === 'denied-by-content-exclusion-policy';

        const ok = granted === true || entry?.result === 'approved';
        const label = ok
            ? 'Permissão SDK aprovada'
            : wasDeniedByPolicy
              ? 'Permissão SDK negada (política)'
              : 'Permissão SDK concluída';
        const ambiguousEcho =
            entry?.permissionType === 'permission.requested' && granted == null && !entry?.result && !entry?.requestId;

        recordTerminalActivity('system', label, {
            detail: entry
                ? `${entry.permissionType} · ${renderPermissionDecisionLabel(entry.result ?? null, typeof granted === 'boolean' ? granted : null)}${wasDeniedByPolicy ? ' · política automática' : ''}`
                : 'pedido local não encontrado',
            source: 'sdk',
            severity: ok || granted == null ? 'info' : 'warn',
            recordHistory: !ambiguousEcho,
            updateCurrent: false,
        });

        const resultLabel = granted == null ? '' : granted ? '\x1b[32maprovada\x1b[0m' : '\x1b[31mnão aprovada\x1b[0m';
        const policyIndicator = wasDeniedByPolicy ? ' \x1b[90m(política)\x1b[0m' : '';
        if (!ambiguousEcho) {
            println(
                `  ${ok ? '\x1b[32m✓' : '\x1b[33m•'} Permissão:\x1b[0m ${entry?.permissionType ?? 'unknown'} ${resultLabel}${policyIndicator}`,
            );
        }
        broadcastSse(
            'permission.completed',
            withSdkSessionSseEnvelope({ ...data, decision, wasDeniedByPolicy }, 'sdk/permission.completed'),
        );
        refreshPromptIfIdle();
    };

    const onPermissionModeChanged = (/** @type {{ mode?: string }} */ evt) => {
        const mode = typeof evt?.mode === 'string' ? evt.mode : 'approve_all';
        recordTerminalPermissionModeChanged({ mode, ts: Date.now() });
        recordTerminalActivity('system', 'Modo de permissão alterado', {
            detail: renderPermissionModeLabel(mode),
            source: 'sdk',
            severity: 'warn',
        });
        if (shouldPrintSessionNarration('important')) {
            println(
                `  ${terminalThemeBadge('warn', 'PERM')} ${terminalThemeText('warn', `Modo de permissão: ${renderPermissionModeLabel(mode)}`)}`,
            );
        }
        broadcastSse('permission.mode_changed', withSdkSessionSseEnvelope({ mode }, 'sdk/permission.mode_changed'));
        refreshPromptIfIdle();
    };

    const onUserInputRequested = (
        /**
         * @type {{
         *     requestId?: string;
         *     runtimeId?: string | null;
         *     question?: string;
         *     choices?: string[];
         *     allowFreeform?: boolean;
         *     toolCallId?: string | null;
         * }}
         */ evt,
    ) => {
        const question = evt?.question ?? '(sem pergunta)';
        const choices = Array.isArray(evt?.choices) ? evt.choices : [];
        const allowFreeform = evt?.allowFreeform !== false;
        const requestId = evt?.requestId ?? null;
        const kind = DialogProtocol.classify(question);
        const tracked = recordTerminalUserInputRequested(evt);
        const askUserToolCallId =
            tracked.toolCallId ?? (requestId ? `ask_user:${requestId}` : `ask_user:${Date.now()}`);
        if (kind === 'question') {
            _reg.register(askUserToolCallId, 'ask_user', 'native', {
                requestId,
                canonicalName: 'ask_user',
                rawArgs: { question, choices, allowFreeform },
                presentation: buildTerminalToolActivityPresentation(
                    { toolName: 'ask_user', args: { question, choices, allowFreeform }, toolCallId: askUserToolCallId },
                    'ask_user',
                ),
            });
            if (requestId) _reg.markRequestIdForExternalTool(requestId, 'ask_user');
        }
        if (requestId && kind !== 'question') {
            pruneSuppressedProtocolRequestIds();
            suppressedProtocolRequestIds.set(requestId, Date.now());
        }
        if (kind !== 'question') {
            refreshPromptIfIdle();
            return;
        }
        recordTerminalTurnUserInputActivity({
            requestId,
            kind,
            question,
            choices,
            allowFreeform,
            status: 'requested',
            source: 'sdk',
        });
        recordTerminalActivity('question', 'ask_user SDK solicitado', {
            detail: `${question.slice(0, 160)}${choices.length > 0 ? ` · opções ${choices.join('|')}` : ''}`,
            source: 'sdk',
            severity: allowFreeform ? 'info' : 'warn',
        });
        const requestedEnvelope = withSdkSessionSseEnvelope(
            {
                requestId: evt?.requestId ?? null,
                question,
                choices,
                allowFreeform,
                toolCallId: evt?.toolCallId ?? null,
            },
            'sdk/user_input.requested',
        );
        appendUserInputTranscriptTurn({
            phase: 'requested',
            requestId,
            question,
            choices,
            allowFreeform,
            toolCallId: evt?.toolCallId ?? null,
            envelope: requestedEnvelope,
        });
        broadcastSse(
            'user_input.requested',
            requestedEnvelope,
        );
        if (shouldPrintSessionNarration('important')) {
            const optionsLabel = choices.length > 0 ? ` · ${choices.length} opção(ões)` : '';
            println(
                `  ${terminalThemeBadge('question', 'PERGUNTA')} ${terminalThemeText('question', tracked.question.slice(0, 120))}${terminalThemeText('muted', optionsLabel)}`,
            );
        }

        const runtimeId = typeof evt?.runtimeId === 'string' && evt.runtimeId.trim().length > 0 ? evt.runtimeId : null;
        const mailboxEntry = consumeRuntimeInterventionMailbox(runtimeId);
        if (mailboxEntry) {
            const answered = answerTerminalPendingQuestion(mailboxEntry.message, runtimeId);
            if (answered) {
                const mailboxSummary = readRuntimeInterventionMailboxSummary(runtimeId);
                recordTerminalActivity('question', 'Mailbox zero-PR aplicado em ask_user', {
                    detail: `origem ${mailboxEntry.source} · modo ${mailboxEntry.modeHint}${mailboxEntry.mergedCount > 0 ? ` · ${mailboxEntry.mergedCount} mescla(s)` : ''}`,
                    source: 'sdk',
                    severity: 'info',
                    recordHistory: false,
                });
                println(
                    `  ${terminalThemeBadge('info', 'MAILBOX')} ${terminalThemeText('info', `intervenção aplicada automaticamente`)}${terminalThemeText('muted', ` · origem ${mailboxEntry.source} · modo ${mailboxEntry.modeHint} · ${mailboxSummary.queueSize} restante(s) na fila`)}`,
                );
                broadcastSse(
                    'intervention.mailbox.applied',
                    withTerminalTurnCorrelation({
                        runtimeId,
                        entryId: mailboxEntry.id,
                        source: mailboxEntry.source,
                        eventSource: 'sdk/intervention.mailbox.applied',
                        modeHint: mailboxEntry.modeHint,
                        mergedCount: mailboxEntry.mergedCount,
                        queueSize: mailboxSummary.queueSize,
                        dropped: mailboxSummary.dropped,
                        timestamp: Date.now(),
                    }),
                );
            } else {
                enqueueRuntimeInterventionMailbox({
                    runtimeId,
                    source: mailboxEntry.source,
                    modeHint: mailboxEntry.modeHint,
                    message: mailboxEntry.message,
                });
                recordTerminalActivity('question', 'Mailbox zero-PR não aplicado (requeued)', {
                    detail: `${mailboxEntry.id} · pending answer route unavailable`,
                    source: 'sdk',
                    severity: 'warn',
                    recordHistory: false,
                });
            }
        }
        refreshPromptIfIdle();
    };

    const onUserInputCompleted = (
        /** @type {{ requestId?: string; answer?: string; wasFreeform?: boolean }} */ evt,
    ) => {
        const requestId = evt?.requestId ?? null;
        if (requestId && suppressedProtocolRequestIds.has(requestId)) {
            suppressedProtocolRequestIds.delete(requestId);
            recordTerminalUserInputCompleted(evt);
            refreshPromptIfIdle();
            return;
        }
        const wasFreeform = evt?.wasFreeform === true;
        const completed = recordTerminalUserInputCompleted(evt);
        recordTerminalTurnUserInputActivity({
            requestId,
            status: 'answered',
            answerPreview: String(evt?.answer ?? '').slice(0, 120),
            source: 'sdk',
        });
        recordTerminalActivity('question', 'ask_user SDK respondido', {
            detail: `${renderSdkRequestLabel(requestId)} · ${renderUserInputAnswerModeLabel(wasFreeform)}`,
            source: 'sdk',
            recordHistory: false,
        });
        const completedEnvelope = withSdkSessionSseEnvelope(
            {
                requestId,
                answer: evt?.answer ?? '',
                wasFreeform,
            },
            'sdk/user_input.completed',
        );
        appendUserInputTranscriptTurn({
            phase: 'completed',
            requestId,
            question: completed?.question ?? '(sem pergunta)',
            answer: evt?.answer ?? '',
            wasFreeform,
            envelope: completedEnvelope,
        });
        broadcastSse(
            'user_input.completed',
            completedEnvelope,
        );
        refreshPromptIfIdle();
    };

    const onSessionWarning = (/** @type {{ warningType?: string; message?: string; url?: string }} */ evt) => {
        const warningType = evt?.warningType ?? 'warning';
        const message = evt?.message ?? '(sem mensagem)';
        recordTerminalActivity('system', `Warning SDK · ${warningType}`, {
            detail: message,
            severity: 'warn',
            source: 'sdk',
        });
        println(`  \x1b[33m⚠️  [${warningType}] ${message}\x1b[0m`);
        if (evt?.url) println(`  \x1b[90m    ${evt.url}\x1b[0m`);
        broadcastSse(
            'session.warning',
            withTerminalTurnCorrelation({
                warningType,
                message,
                url: evt?.url,
                source: 'sdk/session.warning',
                timestamp: Date.now(),
            }),
        );
    };

    const onSessionModelChanged = (
        /** @type {{ previousModel?: string; newModel?: string; reasoningEffort?: string }} */ evt,
    ) => {
        const previousModel = evt?.previousModel ?? 'unknown';
        const newModel = evt?.newModel ?? 'unknown';
        const reasoningEffort = evt?.reasoningEffort ?? null;
        observeTerminalModelChangeProjection({ previousModel, newModel, reasoningEffort });
        void recordModelGatewaySdkSessionConfirmation(previousModel, newModel, reasoningEffort).catch((error) => {
            recordTerminalActivity('system', 'Falha ao registrar confirmação SDK no model-gateway', {
                detail: error instanceof Error ? error.message : String(error),
                severity: 'warn',
                source: 'sdk',
                recordHistory: false,
            });
        });
        recordTerminalActivity('system', 'Modelo SDK alterado', {
            detail: `de ${previousModel} para ${newModel}${reasoningEffort ? ` · raciocínio ${reasoningEffort}` : ''}`,
            source: 'sdk',
        });
        if (shouldPrintSessionNarration('verbose')) {
            println(
                `  ${terminalThemeBadge('info', 'MODELO')} ${terminalThemeText('info', `SDK confirmou ${previousModel} → ${newModel}`)}${reasoningEffort ? terminalThemeText('muted', ` · raciocínio ${reasoningEffort}`) : ''}`,
            );
        }
        broadcastSse(
            'session.model_changed',
            withSdkSessionSseEnvelope(
                {
                    previousModel,
                    newModel,
                    reasoningEffort,
                },
                'sdk/session.model_changed',
            ),
        );
        refreshPromptIfIdle();
    };

    const onSessionTitleChanged = (/** @type {{ title?: string }} */ evt) => {
        const title = evt?.title ?? '(sem título)';
        recordTerminalActivity('system', 'Título da sessão atualizado', {
            detail: title,
            source: 'sdk',
            recordHistory: false,
        });
        if (shouldPrintSessionNarration('verbose')) println(`  \x1b[90m🪪 Título da sessão: ${title}\x1b[0m`);
        broadcastSse('session.title_changed', withSdkSessionSseEnvelope({ title }, 'sdk/session.title_changed'));
    };

    const onSessionContextChanged = (/** @type {{ cwd?: string; branch?: string; repository?: string }} */ evt) => {
        const cwd = evt?.cwd ?? '(cwd desconhecido)';
        const branch = evt?.branch ? ` · ${evt.branch}` : '';
        const repository = evt?.repository ? ` · ${evt.repository}` : '';
        recordTerminalActivity('system', 'Contexto SDK alterado', {
            detail: `${cwd}${branch}${repository}`,
            source: 'sdk',
        });
        if (shouldPrintSessionNarration('verbose'))
            println(`  \x1b[90m📁 Contexto SDK: ${cwd}${branch}${repository}\x1b[0m`);
        broadcastSse(
            'session.context_changed',
            withSdkSessionSseEnvelope(
                {
                    cwd: evt?.cwd,
                    branch: evt?.branch,
                    repository: evt?.repository,
                },
                'sdk/session.context_changed',
            ),
        );
    };

    const onSessionModeChanged = (
        /** @type {{ previousMode?: string; newMode?: 'interactive' | 'plan' | 'autopilot' | 'shell' }} */ evt,
    ) => {
        const previousMode = evt?.previousMode ?? 'unknown';
        const newMode = evt?.newMode ?? null;
        setSdkSessionMode(newMode);
        recordTerminalActivity('system', 'Modo SDK alterado', {
            detail: `${previousMode} → ${newMode ?? 'unknown'}`,
            source: 'sdk',
        });
        if (shouldPrintSessionNarration('verbose')) {
            println(`  \x1b[35m🧭 Modo SDK: ${previousMode} → ${newMode ?? 'unknown'}\x1b[0m`);
        }
        broadcastSse(
            'session.mode_changed',
            withSdkSessionSseEnvelope({ previousMode, newMode }, 'sdk/session.mode_changed'),
        );
        refreshPromptIfIdle();
    };

    const onSessionPlanChanged = (/** @type {{ operation?: 'create' | 'update' | 'delete' }} */ evt) => {
        const operation = evt?.operation ?? null;
        setLastSdkPlanOperation(operation);
        recordTerminalActivity('system', 'Plano SDK alterado', {
            detail: operation ? `plan ${operation}` : 'plan modificado',
            source: 'sdk',
        });
        if (shouldPrintSessionNarration('verbose')) println(`  \x1b[33m📝 Plan SDK: ${operation ?? 'alterado'}\x1b[0m`);
        broadcastSse('session.plan_changed', withSdkSessionSseEnvelope({ operation }, 'sdk/session.plan_changed'));
        refreshPromptIfIdle();
    };

    const onSessionToolsUpdated = (
        /** @type {{ count?: number; tools?: unknown[]; toolsMaterialized?: boolean; countMaterialized?: boolean }} */ evt,
    ) => {
        const hasSdkToolList = Array.isArray(evt?.tools);
        const hasMaterializedCount =
            evt?.countMaterialized === true ||
            hasSdkToolList ||
            (typeof evt?.count === 'number' && Number.isFinite(evt.count) && evt.count > 0);
        const sdkCount = hasSdkToolList
            ? evt.tools?.length ?? 0
            : hasMaterializedCount && typeof evt?.count === 'number' && Number.isFinite(evt.count)
              ? evt.count
              : null;
        const registrySnapshot = readTerminalToolRegistrySnapshot();
        const localCount = Number(registrySnapshot.total ?? 0);
        const localToolsLabel =
            localCount > 0 ? `${pluralPt(localCount, 'ferramenta local ativa', 'ferramentas locais ativas')} em /tools` : 'sem ferramentas locais ativas';
        const countLabel =
            sdkCount === null
                ? `SDK sinalizou atualização sem contagem materializada; ${localToolsLabel}`
                : `${pluralPt(sdkCount, 'ferramenta dinâmica do SDK', 'ferramentas dinâmicas do SDK')}; ${localToolsLabel}`;
        recordTerminalActivity('system', 'Ferramentas dinâmicas do SDK atualizadas', {
            detail: countLabel,
            source: 'sdk',
            recordHistory: false,
        });
        if (shouldPrintSessionNarration('verbose')) {
            const sdkLabel = sdkCount === null ? 'contagem SDK n/d' : `${sdkCount} SDK`;
            const localLabel = localCount > 0 ? `ferramentas locais ativas: ${localCount} (/tools)` : 'sem ferramentas locais ativas';
            println(`  \x1b[90m🧰 Ferramentas dinâmicas do SDK atualizadas: ${sdkLabel} · ${localLabel}\x1b[0m`);
        }
        broadcastSse(
            'session.tools_updated',
            withSdkSessionSseEnvelope(
                {
                    count: sdkCount ?? localCount,
                    sdkCount,
                    localCount,
                    localToolsActive: localCount > 0,
                },
                'sdk/session.tools_updated',
            ),
        );
    };

    const onSessionSkillsLoaded = (/** @type {{ count?: number; enabled?: number }} */ evt) => {
        const count = Number(evt?.count ?? 0);
        const enabled = Number(evt?.enabled ?? count);
        recordTerminalActivity('system', 'Skills SDK carregadas', {
            detail: `${enabled}/${count} habilitada(s)`,
            source: 'sdk',
            recordHistory: false,
        });
        if (shouldPrintSessionNarration('verbose'))
            println(`  \x1b[90m🎛️  Skills SDK: ${enabled}/${count} habilitadas\x1b[0m`);
        broadcastSse(
            'session.skills_loaded',
            withSdkSessionSseEnvelope({ count, enabled }, 'sdk/session.skills_loaded'),
        );
    };

    const onSessionExtensionsLoaded = (/** @type {{ count?: number }} */ evt) => {
        const count = Number(evt?.count ?? 0);
        recordTerminalActivity('system', 'Extensões SDK carregadas', {
            detail: `${count} extensão(ões)`,
            source: 'sdk',
            recordHistory: false,
        });
        broadcastSse(
            'session.extensions_loaded',
            withSdkSessionSseEnvelope({ count }, 'sdk/session.extensions_loaded'),
        );
    };

    const onSessionMcpServersLoaded = (/** @type {{ count?: number }} */ evt) => {
        const count = Number(evt?.count ?? 0);
        recordTerminalActivity('system', 'MCP servers carregados', {
            detail: `${count} server(s)`,
            source: 'sdk',
            recordHistory: false,
        });
        if (shouldPrintSessionNarration('verbose')) println(`  \x1b[90mMCP servers carregados: ${count}\x1b[0m`);
        broadcastSse(
            'session.mcp_servers_loaded',
            withSdkSessionSseEnvelope({ count }, 'sdk/session.mcp_servers_loaded'),
        );
    };

    const onSessionBackgroundTasksChanged = (/** @type {{ count?: number }} */ evt) => {
        const count = Number(evt?.count ?? 0);
        recordTerminalActivity('system', 'Background tasks SDK alteradas', {
            detail: `${count} pendente(s)`,
            source: 'sdk',
            severity: count > 0 ? 'warn' : 'info',
            recordHistory: count > 0,
        });
        broadcastSse(
            'session.background_tasks_changed',
            withSdkSessionSseEnvelope({ count }, 'sdk/session.background_tasks_changed'),
        );
    };

    const onSessionTaskComplete = (/** @type {{ summary?: string | null }} */ evt) => {
        const summary = typeof evt?.summary === 'string' ? evt.summary.trim() : '';
        recordTerminalActivity('task', 'Sessão marcou tarefa como concluída', {
            detail: summary || 'SDK sinalizou task_complete',
            source: 'sdk',
        });
        if (shouldPrintSessionNarration('important')) {
            println(`  \x1b[32m🏁 Task concluída${summary ? `: ${summary}` : ''}\x1b[0m`);
        }
        broadcastSse(
            'session.task_complete',
            withSdkSessionSseEnvelope({ summary: summary || null }, 'sdk/session.task_complete'),
        );
    };

    const onSessionTruncation = (
        /** @type {{ messageTruncatedCount?: number; tokensTruncated?: number; reason?: string }} */ evt,
    ) => {
        const messageTruncatedCount = Number(evt?.messageTruncatedCount ?? 0);
        const tokensTruncated = Number(evt?.tokensTruncated ?? 0);
        const reason = evt?.reason ?? 'unknown';
        recordTerminalActivity('system', 'Sessão truncou histórico', {
            detail: `${messageTruncatedCount} msgs · ${tokensTruncated.toLocaleString('pt-BR')} tokens · ${reason}`,
            severity: 'warn',
            source: 'sdk',
        });
        println(
            `  \x1b[33m✂️  Truncation SDK: ${messageTruncatedCount} msgs · ${tokensTruncated.toLocaleString('pt-BR')} tokens · ${reason}\x1b[0m`,
        );
        broadcastSse(
            'session.truncation',
            withSdkSessionSseEnvelope(
                {
                    messageTruncatedCount,
                    tokensTruncated,
                    reason,
                },
                'sdk/session.truncation',
            ),
        );
    };

    const onSessionSnapshotRewind = (/** @type {{ snapshotId?: string; reason?: string }} */ evt) => {
        const snapshotId = evt?.snapshotId ?? 'unknown';
        const reason = evt?.reason ?? 'unknown';
        recordTerminalActivity('system', 'Sessão rebobinou snapshot', {
            detail: `${snapshotId} · ${reason}`,
            severity: 'warn',
            source: 'sdk',
        });
        println(`  \x1b[33m⏪ Snapshot rewind: ${snapshotId} · ${reason}\x1b[0m`);
        broadcastSse(
            'session.snapshot_rewind',
            withSdkSessionSseEnvelope({ snapshotId, reason }, 'sdk/session.snapshot_rewind'),
        );
    };

    const onSessionShutdown = (/** @type {{ shutdownType?: string; reason?: string }} */ evt) => {
        const shutdownType = evt?.shutdownType ?? 'unknown';
        const reason = evt?.reason ?? null;
        recordTerminalActivity('system', 'Sessão sinalizou shutdown', {
            detail: `${shutdownType}${reason ? ` · ${reason}` : ''}`,
            severity: 'warn',
            source: 'sdk',
        });
        println(`  \x1b[33m🛑 Shutdown SDK: ${shutdownType}${reason ? ` · ${reason}` : ''}\x1b[0m`);
        broadcastSse(
            'session.shutdown',
            withSdkSessionSseEnvelope({ shutdownType, reason }, 'sdk/session.shutdown'),
        );
        // Limpeza defensiva em shutdown para não carregar estado órfão em sessões subsequentes.
        suppressedProtocolRequestIds.clear();
        _reg.clear();
    };

    const onSessionHandoff = (
        /** @type {{ fromAgent?: string; toAgent?: string; reason?: string; context?: unknown }} */ evt,
    ) => {
        const fromAgent = evt?.fromAgent ?? 'unknown';
        const toAgent = evt?.toAgent ?? 'unknown';
        const reason = evt?.reason ?? null;
        recordTerminalActivity('subagent', 'Handoff entre agentes', {
            detail: `${fromAgent} → ${toAgent}${reason ? ` · ${reason}` : ''}`,
            source: 'sdk',
        });
        if (shouldPrintSessionNarration('important')) {
            println(`  \x1b[36m🔁 Handoff SDK: ${fromAgent} → ${toAgent}${reason ? ` · ${reason}` : ''}\x1b[0m`);
        }
        broadcastSse(
            'session.handoff',
            withSdkSessionSseEnvelope(
                {
                    fromAgent,
                    toAgent,
                    reason,
                    context: evt?.context,
                },
                'sdk/session.handoff',
            ),
        );
    };

    const onWorkspaceFileChanged = (/** @type {{ path?: string; operation?: 'create' | 'update' | string }} */ evt) => {
        const path = evt?.path ?? '(path desconhecido)';
        const operation = evt?.operation ?? 'unknown';
        if (path && path !== '(path desconhecido)') {
            recordTerminalTurnFileActivity({
                path,
                operation: operation === 'create' ? 'write' : operation === 'update' ? 'edit' : 'unknown',
                source: 'sdk',
            });
        }
        recordTerminalActivity('system', 'Workspace da sessão alterado', {
            detail: `${operation} · ${path}`,
            source: 'sdk',
            recordHistory: false,
        });
        if (shouldPrintSessionNarration('verbose'))
            println(`  \x1b[90m🗂️  Workspace file ${operation}: ${path}\x1b[0m`);
        broadcastSse(
            'session.workspace_file_changed',
            withSdkSessionSseEnvelope({ path, operation }, 'sdk/session.workspace_file_changed'),
        );
    };

    const onToolUserRequested = (/** @type {{ toolName?: string; requestId?: string }} */ evt) => {
        handleTerminalToolUserRequested(/** @type {Record<string, unknown>} */ (evt ?? {}));
        refreshPromptIfIdle();
    };

    const onExternalToolRequested = (
        /** @type {{ toolName?: string; requestId?: string; toolCallId?: string; data?: Record<string, unknown> }} */ evt,
    ) => {
        handleTerminalExternalToolRequested({
            registry: _reg,
            evt,
            verboseNarration: shouldPrintSessionNarration('verbose'),
        });
    };

    const onExternalToolCompleted = (
        /**
         * @type {{
         *     toolName?: string;
         *     requestId?: string;
         *     toolCallId?: string;
         *     success?: boolean;
         *     data?: Record<string, unknown>;
         * }}
         */ evt,
    ) => {
        handleTerminalExternalToolCompleted({
            registry: _reg,
            evt,
            verboseNarration: shouldPrintSessionNarration('verbose'),
        });
    };

    const onMcpServerStatusChanged = (/** @type {{ serverName?: string; status?: string }} */ evt) => {
        const serverName = evt?.serverName ?? 'unknown';
        const status = evt?.status ?? 'unknown';
        const severity = status === 'failed' || status === 'disconnected' ? 'warn' : 'info';
        recordTerminalActivity('system', 'MCP server alterou status', {
            detail: `${serverName} → ${status}`,
            source: 'sdk',
            severity,
            recordHistory: severity === 'warn',
        });
        if (shouldPrintSessionNarration(severity === 'warn' ? 'important' : 'verbose')) {
            println(`  \x1b[90mMCP ${serverName}: ${status}\x1b[0m`);
        }
        broadcastSse(
            'mcp.server.status_changed',
            withSdkSessionSseEnvelope({ serverName, status }, 'sdk/mcp.server.status_changed'),
        );
    };

    const onMcpOauthRequired = (/** @type {{ serverName?: string; requestId?: string }} */ evt) => {
        const serverName = evt?.serverName ?? 'unknown';
        const requestId = evt?.requestId ?? null;
        recordTerminalActivity('question', 'OAuth MCP necessário', {
            detail: `${serverName}${renderSdkOptionalRequestDetail(requestId)}`,
            source: 'sdk',
            severity: 'warn',
        });
        println(
            `\n  \x1b[33m🔑 OAuth MCP necessário:\x1b[0m ${serverName}${requestId ? ` \x1b[90m· ${renderSdkRequestLabel(requestId)}\x1b[0m` : ''}`,
        );
        broadcastSse(
            'mcp.oauth.required',
            withSdkSessionSseEnvelope({ serverName, requestId }, 'sdk/mcp.oauth.required'),
        );
        if (serverName !== 'unknown') {
            void (async () => {
                try {
                    const result = await loginTerminalSdkMcpOauth(serverName);
                    const payload = eventObject(result);
                    const loginUrl =
                        (typeof payload['url'] === 'string' && payload['url']) ||
                        (typeof payload['verificationUri'] === 'string' && payload['verificationUri']) ||
                        (typeof payload['verification_uri'] === 'string' && payload['verification_uri']) ||
                        null;
                    recordTerminalActivity('system', 'Fluxo OAuth MCP iniciado', {
                        detail: `${serverName}${loginUrl ? ` · ${loginUrl}` : ''}`,
                        source: 'sdk',
                        severity: 'info',
                        recordHistory: false,
                    });
                    println(
                        `  ${terminalThemeBadge('info', 'MCP')} ${terminalThemeText('info', `Login OAuth MCP iniciado para ${serverName}`)}`,
                    );
                    if (loginUrl) {
                        println(`  \x1b[36m${loginUrl}\x1b[0m`);
                    }
                    broadcastSse(
                        'mcp.oauth.login_started',
                        withSdkSessionSseEnvelope(
                            {
                                serverName,
                                requestId,
                                loginUrl,
                                payload,
                            },
                            'sdk/mcp.oauth.login_started',
                        ),
                    );
                    refreshPromptIfIdle();
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error ?? 'erro desconhecido');
                    recordTerminalActivity('system', 'Falha ao iniciar OAuth MCP via RPC', {
                        detail: `${serverName} · ${message}`,
                        source: 'sdk',
                        severity: 'warn',
                        recordHistory: false,
                    });
                    println(
                        `  ${terminalThemeBadge('warn', 'MCP')} ${terminalThemeText('warn', `Login OAuth MCP indisponível para ${serverName}: ${message}`)}`,
                    );
                    broadcastSse(
                        'mcp.oauth.login_failed',
                        withSdkSessionSseEnvelope(
                            {
                                serverName,
                                requestId,
                                error: message,
                            },
                            'sdk/mcp.oauth.login_failed',
                        ),
                    );
                    refreshPromptIfIdle();
                }
            })();
        }
        refreshPromptIfIdle();
    };

    const onMcpOauthCompleted = (/** @type {{ requestId?: string }} */ evt) => {
        const requestId = evt?.requestId ?? null;
        recordTerminalActivity('system', 'OAuth MCP concluído', {
            detail: renderSdkRequestLabel(requestId),
            source: 'sdk',
        });
        if (shouldPrintSessionNarration('important')) {
            println(`  \x1b[32m✓ OAuth MCP concluído${requestId ? ` · ${renderSdkRequestLabel(requestId)}` : ''}\x1b[0m`);
        }
        broadcastSse(
            'mcp.oauth.completed',
            withSdkSessionSseEnvelope({ requestId }, 'sdk/mcp.oauth.completed'),
        );
        refreshPromptIfIdle();
    };

    const onPendingMessagesModified = (/** @type {{ count?: number }} */ evt) => {
        const count = Number(evt?.count ?? 0);
        recordTerminalActivity('turn', 'Pending messages alteradas', {
            detail: `${count} mensagem(ns) pendente(s)`,
            source: 'sdk',
            recordHistory: false,
        });
        broadcastSse(
            'pending_messages.modified',
            withSdkSessionSseEnvelope({ count }, 'sdk/pending_messages.modified'),
        );
    };

    const onHookStart = (
        /** @type {{ hookInvocationId?: string; hookType?: string; input?: Record<string, unknown> }} */ evt,
    ) => {
        const hookType = evt?.hookType ?? 'unknown';
        const hookInvocationId = evt?.hookInvocationId ?? null;
        recordTerminalActivity('system', 'Hook SDK iniciado', {
            detail: `${hookType}${hookInvocationId ? ` · ${hookInvocationId}` : ''}`,
            source: 'sdk',
            recordHistory: false,
            updateCurrent: false,
        });
        broadcastSse(
            'hook.start',
            withSdkSessionSseEnvelope(
                {
                    hookType,
                    hookInvocationId,
                    input: evt?.input ?? null,
                },
                'sdk/hook.start',
            ),
        );
    };

    const onHookEnd = (
        /** @type {{
    hookInvocationId?: string;
    hookType?: string;
    success?: boolean;
    error?: { message?: string };
}} */ evt,
    ) => {
        const hookType = evt?.hookType ?? 'unknown';
        const hookInvocationId = evt?.hookInvocationId ?? null;
        const success = evt?.success === true;
        const errorMessage = evt?.error?.message ?? null;
        recordTerminalActivity('system', success ? 'Hook SDK concluído' : 'Hook SDK falhou', {
            detail: `${hookType}${hookInvocationId ? ` · ${hookInvocationId}` : ''}${errorMessage ? ` · ${errorMessage}` : ''}`,
            source: 'sdk',
            severity: success ? 'info' : 'warn',
            recordHistory: !success,
            updateCurrent: !success,
        });
        if (!success) {
            println(
                `  ${terminalThemeBadge('warn', 'HOOK')} ${terminalThemeText('warn', `${hookType} falhou${errorMessage ? ` · ${errorMessage}` : ''}`)}`,
            );
        }
        broadcastSse(
            'hook.end',
            withSdkSessionSseEnvelope(
                {
                    hookType,
                    hookInvocationId,
                    success,
                    error: errorMessage,
                },
                'sdk/hook.end',
            ),
        );
        if (success && (hookType === 'sessionEnd' || hookType === 'session_end')) {
            setImmediate(() => {
                if (!getBusy()) {
                    markTerminalActivityIdle('Turno concluído; aguardando próxima mensagem');
                }
            });
        }
    };

    const onSamplingRequested = (
        /** @type {{ requestId?: string; serverName?: string; mcpRequestId?: string | number }} */ evt,
    ) => {
        const requestId = evt?.requestId ?? null;
        const serverName = evt?.serverName ?? 'unknown';
        const mcpRequestId = evt?.mcpRequestId ?? null;
        recordTerminalActivity('question', 'Sampling MCP solicitado', {
            detail: `${serverName}${renderSdkOptionalRequestDetail(requestId)}`,
            source: 'sdk',
            severity: 'warn',
        });
        if (shouldPrintSessionNarration('important')) {
            println(
                `  ${terminalThemeBadge('warn', 'SAMPLE')} ${terminalThemeText('warn', `${serverName} solicitou sampling${requestId ? ` · ${renderSdkRequestLabel(requestId)}` : ''}`)}`,
            );
        }
        broadcastSse(
            'sampling.requested',
            withSdkSessionSseEnvelope(
                {
                    requestId,
                    serverName,
                    mcpRequestId,
                },
                'sdk/sampling.requested',
            ),
        );
        refreshPromptIfIdle();
    };

    const onSamplingCompleted = (/** @type {{ requestId?: string }} */ evt) => {
        const requestId = evt?.requestId ?? null;
        recordTerminalActivity('system', 'Sampling MCP concluído', {
            detail: requestId ? renderSdkRequestLabel(requestId) : 'sampling concluído',
            source: 'sdk',
            recordHistory: false,
        });
        broadcastSse('sampling.completed', withSdkSessionSseEnvelope({ requestId }, 'sdk/sampling.completed'));
        refreshPromptIfIdle();
    };

    const onCommandsChanged = (
        /** @type {{ commands?: { name?: string; description?: string }[]; count?: number }} */ evt,
    ) => {
        const commands = Array.isArray(evt?.commands) ? evt.commands : [];
        const count = Number(evt?.count ?? commands.length ?? 0);
        const preview = commands
            .slice(0, 3)
            .map((command) => command?.name ?? 'unknown')
            .join(', ');
        recordTerminalActivity('system', 'Comandos SDK atualizados', {
            detail: `${count} comando(s)${preview ? ` · ${preview}` : ''}`,
            source: 'sdk',
            recordHistory: false,
        });
        if (shouldPrintSessionNarration('verbose')) {
            println(
                `  ${terminalThemeBadge('info', 'CMDS')} ${terminalThemeText('muted', `${count} comando(s)${preview ? ` · ${preview}` : ''}`)}`,
            );
        }
        broadcastSse('commands.changed', withSdkSessionSseEnvelope({ count, commands }, 'sdk/commands.changed'));
        refreshPromptIfIdle();
    };

    const onCapabilitiesChanged = (
        /** @type {{
    capabilities?: { ui?: { elicitation?: boolean } };
    changes?: { ui?: { elicitation?: boolean } };
}} */ evt,
    ) => {
        const uiChanges = evt?.changes?.ui ?? {};
        const uiCapabilities = evt?.capabilities?.ui ?? {};
        const elicitationEnabled = uiCapabilities.elicitation === true;
        const changeBits = [
            uiChanges.elicitation !== undefined
                ? `elicitation ${uiChanges.elicitation === true ? 'ativada' : 'desativada'}`
                : null,
            `snapshot ${elicitationEnabled ? 'com elicitation' : 'sem elicitation'}`,
        ]
            .filter(Boolean)
            .join(' · ');
        recordTerminalActivity('system', 'Capabilities SDK alteradas', {
            detail: changeBits || 'capabilities alteradas',
            source: 'sdk',
            recordHistory: false,
        });
        if (shouldPrintSessionNarration('verbose')) {
            println(
                `  ${terminalThemeBadge('info', 'CAPS')} ${terminalThemeText('muted', changeBits || 'capabilities alteradas')}`,
            );
        }
        broadcastSse(
            'capabilities.changed',
            withSdkSessionSseEnvelope(
                {
                    capabilities: evt?.capabilities ?? null,
                    changes: evt?.changes ?? null,
                },
                'sdk/capabilities.changed',
            ),
        );
        refreshPromptIfIdle();
    };

    const onAutoModeSwitchRequested = (/** @type {{ requestId?: string; errorCode?: string }} */ evt) => {
        const requestId = evt?.requestId ?? null;
        const errorCode = evt?.errorCode ?? null;
        recordTerminalActivity('system', 'Troca automática de modo solicitada', {
            detail: `${renderSdkRequestLabel(requestId)}${errorCode ? ` · ${errorCode}` : ''}`,
            source: 'sdk',
            severity: 'warn',
        });
        if (shouldPrintSessionNarration('important')) {
            println(
                `  ${terminalThemeBadge('warn', 'AUTO')} ${terminalThemeText('warn', `SDK solicitou auto mode switch${errorCode ? ` · ${errorCode}` : ''}`)}`,
            );
        }
        broadcastSse(
            'auto_mode_switch.requested',
            withSdkSessionSseEnvelope({ requestId, errorCode }, 'sdk/auto_mode_switch.requested'),
        );
        refreshPromptIfIdle();
    };

    const onAutoModeSwitchCompleted = (/** @type {{ requestId?: string; response?: string }} */ evt) => {
        const requestId = evt?.requestId ?? null;
        const response = evt?.response ?? null;
        recordTerminalActivity('system', 'Troca automática de modo concluída', {
            detail: `${renderSdkRequestLabel(requestId)}${response ? ` · ${response}` : ''}`,
            source: 'sdk',
            recordHistory: false,
        });
        broadcastSse(
            'auto_mode_switch.completed',
            withSdkSessionSseEnvelope({ requestId, response }, 'sdk/auto_mode_switch.completed'),
        );
        refreshPromptIfIdle();
    };

    const onExitPlanModeRequested = (
        /** @type {{ requestId?: string; recommendedAction?: string; actions?: string[]; planContent?: string }} */ evt,
    ) => {
        const requestId = evt?.requestId ?? null;
        const recommendedAction = evt?.recommendedAction ?? null;
        const actions = Array.isArray(evt?.actions) ? evt.actions : [];
        const preview =
            typeof evt?.planContent === 'string' ? compactSummaryText(evt.planContent.replace(/\s+/gu, ' '), 96) : null;
        recordTerminalActivity('system', 'Saída do plan mode solicitada', {
            detail: `${recommendedAction ?? 'sem recomendação'} · ${actions.length} ação(ões)${preview ? ` · ${preview}` : ''}`,
            source: 'sdk',
            severity: 'warn',
        });
        if (shouldPrintSessionNarration('important')) {
            println(
                `  ${terminalThemeBadge('warn', 'PLAN')} ${terminalThemeText('warn', `Saída do plan mode solicitada${recommendedAction ? ` · recomendar ${recommendedAction}` : ''}`)}`,
            );
            if (actions.length > 0) {
                println(`  ${terminalThemeText('muted', `ações: ${actions.join(', ')}`)}`);
            }
            if (preview) {
                println(`  ${terminalThemeText('muted', preview)}`);
            }
        }
        broadcastSse(
            'exit_plan_mode.requested',
            withSdkSessionSseEnvelope(
                {
                    requestId,
                    recommendedAction,
                    actions,
                    planPreview: preview,
                },
                'sdk/exit_plan_mode.requested',
            ),
        );
        refreshPromptIfIdle();
    };

    const onExitPlanModeCompleted = (/** @type {{ requestId?: string }} */ evt) => {
        const requestId = evt?.requestId ?? null;
        recordTerminalActivity('system', 'Saída de plan mode concluída', {
            detail: requestId ? renderSdkRequestLabel(requestId) : 'SDK saiu do plan mode',
            source: 'sdk',
        });
        if (shouldPrintSessionNarration('important')) {
            println(
                `  \x1b[32m✅ SDK concluiu saída do plan mode${requestId ? ` · ${renderSdkRequestLabel(requestId)}` : ''}\x1b[0m`,
            );
        }
        broadcastSse(
            'exit_plan_mode.completed',
            withSdkSessionSseEnvelope({ requestId }, 'sdk/exit_plan_mode.completed'),
        );
        refreshPromptIfIdle();
    };

    const onAssistantReasoningComplete = (/** @type {{ contentLength?: number }} */ evt) => {
        const contentLength = Number(evt?.contentLength ?? 0);
        recordTerminalActivity('thinking', 'Raciocínio concluído', {
            detail: `${contentLength.toLocaleString('pt-BR')} chars`,
            source: 'sdk',
            recordHistory: false,
        });
        broadcastSse(
            'assistant.reasoning_complete',
            withSdkSessionSseEnvelope({ contentLength }, 'sdk/assistant.reasoning_complete'),
        );
    };

    agent.on(EMITTER_ASSISTANT_TURN_START, onAssistantTurnStart);
    agent.on(EMITTER_ASSISTANT_TURN_END, onAssistantTurnEnd);
    agent.on(EMITTER_ASSISTANT_MESSAGE, onAssistantMessage);
    agent.on(EMITTER_SESSION_INFO, onSessionInfo);
    agent.on(EMITTER_SESSION_WARNING, onSessionWarning);
    agent.on(EMITTER_ELICITATION_PENDING, onElicitationPending);
    agent.on(EMITTER_ELICITATION_COMPLETED, onElicitationCompleted);
    agent.on(EMITTER_PERMISSION_REQUESTED, onPermissionRequested);
    agent.on(EMITTER_PERMISSION_COMPLETED, onPermissionCompleted);
    agent.on(EMITTER_PERMISSION_MODE_CHANGED, onPermissionModeChanged);
    agent.on(EMITTER_USER_INPUT_REQUESTED, onUserInputRequested);
    agent.on(EMITTER_USER_INPUT_COMPLETED, onUserInputCompleted);
    agent.on(EMITTER_SESSION_MODEL_CHANGED, onSessionModelChanged);
    agent.on(EMITTER_SESSION_TITLE_CHANGED, onSessionTitleChanged);
    agent.on(EMITTER_SESSION_CONTEXT_CHANGED, onSessionContextChanged);
    agent.on(EMITTER_SESSION_MODE_CHANGED, onSessionModeChanged);
    agent.on(EMITTER_SESSION_PLAN_CHANGED, onSessionPlanChanged);
    agent.on(EMITTER_SESSION_TOOLS_UPDATED, onSessionToolsUpdated);
    agent.on(EMITTER_SESSION_SKILLS_LOADED, onSessionSkillsLoaded);
    agent.on(EMITTER_SESSION_EXTENSIONS_LOADED, onSessionExtensionsLoaded);
    agent.on(EMITTER_SESSION_MCP_SERVERS_LOADED, onSessionMcpServersLoaded);
    agent.on(EMITTER_SESSION_BACKGROUND_TASKS_CHANGED, onSessionBackgroundTasksChanged);
    agent.on(EMITTER_SESSION_TASK_COMPLETE, onSessionTaskComplete);
    agent.on(EMITTER_SESSION_TRUNCATION, onSessionTruncation);
    agent.on(EMITTER_SESSION_SNAPSHOT_REWIND, onSessionSnapshotRewind);
    agent.on(EMITTER_SESSION_SHUTDOWN, onSessionShutdown);
    agent.on(EMITTER_SESSION_HANDOFF, onSessionHandoff);
    agent.on(EMITTER_SESSION_WORKSPACE_FILE_CHANGED, onWorkspaceFileChanged);
    agent.on(EMITTER_TOOL_USER_REQUESTED, onToolUserRequested);
    agent.on(EMITTER_EXTERNAL_TOOL_REQUESTED, onExternalToolRequested);
    agent.on(EMITTER_EXTERNAL_TOOL_COMPLETED, onExternalToolCompleted);
    agent.on(EMITTER_MCP_SERVER_STATUS_CHANGED, onMcpServerStatusChanged);
    agent.on(EMITTER_MCP_OAUTH_REQUIRED, onMcpOauthRequired);
    agent.on(EMITTER_MCP_OAUTH_COMPLETED, onMcpOauthCompleted);
    agent.on(EMITTER_PENDING_MESSAGES_MODIFIED, onPendingMessagesModified);
    agent.on(EMITTER_HOOK_START, onHookStart);
    agent.on(EMITTER_HOOK_END, onHookEnd);
    agent.on(EMITTER_SAMPLING_REQUESTED, onSamplingRequested);
    agent.on(EMITTER_SAMPLING_COMPLETED, onSamplingCompleted);
    agent.on(EMITTER_COMMANDS_CHANGED, onCommandsChanged);
    agent.on(EMITTER_CAPABILITIES_CHANGED, onCapabilitiesChanged);
    agent.on(EMITTER_AUTO_MODE_SWITCH_REQUESTED, onAutoModeSwitchRequested);
    agent.on(EMITTER_AUTO_MODE_SWITCH_COMPLETED, onAutoModeSwitchCompleted);
    agent.on(EMITTER_EXIT_PLAN_MODE_REQUESTED, onExitPlanModeRequested);
    agent.on(EMITTER_EXIT_PLAN_MODE_COMPLETED, onExitPlanModeCompleted);
    agent.on(EMITTER_ASSISTANT_REASONING_COMPLETE, onAssistantReasoningComplete);

    return () => {
        agent.off(EMITTER_ASSISTANT_TURN_START, onAssistantTurnStart);
        agent.off(EMITTER_ASSISTANT_TURN_END, onAssistantTurnEnd);
        agent.off(EMITTER_ASSISTANT_MESSAGE, onAssistantMessage);
        agent.off(EMITTER_SESSION_INFO, onSessionInfo);
        agent.off(EMITTER_SESSION_WARNING, onSessionWarning);
        agent.off(EMITTER_ELICITATION_PENDING, onElicitationPending);
        agent.off(EMITTER_ELICITATION_COMPLETED, onElicitationCompleted);
        agent.off(EMITTER_PERMISSION_REQUESTED, onPermissionRequested);
        agent.off(EMITTER_PERMISSION_COMPLETED, onPermissionCompleted);
        agent.off(EMITTER_PERMISSION_MODE_CHANGED, onPermissionModeChanged);
        agent.off(EMITTER_USER_INPUT_REQUESTED, onUserInputRequested);
        agent.off(EMITTER_USER_INPUT_COMPLETED, onUserInputCompleted);
        agent.off(EMITTER_SESSION_MODEL_CHANGED, onSessionModelChanged);
        agent.off(EMITTER_SESSION_TITLE_CHANGED, onSessionTitleChanged);
        agent.off(EMITTER_SESSION_CONTEXT_CHANGED, onSessionContextChanged);
        agent.off(EMITTER_SESSION_MODE_CHANGED, onSessionModeChanged);
        agent.off(EMITTER_SESSION_PLAN_CHANGED, onSessionPlanChanged);
        agent.off(EMITTER_SESSION_TOOLS_UPDATED, onSessionToolsUpdated);
        agent.off(EMITTER_SESSION_SKILLS_LOADED, onSessionSkillsLoaded);
        agent.off(EMITTER_SESSION_EXTENSIONS_LOADED, onSessionExtensionsLoaded);
        agent.off(EMITTER_SESSION_MCP_SERVERS_LOADED, onSessionMcpServersLoaded);
        agent.off(EMITTER_SESSION_BACKGROUND_TASKS_CHANGED, onSessionBackgroundTasksChanged);
        agent.off(EMITTER_SESSION_TASK_COMPLETE, onSessionTaskComplete);
        agent.off(EMITTER_SESSION_TRUNCATION, onSessionTruncation);
        agent.off(EMITTER_SESSION_SNAPSHOT_REWIND, onSessionSnapshotRewind);
        agent.off(EMITTER_SESSION_SHUTDOWN, onSessionShutdown);
        agent.off(EMITTER_SESSION_HANDOFF, onSessionHandoff);
        agent.off(EMITTER_SESSION_WORKSPACE_FILE_CHANGED, onWorkspaceFileChanged);
        agent.off(EMITTER_TOOL_USER_REQUESTED, onToolUserRequested);
        agent.off(EMITTER_EXTERNAL_TOOL_REQUESTED, onExternalToolRequested);
        agent.off(EMITTER_EXTERNAL_TOOL_COMPLETED, onExternalToolCompleted);
        agent.off(EMITTER_MCP_SERVER_STATUS_CHANGED, onMcpServerStatusChanged);
        agent.off(EMITTER_MCP_OAUTH_REQUIRED, onMcpOauthRequired);
        agent.off(EMITTER_MCP_OAUTH_COMPLETED, onMcpOauthCompleted);
        agent.off(EMITTER_PENDING_MESSAGES_MODIFIED, onPendingMessagesModified);
        agent.off(EMITTER_HOOK_START, onHookStart);
        agent.off(EMITTER_HOOK_END, onHookEnd);
        agent.off(EMITTER_SAMPLING_REQUESTED, onSamplingRequested);
        agent.off(EMITTER_SAMPLING_COMPLETED, onSamplingCompleted);
        agent.off(EMITTER_COMMANDS_CHANGED, onCommandsChanged);
        agent.off(EMITTER_CAPABILITIES_CHANGED, onCapabilitiesChanged);
        agent.off(EMITTER_AUTO_MODE_SWITCH_REQUESTED, onAutoModeSwitchRequested);
        agent.off(EMITTER_AUTO_MODE_SWITCH_COMPLETED, onAutoModeSwitchCompleted);
        agent.off(EMITTER_EXIT_PLAN_MODE_REQUESTED, onExitPlanModeRequested);
        agent.off(EMITTER_EXIT_PLAN_MODE_COMPLETED, onExitPlanModeCompleted);
        agent.off(EMITTER_ASSISTANT_REASONING_COMPLETE, onAssistantReasoningComplete);
    };
}
