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

import { cancelTimer, registerInterval } from '#copilot/core';
import {
    EMITTER_AGENT_BACKGROUND_COMPLETED,
    EMITTER_AGENT_BACKGROUND_IDLE,
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
import { getShowToolActivity, getShowUsage } from '../../presentation/state/index.js';
import { broadcastSse, buildUserPrompt, println, writeInlineStatus } from '../dialog/index.js';
import { readTerminalRuntimeState } from '../frontend/gateways/index.js';
import {
    createTerminalPendingQuestionReplayState,
    createToolCallRegistry,
    getTerminalDetailLevel,
    recordTerminalActivity,
    terminalActionChip,
    terminalThemeBadge,
    terminalThemeText,
} from '../state/events/index.js';
import { renderTerminalIntent } from './intent-renderer.js';
import { compactTerminalToolText } from './tool-activity-presenter.js';
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
/**
 * @typedef {{
 *     on: (event: string, handler: (...args: any[]) => void) => void;
 *     off: (event: string, handler: (...args: any[]) => void) => void;
 * }} AgentEventHost
 */

const TOOL_HEARTBEAT_INTERVAL_MS = 10_000;

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
    const mismatch =
        Boolean(evt?.['modelMismatch']) ||
        Boolean(billedModel && configuredModel && billedModel !== configuredModel) ||
        Boolean(effectiveModel && configuredModel && effectiveModel !== configuredModel);
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
        if (billing.configuredModel) parts.push(`modeloCfg=${billing.configuredModel}`);
        if (billing.effectiveModel) parts.push(`modeloEfetivo=${billing.effectiveModel}`);
        if (billing.billedModel) parts.push(`modeloCobrado=${billing.billedModel}`);
    } else if (billing.displayModel) {
        parts.push(`modelo=${billing.displayModel}`);
    }
    if (billing.cost !== null) {
        parts.push(`custo=${billing.cost.toFixed(4)}`);
    }
    return parts.join(' · ') || 'sem metadados de billing';
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
                const elapsedMs = now - entry.t0;
                if (elapsedMs < TOOL_HEARTBEAT_INTERVAL_MS) continue;
                if (now - entry.lastHeartbeatAt < TOOL_HEARTBEAT_INTERVAL_MS) continue;
                _reg.touch(toolCallId, { lastHeartbeatAt: now, lastSignalAt: entry.lastSignalAt });
                const elapsed = (elapsedMs / 1000).toFixed(0);
                const sinceSignal = ((now - entry.lastSignalAt) / 1000).toFixed(0);
                const detailBase = entry.presentation?.detail ?? entry.toolName;
                const renderedName = entry.canonicalName ?? entry.toolName;
                recordTerminalActivity('tool', 'Tool em andamento', {
                    detail: `${detailBase} · ${elapsed}s ativos · ${sinceSignal}s sem progresso`,
                    toolName: renderedName,
                    source: 'sdk',
                    recordHistory: false,
                });
                if (getShowToolActivity()) {
                    const line =
                        `  ${terminalThemeText('muted', '↳')} ${terminalThemeText('tool', compactDetail ? compactTerminalToolText(renderedName, 32) : renderedName)} ${terminalThemeText('muted', `ainda executando · ${elapsed}s · ${toolCallId || 'sem id'}`)}`.trimEnd();
                    if (compactDetail) {
                        println(line);
                        writeInlineStatus(line);
                    } else println(line);
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

    const onBackgroundCompleted = (/** @type {Record<string, unknown>} */ evt) => {
        const description = /** @type {string} */ (
            evt?.['description'] ?? evt?.['agentType'] ?? evt?.['agentId'] ?? 'agent'
        );
        const status = /** @type {'completed' | 'failed'} */ (evt?.['status'] ?? 'completed');
        const failed = status === 'failed';
        recordTerminalActivity('task', failed ? 'Agente em background falhou' : 'Agente em background concluído', {
            detail: `${description} · status=${status}`,
            severity: failed ? 'error' : 'info',
            source: 'agent',
        });
        println(
            failed
                ? `  \x1b[31m🤖 Background agent falhou: ${description}\x1b[0m`
                : `  \x1b[32m🤖 Background agent concluído: ${description}\x1b[0m`,
        );
        broadcastSse('agent.background.completed', {
            ...evt,
            timestamp: Date.now(),
        });
    };

    const onBackgroundIdle = (/** @type {Record<string, unknown>} */ evt) => {
        const description = /** @type {string} */ (
            evt?.['description'] ?? evt?.['agentType'] ?? evt?.['agentId'] ?? 'agent'
        );
        recordTerminalActivity('task', 'Agente em background ocioso', {
            detail: description,
            source: 'agent',
            recordHistory: false,
        });
        println(`  \x1b[90m🤖 Background agent ocioso: ${description}\x1b[0m`);
        broadcastSse('agent.background.idle', {
            ...evt,
            timestamp: Date.now(),
        });
    };

    const onShellCompleted = (/** @type {Record<string, unknown>} */ evt) => {
        const description = /** @type {string} */ (evt?.['description'] ?? evt?.['shellId'] ?? 'shell');
        const exitCode = typeof evt?.['exitCode'] === 'number' ? evt['exitCode'] : null;
        const failed = exitCode !== null && exitCode !== 0;
        recordTerminalActivity('task', failed ? 'Shell concluído com erro' : 'Shell concluído', {
            detail: `${description}${exitCode !== null ? ` · exit=${exitCode}` : ''}`,
            severity: failed ? 'error' : 'info',
            source: 'agent',
        });
        println(
            failed
                ? `  \x1b[31m💻 Shell concluído com erro: ${description}${exitCode !== null ? ` · exit=${exitCode}` : ''}\x1b[0m`
                : `  \x1b[32m💻 Shell concluído: ${description}${exitCode !== null ? ` · exit=${exitCode}` : ''}\x1b[0m`,
        );
        broadcastSse('agent.shell.completed', {
            ...evt,
            timestamp: Date.now(),
        });
    };

    const onShellDetachedCompleted = (/** @type {Record<string, unknown>} */ evt) => {
        const description = /** @type {string} */ (evt?.['description'] ?? evt?.['shellId'] ?? 'shell');
        recordTerminalActivity('task', 'Shell destacada concluída', {
            detail: description,
            source: 'agent',
        });
        println(`  \x1b[32m💻 Shell destacada concluída: ${description}\x1b[0m`);
        broadcastSse('agent.shell.detached_completed', {
            ...evt,
            timestamp: Date.now(),
        });
    };

    const onPrConsumed = (/** @type {Record<string, unknown>} */ evt) => {
        const billing = normalizeUsageBilling(evt);
        const detail = formatUsageDetail(billing);
        const showUsage = getShowUsage();
        const shouldPersist = showUsage || billing.mismatch;
        const label = billing.mismatch ? 'Uso contabilizado com divergência de modelo' : 'Uso do turno contabilizado';
        recordTerminalActivity('system', label, {
            detail,
            source: 'agent',
            severity: billing.mismatch ? 'warn' : 'info',
            recordHistory: shouldPersist,
        });
        if (showUsage || billing.mismatch) {
            println(
                `  ${terminalThemeBadge(billing.mismatch ? 'warn' : 'info', 'USAGE')} ${terminalThemeText(billing.mismatch ? 'warn' : 'muted', detail)}`,
            );
        }
        broadcastSse(AGENT_PR_CONSUMED_EVENT, {
            ...evt,
            timestamp: Date.now(),
        });
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
        println(
            `  ${terminalThemeBadge('warn', 'MODEL')} ${terminalThemeText('warn', `Fallback de modelo: ${detail}`)}`,
        );
        broadcastSse(AGENT_PR_FALLBACK_MODEL_EVENT, {
            ...evt,
            timestamp: Date.now(),
        });
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
    agent.on(EMITTER_AGENT_BACKGROUND_COMPLETED, onBackgroundCompleted);
    agent.on(EMITTER_AGENT_BACKGROUND_IDLE, onBackgroundIdle);
    agent.on(AGENT_SHELL_COMPLETED_EVENT, onShellCompleted);
    agent.on(AGENT_SHELL_DETACHED_COMPLETED_EVENT, onShellDetachedCompleted);
    agent.on(AGENT_PR_CONSUMED_EVENT, onPrConsumed);
    agent.on(AGENT_PR_FALLBACK_MODEL_EVENT, onPrFallbackModel);

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
        agent.off(AGENT_PR_CONSUMED_EVENT, onPrConsumed);
        agent.off(AGENT_PR_FALLBACK_MODEL_EVENT, onPrFallbackModel);
    };
}
