// @ts-check
/**
 * src/copilot/terminal/sdk-session-events.js
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
    EMITTER_EXIT_PLAN_MODE_COMPLETED,
    EMITTER_SESSION_CONTEXT_CHANGED,
    EMITTER_SESSION_HANDOFF,
    EMITTER_SESSION_INFO,
    EMITTER_SESSION_MODE_CHANGED,
    EMITTER_SESSION_MODEL_CHANGED,
    EMITTER_SESSION_PLAN_CHANGED,
    EMITTER_SESSION_SHUTDOWN,
    EMITTER_SESSION_SNAPSHOT_REWIND,
    EMITTER_SESSION_TASK_COMPLETE,
    EMITTER_SESSION_TITLE_CHANGED,
    EMITTER_SESSION_TRUNCATION,
    EMITTER_SESSION_WARNING,
    EMITTER_SESSION_WORKSPACE_FILE_CHANGED,
} from '#copilot/events';
import { setLastSdkPlanOperation, setSdkSessionMode } from '../presentation/runtime-ui-state-store.js';
import { recordTerminalActivity } from './activity-state.js';
import { broadcastSse, println } from './dialog/index.js';

/**
 * @typedef {{
 *     on: (event: string, handler: (...args: any[]) => void) => void;
 *     off: (event: string, handler: (...args: any[]) => void) => void;
 * }} AgentEventHost
 */

/**
 * @param {{
 *     agent: AgentEventHost;
 *     refreshPromptIfIdle: () => void;
 * }} input
 * @returns {() => void}
 */
export function setupTerminalSdkSessionEventListeners({ agent, refreshPromptIfIdle }) {
    const onAssistantTurnStart = (/** @type {{ turnId?: string | null }} */ evt) => {
        const turnId = evt?.turnId ?? null;
        recordTerminalActivity('turn', 'Turno do assistente iniciado', {
            detail: turnId ? `turnId=${turnId}` : 'processando resposta',
            source: 'sdk',
            recordHistory: false,
        });
        broadcastSse('assistant.turn_start', {
            turnId,
            timestamp: Date.now(),
        });
    };

    const onAssistantTurnEnd = (/** @type {{ turnId?: string | null }} */ evt) => {
        const turnId = evt?.turnId ?? null;
        recordTerminalActivity('turn', 'Turno do assistente concluído', {
            detail: turnId ? `turnId=${turnId}` : 'resposta concluída',
            source: 'sdk',
            recordHistory: false,
        });
        broadcastSse('assistant.turn_end', {
            turnId,
            timestamp: Date.now(),
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
        println(`  \x1b[90mℹ️  [${infoType}] ${message}\x1b[0m`);
        if (evt?.url) println(`  \x1b[90m    ${evt.url}\x1b[0m`);
        broadcastSse('session.info', { infoType, message, url: evt?.url, timestamp: Date.now() });
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
        println(
            `  \x1b[36m🧠 Modelo SDK: ${previousModel} → ${newModel}${reasoningEffort ? ` · ${reasoningEffort}` : ''}\x1b[0m`,
        );
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
        println(`  \x1b[90m🪪 Título da sessão: ${title}\x1b[0m`);
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
        println(`  \x1b[35m🧭 Modo SDK: ${previousMode} → ${newMode ?? 'unknown'}\x1b[0m`);
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
        println(`  \x1b[33m📝 Plan SDK: ${operation ?? 'alterado'}\x1b[0m`);
        broadcastSse('session.plan_changed', { operation, timestamp: Date.now() });
        refreshPromptIfIdle();
    };

    const onSessionTaskComplete = (/** @type {{ summary?: string | null }} */ evt) => {
        const summary = typeof evt?.summary === 'string' ? evt.summary.trim() : '';
        recordTerminalActivity('task', 'Sessão marcou tarefa como concluída', {
            detail: summary || 'SDK sinalizou task_complete',
            source: 'sdk',
        });
        println(`  \x1b[32m🏁 Task concluída${summary ? `: ${summary}` : ''}\x1b[0m`);
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
        println(`  \x1b[36m🔁 Handoff SDK: ${fromAgent} → ${toAgent}${reason ? ` · ${reason}` : ''}\x1b[0m`);
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
        recordTerminalActivity('system', 'Workspace da sessão alterado', {
            detail: `${operation} · ${path}`,
            source: 'sdk',
            recordHistory: false,
        });
        println(`  \x1b[90m🗂️  Workspace file ${operation}: ${path}\x1b[0m`);
        broadcastSse('session.workspace_file_changed', {
            path,
            operation,
            timestamp: Date.now(),
        });
    };

    const onExitPlanModeCompleted = (/** @type {{ requestId?: string }} */ evt) => {
        recordTerminalActivity('system', 'Saída de plan mode concluída', {
            detail: evt?.requestId ? `requestId=${evt.requestId}` : 'SDK saiu do plan mode',
            source: 'sdk',
        });
        println(`  \x1b[32m✅ SDK concluiu saída do plan mode${evt?.requestId ? ` (${evt.requestId})` : ''}\x1b[0m`);
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
    agent.on(EMITTER_SESSION_MODEL_CHANGED, onSessionModelChanged);
    agent.on(EMITTER_SESSION_TITLE_CHANGED, onSessionTitleChanged);
    agent.on(EMITTER_SESSION_CONTEXT_CHANGED, onSessionContextChanged);
    agent.on(EMITTER_SESSION_MODE_CHANGED, onSessionModeChanged);
    agent.on(EMITTER_SESSION_PLAN_CHANGED, onSessionPlanChanged);
    agent.on(EMITTER_SESSION_TASK_COMPLETE, onSessionTaskComplete);
    agent.on(EMITTER_SESSION_TRUNCATION, onSessionTruncation);
    agent.on(EMITTER_SESSION_SNAPSHOT_REWIND, onSessionSnapshotRewind);
    agent.on(EMITTER_SESSION_SHUTDOWN, onSessionShutdown);
    agent.on(EMITTER_SESSION_HANDOFF, onSessionHandoff);
    agent.on(EMITTER_SESSION_WORKSPACE_FILE_CHANGED, onWorkspaceFileChanged);
    agent.on(EMITTER_EXIT_PLAN_MODE_COMPLETED, onExitPlanModeCompleted);
    agent.on(EMITTER_ASSISTANT_REASONING_COMPLETE, onAssistantReasoningComplete);

    return () => {
        agent.off(EMITTER_ASSISTANT_TURN_START, onAssistantTurnStart);
        agent.off(EMITTER_ASSISTANT_TURN_END, onAssistantTurnEnd);
        agent.off(EMITTER_SESSION_INFO, onSessionInfo);
        agent.off(EMITTER_SESSION_WARNING, onSessionWarning);
        agent.off(EMITTER_SESSION_MODEL_CHANGED, onSessionModelChanged);
        agent.off(EMITTER_SESSION_TITLE_CHANGED, onSessionTitleChanged);
        agent.off(EMITTER_SESSION_CONTEXT_CHANGED, onSessionContextChanged);
        agent.off(EMITTER_SESSION_MODE_CHANGED, onSessionModeChanged);
        agent.off(EMITTER_SESSION_PLAN_CHANGED, onSessionPlanChanged);
        agent.off(EMITTER_SESSION_TASK_COMPLETE, onSessionTaskComplete);
        agent.off(EMITTER_SESSION_TRUNCATION, onSessionTruncation);
        agent.off(EMITTER_SESSION_SNAPSHOT_REWIND, onSessionSnapshotRewind);
        agent.off(EMITTER_SESSION_SHUTDOWN, onSessionShutdown);
        agent.off(EMITTER_SESSION_HANDOFF, onSessionHandoff);
        agent.off(EMITTER_SESSION_WORKSPACE_FILE_CHANGED, onWorkspaceFileChanged);
        agent.off(EMITTER_EXIT_PLAN_MODE_COMPLETED, onExitPlanModeCompleted);
        agent.off(EMITTER_ASSISTANT_REASONING_COMPLETE, onAssistantReasoningComplete);
    };
}
