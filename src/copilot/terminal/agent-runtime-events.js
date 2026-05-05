// @ts-check
/**
 * src/copilot/terminal/agent-runtime-events.js
 *
 * Tradução dos sinais já normalizados do runtime/agent para a UX local do terminal.
 *
 * Aqui entram eventos que NÃO são payload vanilla direto do SDK, mas sim sinais já estabilizados pelo runtime local,
 * como `question.pending`, tool lifecycle normalizado, compaction e subagentes.
 *
 * @module copilot/terminal/agent-runtime-events
 */

import {
    EMITTER_ASSISTANT_INTENT,
    EMITTER_QUESTION_PENDING,
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
    getShowIntentActivity,
    getShowStreaming,
    getShowToolActivity,
} from '../presentation/runtime-ui-state-store.js';
import { recordTerminalActivity } from './activity-state.js';
import { broadcastSse, buildUserPrompt, println, writeInlineStatus } from './dialog/index.js';
import { readTerminalRuntimeState } from './frontend/gateways/agent-runtime.js';
import { createTerminalPendingQuestionReplayState } from './pending-question-replay.js';
import { buildTerminalToolActivityPresentation, compactTerminalToolText } from './tool-activity-presenter.js';
import { completeTerminalTurnToolCall, recordTerminalTurnToolActivity } from './turn-trace-state.js';
import { terminalActionChip, terminalThemeBadge, terminalThemeText } from './ui-theme.js';

/**
 * @typedef {{
 *     on: (event: string, handler: (...args: any[]) => void) => void;
 *     off: (event: string, handler: (...args: any[]) => void) => void;
 * }} AgentEventHost
 */

/**
 * @param {{
 *     agent: AgentEventHost;
 *     rl?: import('readline').Interface | null;
 * }} input
 * @returns {() => void}
 */
export function setupTerminalAgentRuntimeEventListeners({ agent, rl = null }) {
    /**
     * @type {Map<
     *     string,
     *     {
     *         name: string;
     *         t0: number;
     *         presentation: import('./tool-activity-presenter.js').TerminalToolActivityPresentation;
     *         lastProgress?: number | null;
     *         lastProgressMessage?: string | null;
     *     }
     * >}
     */
    const activeTools = new Map();
    const pendingQuestionReplay = createTerminalPendingQuestionReplayState();

    /**
     * @param {string} toolName
     * @returns {boolean}
     */
    function shouldSuppressToolNarration(toolName) {
        return toolName === 'ask_user';
    }

    /**
     * @param {import('./tool-activity-presenter.js').TerminalToolOperation} operation
     * @returns {'fileRead' | 'fileWrite' | 'fileEdit' | 'fileDelete' | 'tool'}
     */
    function mapOperationRole(operation) {
        if (operation === 'read') return 'fileRead';
        if (operation === 'write') return 'fileWrite';
        if (operation === 'edit') return 'fileEdit';
        if (operation === 'delete') return 'fileDelete';
        return 'tool';
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

        recordTerminalActivity(
            'question',
            source === 'replay' ? 'Pergunta pendente restaurada' : 'LLM-B solicitou input',
            {
                detail: question.slice(0, 160),
                source: 'agent',
            },
        );

        rl?.pause();
        println(
            `\n${terminalThemeBadge('question', 'QUESTION')} ${terminalThemeText('question', `LLM-B perguntou: "${question}"`)}`,
        );
        if (choices.length > 0) {
            println(`   ${terminalThemeBadge('info', 'OPTIONS')} ${choices.join(' | ')}`);
            const maxInlineChoices = 6;
            const visibleChoices = choices.slice(0, maxInlineChoices);
            const indexed = visibleChoices.map((choice, idx) => `[${idx + 1}] ${choice}`).join('   ');
            const overflow = choices.length > maxInlineChoices ? `   … +${choices.length - maxInlineChoices}` : '';
            println(`   ${terminalThemeBadge('info', 'SELECT')} ${indexed}${overflow}`);
        }
        if (rl) {
            println(
                `   ${terminalThemeText('muted', '→ Responda digitando normalmente. Sua próxima mensagem será usada como resposta.')}`,
            );
            println(
                `   ${terminalThemeText('muted', '→ Ações rápidas:')} ${terminalActionChip('/status')} ${terminalActionChip('/answer <texto>')} ${terminalActionChip('/clear-shadow')}`,
            );
        } else {
            println(
                `   ${terminalThemeText('muted', '→ Modo headless: responda via POST /inject ou pelo cliente conectado.')}`,
            );
        }
        rl?.resume();
        if (rl) {
            rl.setPrompt(buildUserPrompt());
            rl.prompt();
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
        println('[llm-b] ⚠️  Agente parado. Use /restart para reiniciar.');
        if (rl) {
            rl.setPrompt(buildUserPrompt());
            rl.prompt();
        }
    };

    const onToolStart = (/** @type {Record<string, unknown>} */ evt) => {
        const toolCallId = /** @type {string} */ (evt?.['toolCallId'] ?? '');
        const name = /** @type {string} */ (evt?.['toolName'] ?? evt?.['name'] ?? 'tool');
        if (shouldSuppressToolNarration(name)) {
            return;
        }
        const presentation = buildTerminalToolActivityPresentation(evt, name);
        activeTools.set(toolCallId, {
            name,
            t0: Date.now(),
            presentation,
            lastProgress: null,
            lastProgressMessage: null,
        });
        recordTerminalTurnToolActivity({
            toolName: name,
            operation: presentation.operation,
            path: presentation.path,
            target: presentation.target,
            source: 'sdk',
            status: 'started',
            toolCallId,
        });
        recordTerminalActivity('tool', 'Executando tool', {
            detail: presentation.detail,
            toolName: name,
            source: 'sdk',
        });
        if (getShowToolActivity()) {
            const operationRole = mapOperationRole(presentation.operation);
            const opLabel = presentation.operation.toUpperCase();
            println(
                `  ${terminalThemeBadge('tool', 'TOOL')} ${terminalThemeBadge(operationRole, opLabel)} ${terminalThemeText('tool', name)} ${terminalThemeText('muted', '·')} ${terminalThemeText(operationRole, presentation.startLine)}`,
            );
        }
        broadcastSse('tool.start', {
            toolCallId,
            toolName: name,
            operation: presentation.operation,
            path: presentation.path,
        });
    };

    const onToolProgress = (/** @type {Record<string, unknown>} */ evt) => {
        const toolCallId = /** @type {string} */ (evt?.['toolCallId'] ?? '');
        const entry = activeTools.get(toolCallId);
        const name = entry?.name ?? /** @type {string} */ (evt?.['toolName'] ?? evt?.['name'] ?? 'tool');
        if (shouldSuppressToolNarration(name)) {
            return;
        }
        const presentation = entry?.presentation ?? buildTerminalToolActivityPresentation(evt, name);
        const progress = typeof evt?.['progress'] === 'number' ? Number(evt['progress']) : null;
        const progressMessage = typeof evt?.['progressMessage'] === 'string' ? evt['progressMessage'] : null;
        const effectiveDetail =
            progressMessage ?? (progress !== null ? `${presentation.detail} · ${progress}%` : presentation.detail);
        const shouldPrint =
            getShowToolActivity() &&
            ((progress !== null &&
                (entry?.lastProgress == null || Math.abs(progress - entry.lastProgress) >= 5 || progress === 100)) ||
                (progressMessage !== null && progressMessage !== entry?.lastProgressMessage));
        if (entry) {
            entry.lastProgress = progress;
            entry.lastProgressMessage = progressMessage;
        }
        recordTerminalActivity('tool', 'Executando tool', {
            detail: effectiveDetail,
            toolName: name,
            progress,
            source: 'sdk',
            recordHistory: false,
        });
        if (shouldPrint) {
            const suffix = progressMessage ?? (progress !== null ? `${progress}%` : '');
            println(
                `  ${terminalThemeText('muted', '↳')} ${terminalThemeText('tool', presentation.progressLinePrefix)} ${terminalThemeText('muted', suffix)}`.trimEnd(),
            );
        }
        broadcastSse('tool.progress', {
            toolCallId,
            toolName: name,
            operation: presentation.operation,
            path: presentation.path,
            progress,
            progressMessage,
        });
    };

    const onToolPartialResult = (/** @type {{ toolCallId?: string; partialOutput?: string }} */ evt) => {
        const toolCallId = evt?.toolCallId ?? '';
        const entry = activeTools.get(toolCallId);
        const name = entry?.name ?? 'tool';
        if (shouldSuppressToolNarration(name)) {
            return;
        }
        const presentation = entry?.presentation ?? buildTerminalToolActivityPresentation({}, name);
        const partialOutput = typeof evt?.partialOutput === 'string' ? evt.partialOutput : '';
        if (!partialOutput) return;
        const preview = compactTerminalToolText(partialOutput, 120);
        recordTerminalActivity('tool', 'Streaming de saída da tool', {
            detail: preview ? `${presentation.detail} · ${preview}` : presentation.detail,
            toolName: name,
            source: 'sdk',
            recordHistory: false,
        });
        if (getShowStreaming()) {
            for (const line of partialOutput.split('\n')) {
                if (!line) continue;
                println(
                    `  ${terminalThemeText('muted', '↳')} ${terminalThemeText('tool', presentation.progressLinePrefix)} ${terminalThemeText('muted', line)}`,
                );
            }
        }
        broadcastSse('tool.partial_result', {
            toolCallId,
            toolName: name,
            operation: presentation.operation,
            path: presentation.path,
            partialOutput,
        });
    };

    const onToolComplete = (/** @type {Record<string, unknown>} */ evt) => {
        const toolCallId = /** @type {string} */ (evt?.['toolCallId'] ?? '');
        const success = Boolean(evt?.['success']);
        const entry = activeTools.get(toolCallId);
        activeTools.delete(toolCallId);
        const name = entry?.name ?? 'tool';
        if (shouldSuppressToolNarration(name)) {
            return;
        }
        const presentation = entry?.presentation ?? buildTerminalToolActivityPresentation(evt, name);
        const dur = entry ? ((Date.now() - entry.t0) / 1000).toFixed(1) : '?';
        const icon = success ? terminalThemeText('success', '✅') : terminalThemeText('error', '❌');
        const operationRole = mapOperationRole(presentation.operation);
        if (toolCallId) {
            completeTerminalTurnToolCall({ toolCallId, success });
        }
        recordTerminalActivity('tool', success ? 'Tool concluída' : 'Tool falhou', {
            detail: presentation.completeLine(success, `${dur}s`),
            toolName: name,
            progress: success ? 100 : null,
            severity: success ? 'info' : 'error',
            source: 'sdk',
        });
        if (getShowToolActivity()) {
            const statusBadge = success ? terminalThemeBadge('success', 'DONE') : terminalThemeBadge('error', 'FAIL');
            println(
                `  ${icon} ${statusBadge} ${terminalThemeText('tool', name)} ${terminalThemeText('muted', '·')} ${terminalThemeText(operationRole, presentation.completeLine(success, `${dur}s`))}`,
            );
        }
        broadcastSse('tool.complete', {
            toolCallId,
            toolName: name,
            operation: presentation.operation,
            path: presentation.path,
            success,
            durationMs: entry ? Date.now() - entry.t0 : 0,
        });
    };

    const onSessionError = (/** @type {Record<string, unknown>} */ evt) => {
        const msg = /** @type {string} */ (evt?.['message'] ?? 'unknown error');
        const errorType = /** @type {string} */ (evt?.['errorType'] ?? 'error');
        recordTerminalActivity('error', 'Erro de sessão', {
            detail: `[${errorType}] ${msg}`,
            severity: 'error',
            source: 'agent',
        });
        println(`\n  \x1b[31m⚠️  Erro de sessão [${errorType}]: ${msg}\x1b[0m`);
        broadcastSse('session.error', { errorType, message: msg });
    };

    const onCompactionStart = () => {
        recordTerminalActivity('compaction', 'Compactando contexto', {
            detail: 'Reduzindo uso de contexto da sessão',
            source: 'agent',
        });
        println(`  ${terminalThemeText('warn', '🗜️  Compactando context window…')}`);
        broadcastSse('compaction.start', {});
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
                `  ${terminalThemeText('success', `🗜️  Compactação concluída: ${pre.toLocaleString('pt-BR')} → ${post.toLocaleString('pt-BR')} tokens (-${pct}%)`)}`,
            );
        } else if (!success) {
            println(`  ${terminalThemeText('error', '🗜️  Compactação falhou')}`);
        }
        broadcastSse('compaction.complete', { success, pre, post });
    };

    const onIntent = (/** @type {Record<string, unknown>} */ evt) => {
        const intent = /** @type {string} */ (evt?.['intent'] ?? '');
        if (intent) {
            recordTerminalActivity('turn', 'Intenção do assistente', {
                detail: intent,
                source: 'sdk',
                recordHistory: false,
            });
            if (getShowIntentActivity()) {
                writeInlineStatus(`  \x1b[90m⏳ ${intent}\x1b[0m\x1b[K`);
            }
        }
    };

    const onSubagentStarted = (/** @type {Record<string, unknown>} */ evt) => {
        const name = /** @type {string} */ (evt?.['agentName'] ?? 'sub-agent');
        recordTerminalActivity('subagent', 'Subagente iniciado', {
            detail: name,
            source: 'agent',
        });
        println(`  \x1b[36m🤖 Sub-agente iniciado: ${name}\x1b[0m`);
    };

    const onSubagentCompleted = (/** @type {Record<string, unknown>} */ evt) => {
        const name = /** @type {string} */ (evt?.['agentName'] ?? 'sub-agent');
        recordTerminalActivity('subagent', 'Subagente concluído', {
            detail: name,
            source: 'agent',
        });
        println(`  \x1b[32m🤖 Sub-agente concluído: ${name}\x1b[0m`);
    };

    const onSubagentFailed = (/** @type {Record<string, unknown>} */ evt) => {
        const name = /** @type {string} */ (evt?.['agentName'] ?? 'sub-agent');
        const error = /** @type {string} */ (evt?.['error'] ?? 'unknown');
        recordTerminalActivity('subagent', 'Subagente falhou', {
            detail: `${name} — ${error}`,
            severity: 'error',
            source: 'agent',
        });
        println(`  \x1b[31m🤖 Sub-agente falhou: ${name} — ${error}\x1b[0m`);
    };

    agent.on(EMITTER_QUESTION_PENDING, onQuestion);
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

    const runtimeState = readTerminalRuntimeState();
    if (runtimeState.pendingQuestion && runtimeState.pendingQuestionKind !== 'ready') {
        renderPendingQuestion(
            runtimeState.pendingQuestion.question,
            runtimeState.pendingQuestion.choices ?? [],
            'replay',
        );
    }

    return () => {
        agent.off('question.pending', onQuestion);
        agent.off('stopped', onStopped);
        agent.off('tool.execution_start', onToolStart);
        agent.off(EMITTER_TOOL_EXECUTION_PARTIAL_RESULT, onToolPartialResult);
        agent.off('tool.execution_progress', onToolProgress);
        agent.off('tool.execution_complete', onToolComplete);
        agent.off('session.error', onSessionError);
        agent.off('session.compaction_start', onCompactionStart);
        agent.off('session.compaction_complete', onCompactionComplete);
        agent.off('assistant.intent', onIntent);
        agent.off('subagent.started', onSubagentStarted);
        agent.off('subagent.completed', onSubagentCompleted);
        agent.off('subagent.failed', onSubagentFailed);
    };
}
