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
const LIVE_QUESTION_MAX_CHARS = 56;

/**
 * @param {ReturnType<typeof readTerminalRuntimeState>} runtime
 * @returns {runtime is ReturnType<typeof readTerminalRuntimeState> & { pendingQuestion: NonNullable<ReturnType<typeof readTerminalRuntimeState>['pendingQuestion']> }}
 */
function hasHumanPendingQuestion(runtime) {
    return runtime.status === 'waiting_for_input' && runtime.pendingQuestionKind === 'question' && Boolean(runtime.pendingQuestion);
}

/**
 * @param {string | null | undefined} value
 * @param {number} max
 * @returns {string}
 */
function compactLiveStatusText(value, max) {
    const text = String(value ?? '')
        .replace(/\b(?:chatcmpl-tool|toolu|call)_[a-z0-9_-]+\b/giu, 'id interno')
        .replace(/\bchatcmpl-tool-[a-z0-9-]+\b/giu, 'id interno')
        .replace(/\bturnId=\d+\b/giu, 'turno concluído')
        .replace(/\s+/g, ' ')
        .trim();
    return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * @param {string} detail
 * @returns {string | null}
 */
function extractNoDeltaStatus(detail) {
    const match = detail.match(/(?<elapsed>\d+(?:s|m\d{2}s|h\d{2}m)?)\s+sem delta(?: visível)?/iu);
    const elapsed = match?.groups?.['elapsed'] ?? null;
    return elapsed ? `${elapsed} sem delta` : null;
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
    return `${status}:${loop}`;
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
 * @param {{
 *     activity?: ReturnType<typeof readTerminalActivitySnapshot>;
 *     runtime?: ReturnType<typeof readTerminalRuntimeState>;
 *     stream?: ReturnType<typeof readTerminalDialogStreamMeta>;
 *     now?: number;
 * }} [input]
 * @returns {string}
 */
export function formatTerminalLiveStatusLine(input = {}) {
    const now = input.now ?? Date.now();
    const activity = input.activity ?? readTerminalActivitySnapshot();
    const runtime = input.runtime ?? readTerminalRuntimeState();
    const stream = input.stream ?? readTerminalDialogStreamMeta();
    const model = stream?.model || runtime.model || '-';
    const effort = stream?.reasoningEffort || runtime.reasoningEffort || '-';
    if (hasHumanPendingQuestion(runtime)) {
        const questionText = compactLiveStatusText(runtime.pendingQuestion.question ?? 'pergunta pendente', LIVE_QUESTION_MAX_CHARS);
        const choices = Array.isArray(runtime.pendingQuestion.choices) ? runtime.pendingQuestion.choices : [];
        const choiceText = choices.length > 0 ? ` · opções=${choices.join('|')}` : '';
        const queue = Number(runtime.queueSize ?? 0) > 0 ? ` · fila=${runtime.queueSize}` : '';
        return (
            `  ${terminalThemeText('thinking', '⟲ LLM-B')} ` +
            `${terminalThemeText('question', 'ASK')}` +
            `${terminalThemeText('muted', ` · ${questionText}${choiceText} · ${runtime.dialogLoopActive ? 'loop' : 'noloop'}${queue}`)}` +
            '\x1b[K'
        );
    }
    const structuredInputs = listTerminalPendingStructuredUserInputs();
    const structuredInput = structuredInputs.at(0) ?? null;
    if (structuredInput) {
        const questionText = compactLiveStatusText(
            structuredInput.question ?? 'input humano pendente',
            LIVE_QUESTION_MAX_CHARS,
        );
        const choices = Array.isArray(structuredInput.choices) ? structuredInput.choices : [];
        const choiceText = choices.length > 0 ? ` · opções=${choices.join('|')}` : '';
        const queue = structuredInputs.length > 1 ? ` · fila=${structuredInputs.length}` : '';
        return (
            `  ${terminalThemeText('thinking', '⟲ LLM-B')} ` +
            `${terminalThemeText('question', 'INPUT')}` +
            `${terminalThemeText('muted', ` · ${questionText}${choiceText}${queue}`)}` +
            '\x1b[K'
        );
    }
    const ageMs = Math.max(0, now - activity.startedAt);
    const detail = compactLiveStatusText(activity.detail ?? activity.toolName ?? '', LIVE_DETAIL_MAX_CHARS);
    const progress = activity.progress !== null ? ` · ${activity.progress}%` : '';
    const loop = runtime.dialogLoopActive ? 'loop' : 'noloop';
    const queue = Number(runtime.queueSize ?? 0) > 0 ? ` · fila=${runtime.queueSize}` : '';
    const displayStatus =
        activity.phase === 'idle' && Number(runtime.queueSize ?? 0) === 0 && runtime.status === 'processing'
            ? 'idle'
            : (runtime.status ?? '-');
    const severityRole = activity.severity === 'error' ? 'error' : activity.severity === 'warn' ? 'warn' : 'muted';
    const runtimeTail = compactRuntimeStatus(displayStatus, loop);
    const noDeltaStatus = activity.phase === 'thinking' ? extractNoDeltaStatus(activity.detail ?? '') : null;
    if (noDeltaStatus) {
        return (
            `  ${terminalThemeText('thinking', '⟲ LLM-B')} ` +
            `${terminalThemeText(severityRole, 'thinking')}` +
            `${terminalThemeText('muted', ` · ${noDeltaStatus} · ${model}/${effort} · ${runtimeTail}${queue}`)}` +
            '\x1b[K'
        );
    }
    const label = compactLiveStatusText(activity.label, LIVE_LABEL_MAX_CHARS);
    if (activity.phase === 'turn') {
        return (
            `  ${terminalThemeText('thinking', '⟲ LLM-B')} ` +
            `${terminalThemeText(severityRole, `turn · ${label}`)}` +
            `${terminalThemeText('muted', ` · ${formatLiveDuration(ageMs)} · ${model}/${effort} · ${runtimeTail}${queue}`)}` +
            '\x1b[K'
        );
    }
    const target = activity.toolName ? ` · ${compactLiveStatusText(activity.toolName, 24)}` : '';
    const detailText = detail ? ` · ${detail}` : '';
    return (
        `  ${terminalThemeText('thinking', '⟲ LLM-B')} ` +
        `${terminalThemeText(severityRole, `${activity.phase}/${label}`)}` +
        `${terminalThemeText('tool', target)}` +
        `${terminalThemeText('muted', `${detailText}${progress} · ${formatLiveDuration(ageMs)} · ${model}/${effort} · ${runtimeTail}${queue}`)}` +
        '\x1b[K'
    );
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
    if (hasHumanPendingQuestion(runtime)) return true;
    if (listTerminalPendingStructuredUserInputs().length > 0) return true;
    const queueActive = Number(runtime.queueSize ?? 0) > 0;
    const runtimeActive =
        busy ||
        queueActive ||
        (activity.phase !== 'idle' && (runtime.status === 'starting' || runtime.status === 'processing'));
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
