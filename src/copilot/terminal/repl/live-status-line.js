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
import { getBusy } from '../../presentation/runtime-ui-state-store.js';
import { clearInlineStatus, writeInlineStatus } from '../dialog/output.js';
import { readTerminalDialogStreamMeta, readTerminalRuntimeState } from '../frontend/gateways/agent-runtime.js';
import { readTerminalActivitySnapshot } from '../state/activity-state.js';
import { terminalThemeText } from '../state/ui-theme.js';

const MIN_LIVE_STATUS_INTERVAL_MS = 250;
const MAX_LIVE_DETAIL_CHARS = 96;

/**
 * @param {string | null | undefined} value
 * @param {number} max
 * @returns {string}
 */
function compactLiveStatusText(value, max) {
    const text = String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim();
    return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
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
    const ageMs = Math.max(0, now - activity.startedAt);
    const detail = compactLiveStatusText(activity.detail ?? activity.toolName ?? '', MAX_LIVE_DETAIL_CHARS);
    const progress = activity.progress !== null ? ` · ${activity.progress}%` : '';
    const loop = runtime.dialogLoopActive ? 'loop' : 'noloop';
    const queue = Number(runtime.queueSize ?? 0) > 0 ? ` · fila=${runtime.queueSize}` : '';
    const severityRole = activity.severity === 'error' ? 'error' : activity.severity === 'warn' ? 'warn' : 'muted';
    const target = activity.toolName ? ` · ${activity.toolName}` : '';
    const detailText = detail ? ` · ${detail}` : '';
    return (
        `  ${terminalThemeText('thinking', '⟲ LLM-B')} ` +
        `${terminalThemeText(severityRole, `${activity.phase}/${activity.label}`)}` +
        `${terminalThemeText('tool', target)}` +
        `${terminalThemeText('muted', `${detailText}${progress} · ${formatLiveDuration(ageMs)} · ${model}/${effort} · ${runtime.status ?? '-'}:${loop}${queue}`)}` +
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
    const runtimeActive =
        busy || runtime.status === 'starting' || runtime.status === 'processing' || Number(runtime.queueSize ?? 0) > 0;
    if (isCompletedLiveStatusActivity(activity.label) && !runtimeActive) return false;
    if (activity.phase !== 'idle') return true;
    return runtimeActive;
}

/**
 * Inicia o pulso permanente do terminal. Retorna cleanup idempotente.
 *
 * @param {{ intervalMs?: number; enabled?: boolean }} [options]
 * @returns {() => void}
 */
export function setupTerminalLiveStatusLine(options = {}) {
    const enabled = options.enabled ?? TERMINAL_LIVE_STATUS_ENABLED;
    if (!enabled) return () => {};
    const intervalMs = Math.max(
        MIN_LIVE_STATUS_INTERVAL_MS,
        Math.floor(options.intervalMs ?? TERMINAL_LIVE_STATUS_INTERVAL_MS),
    );
    /** @type {NodeJS.Timeout | null} */
    let timer = null;
    let rendered = false;
    const render = () => {
        const activity = readTerminalActivitySnapshot();
        const runtime = readTerminalRuntimeState();
        if (!shouldRenderTerminalLiveStatusLine({ activity, runtime, busy: getBusy() })) {
            if (rendered) {
                clearInlineStatus();
                rendered = false;
            }
            return;
        }
        writeInlineStatus(formatTerminalLiveStatusLine({ activity, runtime, now: Date.now() }));
        rendered = true;
    };
    timer = setInterval(render, intervalMs);
    if (typeof timer.unref === 'function') timer.unref();
    render();
    return () => {
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
        if (rendered) {
            clearInlineStatus();
            rendered = false;
        }
    };
}
