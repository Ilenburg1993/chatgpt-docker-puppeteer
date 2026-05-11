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
} from '../../presentation/runtime-ui-state-store.js';
import { broadcastSse, buildUserPrompt, clearInlineStatus, println, writeInlineStatus } from '../dialog/index.js';
import { readTerminalRuntimeState } from '../frontend/gateways/agent-runtime.js';
import { recordTerminalActivity } from '../state/activity-state.js';
import { createTerminalPendingQuestionReplayState } from '../state/pending-question-replay.js';
import { createToolCallRegistry } from '../state/tool-call-registry.js';
import {
    completeTerminalTurnToolCall,
    recordTerminalTurnFileActivity,
    recordTerminalTurnToolActivity,
} from '../state/turn-trace-state.js';
import { getTerminalDetailLevel } from '../state/ui-preferences.js';
import { terminalActionChip, terminalThemeBadge, terminalThemeText } from '../state/ui-theme.js';
import { buildTerminalToolActivityPresentation, compactTerminalToolText } from './tool-activity-presenter.js';
import {
    buildToolLifecycleComplete,
    buildToolLifecyclePartialResult,
    buildToolLifecycleProgress,
    buildToolLifecycleStart,
} from './tool-lifecycle-event.js';
/**
 * @typedef {{
 *     on: (event: string, handler: (...args: any[]) => void) => void;
 *     off: (event: string, handler: (...args: any[]) => void) => void;
 * }} AgentEventHost
 */

const TOOL_HEARTBEAT_INTERVAL_MS = 10_000;

/**
 * @param {{
 *     agent: AgentEventHost;
 *     rl?: import('readline').Interface | null;
 *     registry?: ReturnType<import('../state/tool-call-registry.js').createToolCallRegistry> | null;
 * }} input
 * @returns {() => void}
 */
export function setupTerminalAgentRuntimeEventListeners({ agent, rl = null, registry = null }) {
    // Garante sempre um registry session-scoped — em produção é injetado pelo event-adapters.js
    const _reg = registry ?? createToolCallRegistry();
    /**
     * @type {Map<
     *     string,
     *     {
     *         name: string;
     *         t0: number;
     *         presentation: import('./tool-activity-presenter.js').TerminalToolActivityPresentation;
     *         lastProgress?: number | null;
     *         lastProgressMessage?: string | null;
     *         lastSignalAt: number;
     *         lastHeartbeatAt: number;
     *     }
     * >}
     */
    const activeTools = new Map();
    const pendingQuestionReplay = createTerminalPendingQuestionReplayState();
    const toolHeartbeatTimer = setInterval(() => {
        if (activeTools.size === 0) return;
        const now = Date.now();
        const compactDetail = getTerminalDetailLevel() === 'compact';
        for (const [toolCallId, entry] of activeTools.entries()) {
            const elapsedMs = now - entry.t0;
            if (elapsedMs < TOOL_HEARTBEAT_INTERVAL_MS) continue;
            if (now - entry.lastHeartbeatAt < TOOL_HEARTBEAT_INTERVAL_MS) continue;
            entry.lastHeartbeatAt = now;
            const elapsed = (elapsedMs / 1000).toFixed(0);
            const sinceSignal = ((now - entry.lastSignalAt) / 1000).toFixed(0);
            recordTerminalActivity('tool', 'Tool em andamento', {
                detail: `${entry.presentation.detail} · ${elapsed}s ativos · ${sinceSignal}s sem progresso`,
                toolName: entry.name,
                source: 'sdk',
                recordHistory: false,
            });
            if (getShowToolActivity()) {
                const line =
                    `  ${terminalThemeText('muted', '↳')} ${terminalThemeText('tool', compactDetail ? compactTerminalToolText(entry.name, 32) : entry.name)} ${terminalThemeText('muted', `ainda executando · ${elapsed}s · ${toolCallId || 'sem id'}`)}`.trimEnd();
                if (compactDetail) writeInlineStatus(line);
                else println(line);
            }
        }
    }, TOOL_HEARTBEAT_INTERVAL_MS);
    if (typeof toolHeartbeatTimer.unref === 'function') {
        toolHeartbeatTimer.unref();
    }

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
        const compactDetail = getTerminalDetailLevel() === 'compact';
        const questionText = compactDetail ? compactTerminalToolText(question, 96) : question;

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
            `\n${terminalThemeBadge('question', compactDetail ? 'ASK' : 'QUESTION')} ${terminalThemeText('question', `LLM-B perguntou: "${questionText}"`)}`,
        );
        if (choices.length > 0) {
            const maxInlineChoices = 6;
            const visibleChoices = choices.slice(0, maxInlineChoices);
            const indexed = visibleChoices
                .map((choice, idx) => `[${idx + 1}] ${compactDetail ? compactTerminalToolText(choice, 20) : choice}`)
                .join('   ');
            const overflow = choices.length > maxInlineChoices ? `   … +${choices.length - maxInlineChoices}` : '';
            if (!compactDetail) {
                println(`   ${terminalThemeBadge('info', 'OPTIONS')} ${choices.join(' | ')}`);
            }
            println(`   ${terminalThemeBadge('info', compactDetail ? 'PICK' : 'SELECT')} ${indexed}${overflow}`);
        }
        if (rl) {
            println(
                compactDetail
                    ? `   ${terminalThemeText('muted', '→')} ${terminalActionChip('/answer')} ${terminalActionChip('/status')} ${terminalActionChip('/clear-shadow')}`
                    : `   ${terminalThemeText('muted', '→ Responda digitando normalmente. Sua próxima mensagem será usada como resposta.')}`,
            );
            if (!compactDetail) {
                println(
                    `   ${terminalThemeText('muted', '→ Ações rápidas:')} ${terminalActionChip('/status')} ${terminalActionChip('/answer <texto>')} ${terminalActionChip('/clear-shadow')}`,
                );
            }
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
        // Evita duplicidade visual: ferramentas externas já foram anunciadas em external_tool.requested
        if (_reg.isNameInFlight(name)) {
            return;
        }
        // Registra tool nativa no ToolCallRegistry para correlação io_op → toolCallId
        if (toolCallId) {
            _reg.register(toolCallId, name, 'native');
        }
        const compactDetail = getTerminalDetailLevel() === 'compact';
        const presentation = buildTerminalToolActivityPresentation(evt, name);
        const canonicalName = presentation.canonicalToolName ?? name;
        const startedAt = Date.now();
        activeTools.set(toolCallId, {
            name: canonicalName,
            t0: startedAt,
            presentation,
            lastProgress: null,
            lastProgressMessage: null,
            lastSignalAt: startedAt,
            lastHeartbeatAt: 0,
        });
        recordTerminalTurnToolActivity({
            toolName: canonicalName,
            operation: presentation.operation,
            path: presentation.path,
            target: presentation.target,
            source: 'sdk',
            status: 'started',
            toolCallId,
        });
        for (const fileTarget of presentation.fileTargets) {
            if (!fileTarget || fileTarget === presentation.path) continue;
            recordTerminalTurnFileActivity({
                path: fileTarget,
                operation: presentation.operation,
                source: 'sdk',
            });
        }
        recordTerminalActivity('tool', 'Executando tool', {
            detail: presentation.detail,
            toolName: canonicalName,
            source: 'sdk',
        });
        if (getShowToolActivity()) {
            const operationRole = mapOperationRole(presentation.operation);
            const opLabel = presentation.operation.toUpperCase();
            println(
                compactDetail
                    ? `  ${terminalThemeBadge('tool', 'TOOL')} ${terminalThemeBadge(operationRole, opLabel)} ${terminalThemeText('tool', compactTerminalToolText(presentation.displayToolName, 28))} ${terminalThemeText('muted', '·')} ${terminalThemeText(operationRole, compactTerminalToolText(presentation.startLine, 86))}`
                    : `  ${terminalThemeBadge('tool', 'TOOL')} ${terminalThemeBadge(operationRole, opLabel)} ${terminalThemeText('tool', presentation.displayToolName)} ${terminalThemeText('muted', '·')} ${terminalThemeText(operationRole, presentation.startLine)}`,
            );
        }
        broadcastSse('tool.start', {
            toolCallId,
            toolName: name,
            operation: presentation.operation,
            path: presentation.path,
            target: presentation.target,
            fileTargets: presentation.fileTargets,
            urlTargets: presentation.urlTargets,
            searchTerms: presentation.searchTerms,
            lineRange: presentation.lineRange,
            patchFiles: presentation.patchFiles,
        });
        broadcastSse(
            'tool.lifecycle',
            buildToolLifecycleStart({
                toolCallId,
                toolName: name,
                canonicalName,
                operation: presentation.operation,
                path: presentation.path,
                target: presentation.target,
                fileTargets: presentation.fileTargets,
                urlTargets: presentation.urlTargets,
                searchTerms: presentation.searchTerms,
                lineRange: presentation.lineRange,
                patchFiles: presentation.patchFiles,
            }),
        );
    };

    const onToolProgress = (/** @type {Record<string, unknown>} */ evt) => {
        const toolCallId = /** @type {string} */ (evt?.['toolCallId'] ?? '');
        const entry = activeTools.get(toolCallId);
        const name = entry?.name ?? /** @type {string} */ (evt?.['toolName'] ?? evt?.['name'] ?? 'tool');
        if (shouldSuppressToolNarration(name)) {
            return;
        }
        const compactDetail = getTerminalDetailLevel() === 'compact';
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
            entry.lastSignalAt = Date.now();
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
            const progressLine =
                `  ${terminalThemeText('muted', '↳')} ${terminalThemeText('tool', compactDetail ? compactTerminalToolText(presentation.progressLinePrefix, 56) : presentation.progressLinePrefix)} ${terminalThemeText('muted', suffix)}`.trimEnd();
            if (compactDetail) {
                writeInlineStatus(progressLine);
            } else {
                println(progressLine);
            }
        }
        broadcastSse('tool.progress', {
            toolCallId,
            toolName: name,
            operation: presentation.operation,
            path: presentation.path,
            target: presentation.target,
            fileTargets: presentation.fileTargets,
            urlTargets: presentation.urlTargets,
            searchTerms: presentation.searchTerms,
            lineRange: presentation.lineRange,
            patchFiles: presentation.patchFiles,
            progress,
            progressMessage,
        });
        broadcastSse(
            'tool.lifecycle',
            buildToolLifecycleProgress({
                toolCallId,
                toolName: name,
                operation: presentation.operation,
                path: presentation.path,
                target: presentation.target,
                fileTargets: presentation.fileTargets,
                urlTargets: presentation.urlTargets,
                searchTerms: presentation.searchTerms,
                lineRange: presentation.lineRange,
                patchFiles: presentation.patchFiles,
                progress,
                progressMessage,
            }),
        );
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
        if (entry) {
            entry.lastSignalAt = Date.now();
        }
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
            target: presentation.target,
            fileTargets: presentation.fileTargets,
            urlTargets: presentation.urlTargets,
            searchTerms: presentation.searchTerms,
            lineRange: presentation.lineRange,
            patchFiles: presentation.patchFiles,
            partialOutput,
        });
        broadcastSse(
            'tool.lifecycle',
            buildToolLifecyclePartialResult({
                toolCallId,
                toolName: name,
                operation: presentation.operation,
                path: presentation.path,
                target: presentation.target,
                fileTargets: presentation.fileTargets,
                urlTargets: presentation.urlTargets,
                searchTerms: presentation.searchTerms,
                lineRange: presentation.lineRange,
                patchFiles: presentation.patchFiles,
                partialOutput,
            }),
        );
    };

    const onToolComplete = (/** @type {Record<string, unknown>} */ evt) => {
        const toolCallId = /** @type {string} */ (evt?.['toolCallId'] ?? '');
        const success = Boolean(evt?.['success']);
        const requestId = typeof evt?.['requestId'] === 'string' ? evt['requestId'] : null;
        const entry = activeTools.get(toolCallId);
        activeTools.delete(toolCallId);
        const eventName =
            typeof evt?.['toolName'] === 'string' && evt['toolName'].length > 0
                ? evt['toolName']
                : typeof evt?.['name'] === 'string' && evt['name'].length > 0
                  ? evt['name']
                  : null;
        const name = entry?.name ?? eventName ?? 'tool';
        if (shouldSuppressToolNarration(name)) {
            return;
        }
        // Evita duplicidade visual: ferramentas externas já foram anunciadas em external_tool.completed
        const suppressByInFlightName = entry ? false : _reg.isNameInFlight(name);
        if (
            suppressByInFlightName ||
            _reg.wasNameRecentlyCompleted(name, requestId) ||
            _reg.wasRecentlyCompleted(toolCallId, requestId)
        ) {
            return;
        }
        // Completa tool nativa no ToolCallRegistry (após guard; externals são completadas em onExternalToolCompleted)
        if (toolCallId && _reg.getEntry(toolCallId)?.kind === 'native') {
            _reg.complete(toolCallId, success);
        }
        const compactDetail = getTerminalDetailLevel() === 'compact';
        const completionPresentation = buildTerminalToolActivityPresentation(evt, name);
        const presentation =
            completionPresentation.target || completionPresentation.path
                ? completionPresentation
                : (entry?.presentation ?? completionPresentation);
        const canonicalName = presentation.canonicalToolName ?? name;
        const durationMs = entry
            ? Date.now() - entry.t0
            : Number.isFinite(Number(evt?.['durationMs']))
              ? Number(evt?.['durationMs'])
              : 0;
        const dur = durationMs > 0 ? `${(durationMs / 1000).toFixed(1)}s` : 'n/d';
        const icon = success ? terminalThemeText('success', '✅') : terminalThemeText('error', '❌');
        const operationRole = mapOperationRole(presentation.operation);
        if (compactDetail) {
            clearInlineStatus();
        }
        if (toolCallId) {
            completeTerminalTurnToolCall({ toolCallId, success });
        }
        const hasOnlyCallIdTarget =
            typeof presentation.target === 'string' &&
            presentation.target.length > 0 &&
            presentation.target === toolCallId;
        const lowFidelityGeneric =
            canonicalName === 'tool' &&
            presentation.operation === 'unknown' &&
            presentation.fileTargets.length === 0 &&
            presentation.urlTargets.length === 0 &&
            presentation.searchTerms.length === 0 &&
            (hasOnlyCallIdTarget || !presentation.target);
        const lowFidelitySuffix =
            lowFidelityGeneric && toolCallId ? ` · callId=${compactTerminalToolText(toolCallId, 28)}` : '';
        const completionDetail = `${presentation.completeLine(success, dur)}${lowFidelitySuffix}`;

        const activityLabel = lowFidelityGeneric
            ? success
                ? 'Tool concluída (metadados parciais)'
                : 'Tool falhou (metadados parciais)'
            : success
              ? 'Tool concluída'
              : 'Tool falhou';
        recordTerminalActivity('tool', activityLabel, {
            detail: completionDetail,
            toolName: canonicalName,
            progress: success ? 100 : null,
            severity: success ? 'info' : 'error',
            source: 'sdk',
        });
        if (getShowToolActivity()) {
            const statusBadge = success ? terminalThemeBadge('success', 'DONE') : terminalThemeBadge('error', 'FAIL');
            const renderedName =
                lowFidelityGeneric && toolCallId ? `tool#${toolCallId.slice(-8)}` : presentation.displayToolName;
            println(
                compactDetail
                    ? `  ${icon} ${statusBadge} ${terminalThemeText('tool', compactTerminalToolText(renderedName, 28))} ${terminalThemeText('muted', '·')} ${terminalThemeText(operationRole, compactTerminalToolText(completionDetail, 88))}`
                    : `  ${icon} ${statusBadge} ${terminalThemeText('tool', renderedName)} ${terminalThemeText('muted', '·')} ${terminalThemeText(operationRole, completionDetail)}`,
            );
        }
        broadcastSse('tool.complete', {
            toolCallId,
            toolName: name,
            operation: presentation.operation,
            path: presentation.path,
            target: presentation.target,
            fileTargets: presentation.fileTargets,
            urlTargets: presentation.urlTargets,
            searchTerms: presentation.searchTerms,
            lineRange: presentation.lineRange,
            patchFiles: presentation.patchFiles,
            success,
            durationMs: entry ? Date.now() - entry.t0 : 0,
        });
        broadcastSse(
            'tool.lifecycle',
            buildToolLifecycleComplete({
                toolCallId,
                toolName: name,
                canonicalName,
                operation: presentation.operation,
                path: presentation.path,
                target: presentation.target,
                fileTargets: presentation.fileTargets,
                urlTargets: presentation.urlTargets,
                searchTerms: presentation.searchTerms,
                lineRange: presentation.lineRange,
                patchFiles: presentation.patchFiles,
                success,
                durationMs: durationMs > 0 ? durationMs : 0,
            }),
        );
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
        clearInterval(toolHeartbeatTimer);
        agent.off(EMITTER_QUESTION_PENDING, onQuestion);
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
    };
}
