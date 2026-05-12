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
    EMITTER_ASSISTANT_REASONING_COMPLETE,
    EMITTER_ASSISTANT_TURN_END,
    EMITTER_ASSISTANT_TURN_START,
    EMITTER_ELICITATION_COMPLETED,
    EMITTER_ELICITATION_PENDING,
    EMITTER_EXIT_PLAN_MODE_COMPLETED,
    EMITTER_EXTERNAL_TOOL_COMPLETED,
    EMITTER_EXTERNAL_TOOL_REQUESTED,
    EMITTER_MCP_OAUTH_COMPLETED,
    EMITTER_MCP_OAUTH_REQUIRED,
    EMITTER_MCP_SERVER_STATUS_CHANGED,
    EMITTER_PENDING_MESSAGES_MODIFIED,
    EMITTER_PERMISSION_COMPLETED,
    EMITTER_PERMISSION_MODE_CHANGED,
    EMITTER_PERMISSION_REQUESTED,
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
import { DialogProtocol } from '../../dialog/protocol.js';
import {
    consumeRuntimeInterventionMailbox,
    enqueueRuntimeInterventionMailbox,
    getShowSessionActivity,
    readRuntimeInterventionMailboxSummary,
    setLastSdkPlanOperation,
    setSdkSessionMode,
} from '../../presentation/runtime-ui-state-store.js';
import { classifyPermissionDecision } from '../../sdk/session/permission-events.js';
import { broadcastSse, println } from '../dialog/index.js';
import { answerTerminalPendingQuestion } from '../frontend/gateways/agent-runtime.js';
import { drainMailboxToTurnIfIdle } from '../mailbox-drain.js';
import { recordTerminalActivity } from '../state/activity-state.js';
import {
    recordTerminalElicitationCompleted,
    recordTerminalElicitationPending,
    recordTerminalPermissionCompleted,
    recordTerminalPermissionModeChanged,
    recordTerminalPermissionRequested,
    recordTerminalUserInputCompleted,
    recordTerminalUserInputRequested,
} from '../state/sdk-interactions.js';
import { createToolCallRegistry } from '../state/tool-call-registry.js';
import {
    beginTerminalTurnTrace,
    completeTerminalTurnTrace,
    recordTerminalTurnFileActivity,
} from '../state/turn-trace-state.js';
import { getTerminalDetailLevel } from '../state/ui-preferences.js';
import { terminalThemeBadge, terminalThemeText } from '../state/ui-theme.js';
import {
    handleTerminalExternalToolCompleted,
    handleTerminalExternalToolRequested,
    handleTerminalToolUserRequested,
} from './tool-lifecycle-runtime.js';

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
 * @param {import('../state/turn-trace-state.js').TerminalTurnTraceSnapshot | null} trace
 * @returns {void}
 */
function renderTurnTraceSummary(trace) {
    if (!trace || (trace.tools.length === 0 && trace.files.length === 0)) {
        return;
    }
    const compactDetail = getTerminalDetailLevel() === 'compact';
    const toolItems = trace.tools.slice(0, compactDetail ? 2 : 3).map((tool) => {
        const target = tool.path ?? tool.target ?? tool.toolName;
        const label = compactDetail
            ? `${tool.operation.toUpperCase()} ${compactSummaryText(target ?? tool.toolName, 28)}`
            : `${tool.operation.toUpperCase()} ${tool.toolName} · ${compactSummaryText(target ?? tool.toolName, 46)}`;
        return terminalThemeText('tool', label);
    });
    const fileItems = trace.files.slice(0, compactDetail ? 2 : 3).map((file) => {
        const label = compactDetail
            ? compactSummaryText(file.path, 24)
            : `${file.operation.toUpperCase()} ${compactSummaryText(file.path, 42)}`;
        return terminalThemeText('info', label);
    });
    const headline = [
        trace.tools.length > 0 ? `${trace.tools.length} tool(s)` : null,
        trace.files.length > 0 ? `${trace.files.length} arquivo(s)` : null,
    ]
        .filter(Boolean)
        .join(' · ');

    println(`  ${terminalThemeBadge('info', 'TURN')} ${terminalThemeText('muted', headline)}`);
    if (toolItems.length > 0) {
        println(
            `   ${terminalThemeBadge('tool', compactDetail ? 'OPS' : 'TOOLS')} ${toolItems.join(terminalThemeText('muted', '  ·  '))}`,
        );
    }
    if (fileItems.length > 0) {
        println(
            `   ${terminalThemeBadge('fileRead', compactDetail ? 'FILES' : 'FILES')} ${fileItems.join(terminalThemeText('muted', '  ·  '))}`,
        );
    }
}

/**
 * @param {{
 *     agent: AgentEventHost;
 *     refreshPromptIfIdle: () => void;
 *     registry?: ReturnType<import('../state/tool-call-registry.js').createToolCallRegistry> | null;
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
     * @param {'critical' | 'important' | 'verbose'} level
     * @returns {boolean}
     */
    function shouldPrintSessionNarration(level) {
        if (level === 'critical' || level === 'important') {
            return true;
        }
        return getShowSessionActivity();
    }

    const onAssistantTurnStart = (/** @type {{ turnId?: string | null }} */ evt) => {
        const turnId = evt?.turnId ?? null;
        beginTerminalTurnTrace({ turnId });
        broadcastSse('assistant.turn_start', {
            turnId,
            timestamp: Date.now(),
        });
    };

    const onAssistantTurnEnd = (/** @type {{ turnId?: string | null }} */ evt) => {
        const turnId = evt?.turnId ?? null;
        const trace = completeTerminalTurnTrace({ turnId });
        recordTerminalActivity('turn', 'Turno do assistente concluído', {
            detail: turnId ? `turnId=${turnId}` : 'resposta concluída',
            source: 'sdk',
            recordHistory: false,
        });
        renderTurnTraceSummary(trace);
        broadcastSse('assistant.turn_end', {
            turnId,
            timestamp: Date.now(),
        });
        // Drenar entradas stranded do mailbox zero-PR: se o modelo completou sem chamar ask_user,
        // as entradas não serão consumidas automaticamente. Usar setImmediate para aguardar
        // setBusy(false) do engine.js antes de verificar o estado de ociosidade.
        setImmediate(() => {
            drainMailboxToTurnIfIdle('turn_end');
        });
        refreshPromptIfIdle();
    };

    const onSessionInfo = (/** @type {{ infoType?: string; message?: string; url?: string }} */ evt) => {
        const infoType = evt?.infoType ?? 'info';
        const message = evt?.message ?? '(sem mensagem)';
        recordTerminalActivity('system', `Info SDK · ${infoType}`, {
            detail: message,
            source: 'sdk',
            recordHistory: false,
        });
        if (shouldPrintSessionNarration('verbose')) {
            println(`  \x1b[90mℹ️  [${infoType}] ${message}\x1b[0m`);
            if (evt?.url) println(`  \x1b[90m    ${evt.url}\x1b[0m`);
        }
        broadcastSse('session.info', { infoType, message, url: evt?.url, timestamp: Date.now() });
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
        broadcastSse('elicitation.pending', { ...entry, timestamp: Date.now() });
        refreshPromptIfIdle();
    };

    const onElicitationCompleted = (/** @type {Record<string, unknown>} */ evt) => {
        const entry = recordTerminalElicitationCompleted(evt);
        const data = eventObject(evt);
        const requestId = stringOr(data['requestId'], entry?.id ?? 'unknown');
        recordTerminalActivity('question', 'Elicitation SDK concluída', {
            detail: requestId,
            source: 'sdk',
            recordHistory: Boolean(entry),
        });
        if (entry) {
            println(`  \x1b[32m✓ Elicitation concluída:\x1b[0m \x1b[90m${entry.id}\x1b[0m`);
        }
        broadcastSse('elicitation.completed', { ...data, timestamp: Date.now() });
        refreshPromptIfIdle();
    };

    const onPermissionRequested = (/** @type {Record<string, unknown>} */ evt) => {
        const entry = recordTerminalPermissionRequested(evt);
        recordTerminalActivity('question', 'Permissão SDK solicitada', {
            detail: `${entry.permissionType}${entry.requestId ? ` · ${entry.requestId}` : ''}`,
            source: 'sdk',
            severity: 'warn',
        });
        println(
            `\n  \x1b[33m🔐 Permissão solicitada:\x1b[0m ${entry.permissionType}${entry.requestId ? ` \x1b[90m(${entry.requestId})\x1b[0m` : ''}`,
        );
        println('  \x1b[90mAcompanhe a decisão com /status ou /activity; o SDK/hook decidirá o resultado.\x1b[0m');
        broadcastSse('permission.requested', { ...entry, timestamp: Date.now() });
        refreshPromptIfIdle();
    };

    const onPermissionCompleted = (/** @type {Record<string, unknown>} */ evt) => {
        const entry = recordTerminalPermissionCompleted(evt);
        const data = eventObject(evt);
        const granted = data['granted'] ?? data['approved'] ?? entry?.granted;
        const decision = classifyPermissionDecision(
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

        recordTerminalActivity('system', label, {
            detail: entry
                ? `${entry.permissionType}${entry.result ? ` · ${entry.result}` : ''} ${wasDeniedByPolicy ? '[autoaprovado por política]' : ''}`.trim()
                : 'sem request local',
            source: 'sdk',
            severity: ok || granted == null ? 'info' : 'warn',
        });

        const resultLabel = granted == null ? '' : granted ? '\x1b[32maprovada\x1b[0m' : '\x1b[31mnão aprovada\x1b[0m';
        const policyIndicator = wasDeniedByPolicy ? ' \x1b[90m(política)\x1b[0m' : '';
        println(
            `  ${ok ? '\x1b[32m✓' : '\x1b[33m•'} Permissão:\x1b[0m ${entry?.permissionType ?? 'unknown'} ${resultLabel}${policyIndicator}`,
        );
        broadcastSse('permission.completed', { ...data, timestamp: Date.now(), decision, wasDeniedByPolicy });
        refreshPromptIfIdle();
    };

    const onPermissionModeChanged = (/** @type {{ mode?: string }} */ evt) => {
        const mode = typeof evt?.mode === 'string' ? evt.mode : 'approve_all';
        recordTerminalPermissionModeChanged({ mode, ts: Date.now() });
        recordTerminalActivity('system', 'Modo de permissão alterado', {
            detail: mode,
            source: 'sdk',
            severity: 'warn',
        });
        if (shouldPrintSessionNarration('important')) {
            println(
                `  ${terminalThemeBadge('warn', 'PERM')} ${terminalThemeText('warn', `permission.mode_changed → ${mode}`)}`,
            );
        }
        broadcastSse('permission.mode_changed', { mode, timestamp: Date.now() });
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
        if (requestId && kind !== 'question') {
            pruneSuppressedProtocolRequestIds();
            suppressedProtocolRequestIds.set(requestId, Date.now());
        }
        if (kind !== 'question') {
            refreshPromptIfIdle();
            return;
        }
        recordTerminalActivity('question', 'ask_user SDK solicitado', {
            detail: `${question.slice(0, 160)}${choices.length > 0 ? ` · choices=${choices.join('|')}` : ''}`,
            source: 'sdk',
            severity: allowFreeform ? 'info' : 'warn',
        });
        broadcastSse('user_input.requested', {
            requestId: evt?.requestId ?? null,
            question,
            choices,
            allowFreeform,
            toolCallId: evt?.toolCallId ?? null,
            timestamp: Date.now(),
        });
        if (shouldPrintSessionNarration('important')) {
            const optionsLabel = choices.length > 0 ? ` · opções=${choices.length}` : '';
            println(
                `  ${terminalThemeBadge('question', 'ASK')} ${terminalThemeText('question', tracked.question.slice(0, 120))}${terminalThemeText('muted', optionsLabel)}`,
            );
        }

        const runtimeId = typeof evt?.runtimeId === 'string' && evt.runtimeId.trim().length > 0 ? evt.runtimeId : null;
        const mailboxEntry = consumeRuntimeInterventionMailbox(runtimeId);
        if (mailboxEntry) {
            const answered = answerTerminalPendingQuestion(mailboxEntry.message, runtimeId);
            if (answered) {
                const mailboxSummary = readRuntimeInterventionMailboxSummary(runtimeId);
                recordTerminalActivity('question', 'Mailbox zero-PR aplicado em ask_user', {
                    detail: `${mailboxEntry.source}/${mailboxEntry.modeHint}${mailboxEntry.mergedCount > 0 ? ` · merges=${mailboxEntry.mergedCount}` : ''}`,
                    source: 'sdk',
                    severity: 'info',
                    recordHistory: false,
                });
                println(
                    `  ${terminalThemeBadge('info', 'MAILBOX')} ${terminalThemeText('info', `intervenção aplicada automaticamente (${mailboxEntry.source}/${mailboxEntry.modeHint})`)}${terminalThemeText('muted', ` · fila restante=${mailboxSummary.queueSize}`)}`,
                );
                broadcastSse('intervention.mailbox.applied', {
                    runtimeId,
                    entryId: mailboxEntry.id,
                    source: mailboxEntry.source,
                    modeHint: mailboxEntry.modeHint,
                    mergedCount: mailboxEntry.mergedCount,
                    queueSize: mailboxSummary.queueSize,
                    dropped: mailboxSummary.dropped,
                    timestamp: Date.now(),
                });
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
        recordTerminalUserInputCompleted(evt);
        recordTerminalActivity('question', 'ask_user SDK respondido', {
            detail: `${requestId ?? 'sem requestId'}${wasFreeform ? ' · freeform' : ' · choice/protocolo'}`,
            source: 'sdk',
            recordHistory: false,
        });
        broadcastSse('user_input.completed', {
            requestId,
            answer: evt?.answer ?? '',
            wasFreeform,
            timestamp: Date.now(),
        });
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
        broadcastSse('session.warning', { warningType, message, url: evt?.url, timestamp: Date.now() });
    };

    const onSessionModelChanged = (
        /** @type {{ previousModel?: string; newModel?: string; reasoningEffort?: string }} */ evt,
    ) => {
        const previousModel = evt?.previousModel ?? 'unknown';
        const newModel = evt?.newModel ?? 'unknown';
        const reasoningEffort = evt?.reasoningEffort ?? null;
        recordTerminalActivity('system', 'Modelo SDK alterado', {
            detail: `${previousModel} → ${newModel}${reasoningEffort ? ` · ${reasoningEffort}` : ''}`,
            source: 'sdk',
        });
        if (shouldPrintSessionNarration('verbose')) {
            println(
                `  \x1b[36m🧠 Modelo SDK: ${previousModel} → ${newModel}${reasoningEffort ? ` · ${reasoningEffort}` : ''}\x1b[0m`,
            );
        }
        broadcastSse('session.model_changed', {
            previousModel,
            newModel,
            reasoningEffort,
            timestamp: Date.now(),
        });
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
        broadcastSse('session.title_changed', {
            title,
            timestamp: Date.now(),
        });
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
        broadcastSse('session.context_changed', {
            cwd: evt?.cwd,
            branch: evt?.branch,
            repository: evt?.repository,
            timestamp: Date.now(),
        });
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
        broadcastSse('session.mode_changed', {
            previousMode,
            newMode,
            timestamp: Date.now(),
        });
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
        broadcastSse('session.plan_changed', { operation, timestamp: Date.now() });
        refreshPromptIfIdle();
    };

    const onSessionToolsUpdated = (/** @type {{ count?: number }} */ evt) => {
        const count = Number(evt?.count ?? 0);
        recordTerminalActivity('system', 'Tools dinâmicas SDK atualizadas', {
            detail: `${count} tool(s) reportada(s) pelo evento SDK; registry local segue em /tools`,
            source: 'sdk',
            recordHistory: false,
        });
        if (shouldPrintSessionNarration('verbose')) {
            println(`  \x1b[90m🧰 Tools dinâmicas SDK atualizadas: ${count} (registry local: /tools)\x1b[0m`);
        }
        broadcastSse('session.tools_updated', { count, timestamp: Date.now() });
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
        broadcastSse('session.skills_loaded', { count, enabled, timestamp: Date.now() });
    };

    const onSessionExtensionsLoaded = (/** @type {{ count?: number }} */ evt) => {
        const count = Number(evt?.count ?? 0);
        recordTerminalActivity('system', 'Extensões SDK carregadas', {
            detail: `${count} extensão(ões)`,
            source: 'sdk',
            recordHistory: false,
        });
        broadcastSse('session.extensions_loaded', { count, timestamp: Date.now() });
    };

    const onSessionMcpServersLoaded = (/** @type {{ count?: number }} */ evt) => {
        const count = Number(evt?.count ?? 0);
        recordTerminalActivity('system', 'MCP servers carregados', {
            detail: `${count} server(s)`,
            source: 'sdk',
            recordHistory: false,
        });
        if (shouldPrintSessionNarration('verbose')) println(`  \x1b[90mMCP servers carregados: ${count}\x1b[0m`);
        broadcastSse('session.mcp_servers_loaded', { count, timestamp: Date.now() });
    };

    const onSessionBackgroundTasksChanged = (/** @type {{ count?: number }} */ evt) => {
        const count = Number(evt?.count ?? 0);
        recordTerminalActivity('system', 'Background tasks SDK alteradas', {
            detail: `${count} pendente(s)`,
            source: 'sdk',
            severity: count > 0 ? 'warn' : 'info',
            recordHistory: count > 0,
        });
        broadcastSse('session.background_tasks_changed', { count, timestamp: Date.now() });
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
        broadcastSse('session.task_complete', {
            summary: summary || null,
            timestamp: Date.now(),
        });
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
        broadcastSse('session.truncation', {
            messageTruncatedCount,
            tokensTruncated,
            reason,
            timestamp: Date.now(),
        });
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
        broadcastSse('session.snapshot_rewind', {
            snapshotId,
            reason,
            timestamp: Date.now(),
        });
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
        broadcastSse('session.shutdown', {
            shutdownType,
            reason,
            timestamp: Date.now(),
        });
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
        broadcastSse('session.handoff', {
            fromAgent,
            toAgent,
            reason,
            context: evt?.context,
            timestamp: Date.now(),
        });
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
        broadcastSse('session.workspace_file_changed', {
            path,
            operation,
            timestamp: Date.now(),
        });
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
        broadcastSse('mcp.server.status_changed', { serverName, status, timestamp: Date.now() });
    };

    const onMcpOauthRequired = (/** @type {{ serverName?: string; requestId?: string }} */ evt) => {
        const serverName = evt?.serverName ?? 'unknown';
        const requestId = evt?.requestId ?? null;
        recordTerminalActivity('question', 'OAuth MCP necessário', {
            detail: `${serverName}${requestId ? ` · ${requestId}` : ''}`,
            source: 'sdk',
            severity: 'warn',
        });
        println(
            `\n  \x1b[33m🔑 OAuth MCP necessário:\x1b[0m ${serverName}${requestId ? ` \x1b[90m(${requestId})\x1b[0m` : ''}`,
        );
        broadcastSse('mcp.oauth.required', { serverName, requestId, timestamp: Date.now() });
        refreshPromptIfIdle();
    };

    const onMcpOauthCompleted = (/** @type {{ requestId?: string }} */ evt) => {
        const requestId = evt?.requestId ?? null;
        recordTerminalActivity('system', 'OAuth MCP concluído', {
            detail: requestId ? `requestId=${requestId}` : 'sem requestId',
            source: 'sdk',
        });
        if (shouldPrintSessionNarration('important')) {
            println(`  \x1b[32m✓ OAuth MCP concluído${requestId ? ` (${requestId})` : ''}\x1b[0m`);
        }
        broadcastSse('mcp.oauth.completed', { requestId, timestamp: Date.now() });
        refreshPromptIfIdle();
    };

    const onPendingMessagesModified = (/** @type {{ count?: number }} */ evt) => {
        const count = Number(evt?.count ?? 0);
        recordTerminalActivity('turn', 'Pending messages alteradas', {
            detail: `${count} mensagem(ns) pendente(s)`,
            source: 'sdk',
            recordHistory: false,
        });
        broadcastSse('pending_messages.modified', { count, timestamp: Date.now() });
    };

    const onExitPlanModeCompleted = (/** @type {{ requestId?: string }} */ evt) => {
        recordTerminalActivity('system', 'Saída de plan mode concluída', {
            detail: evt?.requestId ? `requestId=${evt.requestId}` : 'SDK saiu do plan mode',
            source: 'sdk',
        });
        if (shouldPrintSessionNarration('important')) {
            println(
                `  \x1b[32m✅ SDK concluiu saída do plan mode${evt?.requestId ? ` (${evt.requestId})` : ''}\x1b[0m`,
            );
        }
        broadcastSse('exit_plan_mode.completed', {
            requestId: evt?.requestId,
            timestamp: Date.now(),
        });
        refreshPromptIfIdle();
    };

    const onAssistantReasoningComplete = (/** @type {{ contentLength?: number }} */ evt) => {
        const contentLength = Number(evt?.contentLength ?? 0);
        recordTerminalActivity('thinking', 'Raciocínio concluído', {
            detail: `${contentLength.toLocaleString('pt-BR')} chars`,
            source: 'sdk',
            recordHistory: false,
        });
        broadcastSse('assistant.reasoning_complete', {
            contentLength,
            timestamp: Date.now(),
        });
    };

    agent.on(EMITTER_ASSISTANT_TURN_START, onAssistantTurnStart);
    agent.on(EMITTER_ASSISTANT_TURN_END, onAssistantTurnEnd);
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
    agent.on(EMITTER_EXIT_PLAN_MODE_COMPLETED, onExitPlanModeCompleted);
    agent.on(EMITTER_ASSISTANT_REASONING_COMPLETE, onAssistantReasoningComplete);

    return () => {
        agent.off(EMITTER_ASSISTANT_TURN_START, onAssistantTurnStart);
        agent.off(EMITTER_ASSISTANT_TURN_END, onAssistantTurnEnd);
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
        agent.off(EMITTER_EXIT_PLAN_MODE_COMPLETED, onExitPlanModeCompleted);
        agent.off(EMITTER_ASSISTANT_REASONING_COMPLETE, onAssistantReasoningComplete);
    };
}
