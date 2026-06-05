// @ts-check
/**
 * Linha viva permanente do terminal LLM-B.
 *
 * Esta camada desenha uma única linha transitória com o estado operacional atual enquanto há trabalho em andamento.
 * Eventos relevantes continuam sendo impressos como histórico; a linha viva é o pulso constante entre esses eventos.
 *
 * @module copilot/terminal/live-status-line
 */

import { TERMINAL_LIVE_STATUS_ENABLED, TERMINAL_LIVE_STATUS_INTERVAL_MS } from '#copilot/config';
import { cancelTimer, registerInterval } from '#copilot/core';
import { getBusy } from '../../presentation/state/index.js';
import { clearInlineStatus, writeInlineStatus } from '../dialog/index.js';
import { getTerminalHumanToolName, humanizeTerminalToolSurfaceText } from '../events/tool-activity-presenter.js';
import {
    listTerminalPendingStructuredUserInputs,
    readTerminalDialogStreamMeta,
    readTerminalRuntimeState,
} from '../frontend/gateways/index.js';
import { readTerminalActivitySnapshot, terminalThemeText } from '../state/repl/index.js';

const MIN_LIVE_STATUS_INTERVAL_MS = 250;
const MIN_LIVE_STATUS_HEARTBEAT_MS = 1_000;
const DEFAULT_LIVE_STATUS_HEARTBEAT_MS = 5_000;
const LIVE_LABEL_MAX_CHARS = 28;
const LIVE_DETAIL_MAX_CHARS = 48;
const LIVE_STATUS_FALLBACK_COLUMNS = 120;
const LIVE_STATUS_MIN_COLUMNS = 48;
const ANSI_CLEAR_TO_END_OF_LINE = '\x1b[K';
const ANSI_RESET = '\x1b[0m';
const ANSI_ESCAPE = String.fromCharCode(27);
const ANSI_ESCAPE_PATTERN = new RegExp(`${ANSI_ESCAPE}\\[[0-?]*[ -/]*[@-~]`, 'gu');
const ANSI_ESCAPE_PREFIX_PATTERN = new RegExp(`^${ANSI_ESCAPE}\\[[0-?]*[ -/]*[@-~]`, 'u');

/**
 * @param {number | null | undefined} columns
 * @returns {number}
 */
function resolveLiveStatusBudget(columns) {
    const candidate = Number(columns ?? process.stdout.columns ?? LIVE_STATUS_FALLBACK_COLUMNS);
    if (!Number.isFinite(candidate)) return LIVE_STATUS_FALLBACK_COLUMNS - 1;
    return Math.max(LIVE_STATUS_MIN_COLUMNS, Math.floor(candidate) - 1);
}

/**
 * @param {string} value
 * @returns {string}
 */
function stripLiveStatusAnsi(value) {
    return value.replace(ANSI_ESCAPE_PATTERN, '');
}

/**
 * @param {string} value
 * @returns {number}
 */
function liveStatusVisibleLength(value) {
    return Array.from(stripLiveStatusAnsi(value)).length;
}

/**
 * Mantém a linha viva fisicamente em uma única linha sem quebrar sequências ANSI.
 *
 * @param {string} value
 * @param {number | null | undefined} columns
 * @returns {string}
 */
function fitLiveStatusToSingleLine(value, columns) {
    const budget = resolveLiveStatusBudget(columns);
    const sanitized = String(value)
        .replaceAll(ANSI_CLEAR_TO_END_OF_LINE, '')
        .replace(/[\r\n]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trimEnd();
    if (liveStatusVisibleLength(sanitized) <= budget) return `${sanitized}${ANSI_CLEAR_TO_END_OF_LINE}`;

    const targetVisibleChars = Math.max(1, budget - 1);
    let visibleChars = 0;
    let result = '';
    for (let index = 0; index < sanitized.length && visibleChars < targetVisibleChars; ) {
        if (sanitized[index] === ANSI_ESCAPE) {
            const match = sanitized.slice(index).match(ANSI_ESCAPE_PREFIX_PATTERN);
            if (match) {
                result += match[0];
                index += match[0].length;
                continue;
            }
        }
        const codePoint = sanitized.codePointAt(index);
        if (codePoint === undefined) break;
        result += String.fromCodePoint(codePoint);
        index += codePoint > 0xffff ? 2 : 1;
        visibleChars += 1;
    }
    return `${result}…${ANSI_RESET}${ANSI_CLEAR_TO_END_OF_LINE}`;
}

/**
 * @param {string} phase
 * @returns {string}
 */
function renderLivePhaseLabel(phase) {
    if (phase === 'idle') return 'pronta';
    if (phase === 'boot') return 'iniciando';
    if (phase === 'tool') return 'ferramenta';
    if (phase === 'turn') return 'turno';
    if (phase === 'thinking') return 'pensando';
    if (phase === 'streaming') return 'respondendo';
    if (phase === 'question') return 'aguardando operador';
    if (phase === 'task') return 'tarefa';
    if (phase === 'compaction') return 'compactando';
    if (phase === 'error') return 'erro';
    return 'trabalhando';
}

/**
 * @param {ReturnType<typeof readTerminalRuntimeState>} runtime
 * @returns {runtime is ReturnType<typeof readTerminalRuntimeState> & { pendingQuestion: NonNullable<ReturnType<typeof readTerminalRuntimeState>['pendingQuestion']> }}
 */
function hasHumanPendingQuestion(runtime) {
    return (
        runtime.status === 'waiting_for_input' &&
        runtime.pendingQuestionKind === 'question' &&
        Boolean(runtime.pendingQuestion)
    );
}

/**
 * @param {string | null | undefined} value
 * @param {number} max
 * @returns {string}
 */
function compactLiveStatusText(value, max) {
    const text = humanizeTerminalToolSurfaceText(value)
        .replace(/\bturnId=\d+\b/giu, 'turno concluído')
        .replace(/\s+/g, ' ')
        .trim();
    return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * @param {ReturnType<typeof readTerminalActivitySnapshot>} activity
 * @returns {string}
 */
function renderLiveToolName(activity) {
    const name = activity.toolName ?? '';
    if (!name) return '';
    return compactLiveStatusText(getTerminalHumanToolName(name), 28);
}

/**
 * @param {ReturnType<typeof readTerminalActivitySnapshot>} activity
 * @param {number} [max=42] Default is `42`
 * @returns {string}
 */
function renderLiveToolTarget(activity, max = 42) {
    if (!activity.toolTarget) return '';
    if (max < 8) return '';
    return compactLiveStatusText(activity.toolTarget, max);
}

/**
 * @param {string} detail
 * @returns {string | null}
 */
function extractQuietWaitStatus(detail) {
    const match = detail.match(
        /(?<elapsed>\d+(?:s|m\d{2}s|h\d{2}m)?)\s+sem\s+(?<kind>delta|resposta)(?:\s+visível)?/iu,
    );
    const elapsed = match?.groups?.['elapsed'] ?? null;
    const kind = match?.groups?.['kind'] ?? null;
    if (!elapsed || !kind) return null;
    return kind.toLowerCase() === 'resposta' ? `${elapsed} sem resposta pública` : `${elapsed} sem delta`;
}

/**
 * @param {ReturnType<typeof readTerminalActivitySnapshot>} activity
 * @returns {boolean}
 */
function isModelRecoveryActivity(activity) {
    const text = `${activity.phase ?? ''} ${activity.label ?? ''} ${activity.detail ?? ''}`.toLowerCase();
    return (
        text.includes('model_retry') ||
        text.includes('retry de modelo') ||
        text.includes('retry do modelo') ||
        text.includes('response was interrupted') ||
        text.includes('server error. retrying')
    );
}

/**
 * @param {string} status
 * @param {string} loop
 * @returns {string}
 */
function compactRuntimeStatus(status, loop) {
    if (status === 'starting') return 'iniciando';
    if (status === 'stopped') return 'conversa parada';
    if (status === 'idle' && loop === 'loop') return 'conversa ativa';
    if (status === 'processing' && loop === 'loop') return 'conversa ativa';
    if (!status || status === 'processing') return loop === 'loop' ? 'conversa ativa' : 'trabalhando';
    const statusLabel = status === 'idle' ? 'ocioso' : status === 'paused' ? 'pausado' : status;
    return `${statusLabel} · ${loop === 'loop' ? 'conversa ativa' : 'standby'}`;
}

/**
 * @param {number} ms
 * @returns {string}
 */
function formatLiveDuration(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes < 60) return `${minutes}m${String(seconds).padStart(2, '0')}s`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h${String(minutes % 60).padStart(2, '0')}m`;
}

/**
 * @param {string} model
 * @param {string} effort
 * @returns {string}
 */
function renderLiveModelEffort(model, effort) {
    return [
        model && model !== '-' ? `modelo ${compactLiveStatusText(model, 24)}` : null,
        effort && effort !== '-' ? `raciocínio ${compactLiveStatusText(effort, 12)}` : null,
    ]
        .filter((part) => typeof part === 'string' && part.length > 0)
        .join(' · ');
}

/**
 * @param {string} label
 * @returns {boolean}
 */
function isCompletedLiveStatusActivity(label) {
    const normalized = label.toLowerCase();
    return (
        normalized.includes('conclu') ||
        normalized.includes('falh') ||
        normalized.includes('encerrad') ||
        normalized.includes('respondid') ||
        normalized.includes('aprovad') ||
        normalized.includes('rejeitad')
    );
}

/**
 * @param {ReturnType<typeof readTerminalActivitySnapshot>} activity
 * @returns {boolean}
 */
function isTurnFinalizationActivity(activity) {
    const text = `${activity.label ?? ''} ${activity.detail ?? ''}`.toLowerCase();
    return (
        activity.phase === 'turn' &&
        (text.includes('turno do assistente conclu') ||
            text.includes('reply do turno') ||
            text.includes('turno explícito resolvido') ||
            text.includes('turno explicito resolvido'))
    );
}

/**
 * @param {ReturnType<typeof readTerminalActivitySnapshot>} activity
 * @returns {boolean}
 */
function isEmptyAfterUserInputActivity(activity) {
    const text = `${activity.label ?? ''} ${activity.detail ?? ''}`.toLowerCase();
    return (
        activity.phase === 'turn' &&
        (text.includes('continuação pós-pergunta vazia') ||
            text.includes('continuacao pos-pergunta vazia') ||
            text.includes('continuação pós-pergunta terminou sem texto público') ||
            text.includes('continuacao pos-pergunta terminou sem texto publico'))
    );
}

/**
 * @param {ReturnType<typeof readTerminalActivitySnapshot>} activity
 * @returns {boolean}
 */
function isByokProviderErrorActivity(activity) {
    const text = `${activity.label ?? ''} ${activity.detail ?? ''}`.toLowerCase();
    return activity.phase === 'error' && (text.includes('provider byok') || text.includes('provedor byok'));
}

/**
 * @param {{
 *     activity?: ReturnType<typeof readTerminalActivitySnapshot>;
 *     runtime?: ReturnType<typeof readTerminalRuntimeState>;
 *     stream?: ReturnType<typeof readTerminalDialogStreamMeta>;
 *     now?: number;
 *     columns?: number;
 * }} [input]
 * @returns {string}
 */
function buildTerminalLiveStatusLine(input = {}) {
    const now = input.now ?? Date.now();
    const activity = input.activity ?? readTerminalActivitySnapshot();
    const runtime = input.runtime ?? readTerminalRuntimeState();
    const stream = input.stream ?? readTerminalDialogStreamMeta();
    const model = stream?.model || runtime.model || '-';
    const effort = stream?.reasoningEffort || runtime.reasoningEffort || '-';
    const modelEffort = renderLiveModelEffort(model, effort);
    if (hasHumanPendingQuestion(runtime)) {
        const choices = Array.isArray(runtime.pendingQuestion.choices) ? runtime.pendingQuestion.choices : [];
        const choiceText = choices.length > 0 ? ` · ${compactLiveStatusText(choices.join('|'), 20)}` : '';
        const queue = Number(runtime.queueSize ?? 0) > 0 ? ` · fila ${runtime.queueSize}` : '';
        return (
            `  ${terminalThemeText('assistant', 'LLM-B')} ` +
            `${terminalThemeText('question', 'aguardando você')}` +
            `${terminalThemeText('muted', ` · [PERG]${choiceText}${queue}`)}` +
            '\x1b[K'
        );
    }
    const structuredInputs = listTerminalPendingStructuredUserInputs();
    const structuredInput = structuredInputs.at(0) ?? null;
    if (structuredInput) {
        const choices = Array.isArray(structuredInput.choices) ? structuredInput.choices : [];
        const choiceText = choices.length > 0 ? ` · ${compactLiveStatusText(choices.join('|'), 20)}` : '';
        const queue = structuredInputs.length > 1 ? ` · fila ${structuredInputs.length}` : '';
        return (
            `  ${terminalThemeText('assistant', 'LLM-B')} ` +
            `${terminalThemeText('question', 'aguardando você')}` +
            `${terminalThemeText('muted', ` · formulário${choiceText}${queue}`)}` +
            '\x1b[K'
        );
    }
    const ageMs = Math.max(0, now - activity.startedAt);
    const detail = compactLiveStatusText(activity.detail ?? activity.toolName ?? '', LIVE_DETAIL_MAX_CHARS);
    const progress = activity.progress !== null ? ` · ${activity.progress}%` : '';
    const loop = runtime.dialogLoopActive ? 'loop' : 'noloop';
    const queue = Number(runtime.queueSize ?? 0) > 0 ? ` · fila ${runtime.queueSize}` : '';
    const displayStatus =
        activity.phase === 'idle' && Number(runtime.queueSize ?? 0) === 0 && runtime.status === 'processing'
            ? 'idle'
            : (runtime.status ?? '-');
    const severityRole = activity.severity === 'error' ? 'error' : activity.severity === 'warn' ? 'warn' : 'muted';
    const runtimeTail = compactRuntimeStatus(displayStatus, loop);
    const quietWaitStatus = activity.phase === 'thinking' ? extractQuietWaitStatus(activity.detail ?? '') : null;
    if (quietWaitStatus) {
        return (
            `  ${terminalThemeText('assistant', 'LLM-B')} ` +
            `${terminalThemeText(severityRole, 'pensando')}` +
            `${terminalThemeText('muted', ` · ${quietWaitStatus}${queue}`)}` +
            '\x1b[K'
        );
    }
    if (activity.phase === 'boot') {
        const bootLabel = compactLiveStatusText(activity.label, 24);
        return (
            `  ${terminalThemeText('assistant', 'LLM-B')} ` +
            `${terminalThemeText(severityRole, `iniciando · ${bootLabel}`)}` +
            `${terminalThemeText('muted', ` · ${formatLiveDuration(ageMs)}${queue}`)}` +
            '\x1b[K'
        );
    }
    if (isModelRecoveryActivity(activity)) {
        return (
            `  ${terminalThemeText('assistant', 'LLM-B')} ` +
            `${terminalThemeText('warn', 'recuperando')}` +
            `${terminalThemeText('muted', ` · retry do modelo · ${formatLiveDuration(ageMs)}${queue}`)}` +
            '\x1b[K'
        );
    }
    if (isByokProviderErrorActivity(activity)) {
        return (
            `  ${terminalThemeText('assistant', 'LLM-B')} ` +
            `${terminalThemeText('warn', 'erro')}` +
            `${terminalThemeText('muted', ` · rota BYOK · ${formatLiveDuration(ageMs)}`)}` +
            '\x1b[K'
        );
    }
    if (activity.phase === 'error') {
        return (
            `  ${terminalThemeText('assistant', 'LLM-B')} ` +
            `${terminalThemeText('error', 'erro')}` +
            `${terminalThemeText('muted', ` · ${compactLiveStatusText(activity.label, 24)} · ${formatLiveDuration(ageMs)}`)}` +
            '\x1b[K'
        );
    }
    const label = compactLiveStatusText(activity.label, LIVE_LABEL_MAX_CHARS);
    if (activity.phase === 'question') {
        const answered = `${activity.label ?? ''} ${activity.detail ?? ''}`.toLowerCase().includes('resposta');
        return (
            `  ${terminalThemeText('assistant', 'LLM-B')} ` +
            `${terminalThemeText(severityRole, answered ? 'continuando' : 'pergunta')}` +
            `${terminalThemeText('muted', ` · ${formatLiveDuration(ageMs)}${queue}`)}` +
            '\x1b[K'
        );
    }
    if (activity.phase === 'turn') {
        if (isTurnFinalizationActivity(activity)) {
            return (
                `  ${terminalThemeText('assistant', 'LLM-B')} ` +
                `${terminalThemeText(severityRole, 'finalizando')}` +
                `${terminalThemeText('muted', ` · ${formatLiveDuration(ageMs)}${queue}`)}` +
                '\x1b[K'
            );
        }
        return (
            `  ${terminalThemeText('assistant', 'LLM-B')} ` +
            `${terminalThemeText(severityRole, `turno · ${label}`)}` +
            `${terminalThemeText('muted', ` · ${formatLiveDuration(ageMs)}${queue}`)}` +
            '\x1b[K'
        );
    }
    const target = renderLiveToolName(activity);
    if (activity.phase === 'tool') {
        const toolLabel = target || label || 'ferramenta';
        const duration = formatLiveDuration(ageMs);
        const liveBudget = resolveLiveStatusBudget(input.columns);
        const useCompactToolPhase = Boolean(activity.toolTarget) && liveBudget < 72;
        const phaseText = useCompactToolPhase ? '' : ' ferramenta';
        const fixedVisibleText = `  LLM-B${phaseText} · ${toolLabel}${progress} · ${duration}${queue}`;
        const targetBudget = Math.min(42, liveBudget - Array.from(fixedVisibleText).length - 3);
        const toolTarget = renderLiveToolTarget(activity, targetBudget);
        const targetText = toolTarget ? ` · ${toolTarget}` : '';
        return (
            `  ${terminalThemeText('assistant', 'LLM-B')} ` +
            `${useCompactToolPhase ? '' : terminalThemeText(severityRole, 'ferramenta')}` +
            `${terminalThemeText('tool', ` · ${toolLabel}`)}` +
            `${terminalThemeText('muted', `${targetText}${progress} · ${duration}${queue}`)}` +
            '\x1b[K'
        );
    }
    const targetText = target ? ` · ${target}` : '';
    const detailText = detail ? ` · ${detail}` : '';
    return (
        `  ${terminalThemeText('assistant', 'LLM-B')} ` +
        `${terminalThemeText(severityRole, `${renderLivePhaseLabel(activity.phase)} · ${label}`)}` +
        `${terminalThemeText('tool', targetText)}` +
        `${terminalThemeText('muted', `${detailText}${progress} · ${formatLiveDuration(ageMs)} · ${runtimeTail}${queue}${modelEffort ? ` · ${modelEffort}` : ''}`)}` +
        '\x1b[K'
    );
}

/**
 * Formata a projeção transitória da atividade atual dentro de uma única linha física.
 *
 * @param {{
 *     activity?: ReturnType<typeof readTerminalActivitySnapshot>;
 *     runtime?: ReturnType<typeof readTerminalRuntimeState>;
 *     stream?: ReturnType<typeof readTerminalDialogStreamMeta>;
 *     now?: number;
 *     columns?: number;
 * }} [input]
 * @returns {string}
 */
export function formatTerminalLiveStatusLine(input = {}) {
    return fitLiveStatusToSingleLine(buildTerminalLiveStatusLine(input), input.columns);
}

/**
 * @param {{
 *     activity?: ReturnType<typeof readTerminalActivitySnapshot>;
 *     runtime?: ReturnType<typeof readTerminalRuntimeState>;
 *     busy?: boolean;
 * }} [input]
 * @returns {boolean}
 */
export function shouldRenderTerminalLiveStatusLine(input = {}) {
    const activity = input.activity ?? readTerminalActivitySnapshot();
    const runtime = input.runtime ?? readTerminalRuntimeState();
    const busy = input.busy ?? getBusy();
    if (hasHumanPendingQuestion(runtime)) return false;
    if (listTerminalPendingStructuredUserInputs().length > 0) return false;
    const queueActive = Number(runtime.queueSize ?? 0) > 0;
    const runtimeActive =
        busy ||
        queueActive ||
        (activity.phase !== 'idle' && (runtime.status === 'starting' || runtime.status === 'processing'));
    if (isEmptyAfterUserInputActivity(activity) && !runtimeActive) return false;
    if (isCompletedLiveStatusActivity(activity.label) && !runtimeActive) return false;
    if (activity.phase !== 'idle') return true;
    return runtimeActive;
}

/**
 * Inicia o pulso permanente do terminal. Retorna cleanup idempotente.
 *
 * @param {{ intervalMs?: number; heartbeatMs?: number; enabled?: boolean }} [options]
 * @returns {() => void}
 */
export function setupTerminalLiveStatusLine(options = {}) {
    const enabled = options.enabled ?? TERMINAL_LIVE_STATUS_ENABLED;
    if (!enabled) return () => {};
    const intervalMs = Math.max(
        MIN_LIVE_STATUS_INTERVAL_MS,
        Math.floor(options.intervalMs ?? TERMINAL_LIVE_STATUS_INTERVAL_MS),
    );
    const heartbeatMs = Math.max(
        MIN_LIVE_STATUS_HEARTBEAT_MS,
        Math.floor(options.heartbeatMs ?? DEFAULT_LIVE_STATUS_HEARTBEAT_MS),
        intervalMs,
    );
    /** @type {NodeJS.Timeout | null} */
    let timer = null;
    /** @type {string | null} */
    let timerId = null;
    let rendered = false;
    let lastRenderedLine = '';
    let lastRenderedAt = 0;
    const resetRenderCache = () => {
        lastRenderedLine = '';
        lastRenderedAt = 0;
    };
    const render = () => {
        const activity = readTerminalActivitySnapshot();
        const runtime = readTerminalRuntimeState();
        if (!shouldRenderTerminalLiveStatusLine({ activity, runtime, busy: getBusy() })) {
            if (rendered) {
                clearInlineStatus();
                rendered = false;
                resetRenderCache();
            }
            return;
        }
        const now = Date.now();
        const line = formatTerminalLiveStatusLine({ activity, runtime, now });
        if (rendered && line === lastRenderedLine && now - lastRenderedAt < heartbeatMs) return;
        writeInlineStatus(line);
        rendered = true;
        lastRenderedLine = line;
        lastRenderedAt = now;
    };
    timerId = `terminal.live-status-line:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    timer = registerInterval(timerId, render, intervalMs);
    if (typeof timer.unref === 'function') timer.unref();
    render();
    return () => {
        if (timer) {
            if (timerId) cancelTimer(timerId);
            timer = null;
            timerId = null;
        }
        if (rendered) {
            clearInlineStatus();
            rendered = false;
            resetRenderCache();
        }
    };
}
