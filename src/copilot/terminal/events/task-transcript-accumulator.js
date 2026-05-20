// @ts-check
/**
 * Acumulador elástico de deltas textuais de tarefas internas.
 *
 * `task.delta` é um sinal de streaming; ele pode alimentar a linha viva, mas também precisa virar histórico persistente
 * quando representa fala visível da LLM-B fora de um turno explícito. Este módulo mantém esse estado isolado do wiring
 * de eventos.
 *
 * @module copilot/terminal/events/task-transcript-accumulator
 */

import { getBusy } from '../../presentation/state/index.js';
import { renderTerminalAssistantTranscript } from './assistant-transcript-renderer.js';

const DEFAULT_TASK_TRANSCRIPT_CATASTROPHIC_CHARS = 32 * 1024 * 1024;
const INTERNAL_TASK_KEY = 'internal-task';

/**
 * @typedef {{
 *     content: string;
 *     truncated: boolean;
 *     seenWhileBusy: boolean;
 *     liveRendered: boolean;
 * }} TaskTranscriptEntry
 */

/**
 * @param {string | null | undefined} taskId
 * @returns {string}
 */
export function getTaskTranscriptKey(taskId) {
    return typeof taskId === 'string' && taskId.trim().length > 0 ? taskId.trim() : INTERNAL_TASK_KEY;
}

/**
 * @param {string} taskKey
 * @returns {boolean}
 */
export function isInternalTaskTranscriptKey(taskKey) {
    return taskKey === INTERNAL_TASK_KEY;
}

/**
 * @param {string} taskKey
 * @returns {string | null}
 */
function taskKeyToId(taskKey) {
    return isInternalTaskTranscriptKey(taskKey) ? null : taskKey;
}

/**
 * @param {{
 *     maxChars?: number;
 *     isBusy?: () => boolean;
 *     renderTranscript?: typeof renderTerminalAssistantTranscript;
 * }} [options]
 * @returns {{
 *     record: (taskId: string | null | undefined, chunk: string) => void;
 *     markLiveRendered: (taskId: string | null | undefined) => void;
 *     flush: (taskId: string | null | undefined, status: 'completed' | 'error', reason: string) => boolean;
 *     flushAll: (status: 'completed' | 'error', reason: string) => string[];
 *     delete: (taskId: string | null | undefined) => void;
 *     size: () => number;
 * }}
 */
export function createTaskTranscriptAccumulator(options = {}) {
    const maxChars = Math.max(1, Math.floor(options.maxChars ?? DEFAULT_TASK_TRANSCRIPT_CATASTROPHIC_CHARS));
    const isBusy = options.isBusy ?? getBusy;
    const renderTranscript = options.renderTranscript ?? renderTerminalAssistantTranscript;
    /** @type {Map<string, TaskTranscriptEntry>} */
    const entries = new Map();

    /**
     * @param {string | null | undefined} taskId
     * @param {string} chunk
     * @returns {void}
     */
    function record(taskId, chunk) {
        const taskKey = getTaskTranscriptKey(taskId);
        const entry = entries.get(taskKey) ?? { content: '', truncated: false, seenWhileBusy: false, liveRendered: false };
        entry.seenWhileBusy = entry.seenWhileBusy || isBusy();
        if (entry.content.length < maxChars) {
            const remaining = maxChars - entry.content.length;
            entry.content += chunk.slice(0, remaining);
            if (chunk.length > remaining) entry.truncated = true;
        } else {
            entry.truncated = true;
        }
        entries.set(taskKey, entry);
    }

    /**
     * @param {string | null | undefined} taskId
     * @returns {void}
     */
    function markLiveRendered(taskId) {
        const taskKey = getTaskTranscriptKey(taskId);
        const entry = entries.get(taskKey) ?? { content: '', truncated: false, seenWhileBusy: false, liveRendered: false };
        entry.liveRendered = true;
        entries.set(taskKey, entry);
    }

    /**
     * @param {string | null | undefined} taskId
     * @param {'completed' | 'error'} status
     * @param {string} reason
     * @returns {boolean}
     */
    function flush(taskId, status, reason) {
        const taskKey = getTaskTranscriptKey(taskId);
        const entry = entries.get(taskKey);
        if (!entry) return false;
        entries.delete(taskKey);
        const content = entry.content.trim();
        if (!content || entry.seenWhileBusy || entry.liveRendered) return false;
        return renderTranscript({
            content,
            title: status === 'error' ? 'Saída de tarefa falhada' : 'Saída de tarefa',
            source: 'agent/task.delta',
            status,
            detail: `${reason}${taskId ? ` · task=${taskId}` : ''}`,
            truncated: entry.truncated,
        });
    }

    return {
        record,
        markLiveRendered,
        flush,
        flushAll: (status, reason) => {
            const processed = [];
            for (const taskKey of [...entries.keys()]) {
                flush(taskKeyToId(taskKey), status, reason);
                processed.push(taskKey);
            }
            return processed;
        },
        delete: (taskId) => {
            entries.delete(getTaskTranscriptKey(taskId));
        },
        size: () => entries.size,
    };
}
