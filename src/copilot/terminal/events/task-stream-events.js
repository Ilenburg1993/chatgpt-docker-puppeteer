// @ts-check
/**
 * src/copilot/terminal/events/task-stream-events.js
 *
 * Tradução do streaming de tarefas internas do runtime (`task.*`) para stdout/SSE local do terminal.
 *
 * @module copilot/terminal/task-stream-events
 */

import {
    EMITTER_ASSISTANT_TURN_END,
    EMITTER_TASK_COMPLETED,
    EMITTER_TASK_DELTA,
    EMITTER_TASK_ERROR,
    EMITTER_TASK_REASONING,
} from '#copilot/events';
import {
    appendThinkingHistoryChunk,
    finalizeThinkingHistoryEntry,
    getBusy,
    getShowThinking,
} from '../../presentation/state/index.js';
import { println } from '../dialog/index.js';
import { buildTerminalTaskThinkingId, formatTerminalThinkingRef, recordTerminalActivity } from '../state/events/index.js';
import {
    finalizeAllPublicAssistantStreams,
    finalizePublicAssistantStream,
    renderPublicAssistantStreamDelta,
} from './public-assistant-stream.js';
import {
    createTaskTranscriptAccumulator,
    getTaskTranscriptKey,
    isInternalTaskTranscriptKey,
} from './task-transcript-accumulator.js';

/**
 * @typedef {{
 *     on: (event: string, handler: (...args: any[]) => void) => void;
 *     off: (event: string, handler: (...args: any[]) => void) => void;
 * }} AgentEventHost
 */

/**
 * @param {{ agent: AgentEventHost }} input
 * @returns {() => void}
 */
export function setupTerminalTaskStreamListeners({ agent }) {
    const TASK_DELTA_ACTIVITY_THROTTLE_MS = 300;
    /** @type {Map<string, number>} */
    const taskThinkingStarts = new Map();
    /** @type {Set<string>} */
    const openThinkingIds = new Set();
    /** @type {Map<string, { chunks: number; chars: number }>} */
    const taskDeltaStats = new Map();
    /** @type {Map<string, number>} */
    const taskLastDeltaActivityAt = new Map();
    /** @type {Set<string>} */
    const taskDeltasSeenWhileBusy = new Set();
    const taskTranscripts = createTaskTranscriptAccumulator();
    let anonymousTaskThinkingSeq = 0;
    /** @type {string | null} */
    let activeAnonymousTaskThinkingId = null;

    /**
     * @param {string | null | undefined} taskId
     * @returns {string}
     */
    const getThinkingId = (taskId) => {
        if (typeof taskId === 'string' && taskId.trim().length > 0) {
            return buildTerminalTaskThinkingId(taskId, 1);
        }
        if (!activeAnonymousTaskThinkingId) {
            anonymousTaskThinkingSeq += 1;
            activeAnonymousTaskThinkingId = buildTerminalTaskThinkingId(null, anonymousTaskThinkingSeq);
        }
        return activeAnonymousTaskThinkingId;
    };

    /**
     * @param {string | null | undefined} taskId
     * @returns {string[]}
     */
    const resolveOpenThinkingIds = (taskId) => {
        const candidates = [taskId !== undefined ? getThinkingId(taskId) : null].filter(Boolean);
        const matched = /** @type {string[]} */ (candidates).filter((id) => openThinkingIds.has(id));
        return matched.length > 0 ? [...new Set(matched)] : [...openThinkingIds];
    };

    /**
     * @param {string | null | undefined} taskId
     * @param {'completed' | 'error'} status
     * @returns {void}
     */
    const finalizeTaskThinkings = (taskId, status) => {
        const ids = resolveOpenThinkingIds(taskId);
        for (const thinkingId of ids) {
            const thinkingStartedAt = taskThinkingStarts.get(thinkingId);
            const thinkingEntry = finalizeThinkingHistoryEntry(thinkingId, {
                durationMs: thinkingStartedAt ? Date.now() - thinkingStartedAt : null,
                status,
            });
            if (thinkingEntry && getShowThinking()) {
                const color = status === 'error' ? '\x1b[31m' : '\x1b[90m';
                const label = status === 'error' ? 'falhou' : 'concluído';
                const thinkingRef = formatTerminalThinkingRef(thinkingEntry.id);
                println(
                    `  ${color}└── task thinking #${thinkingRef} ${label} · ${(Number(thinkingEntry.durationMs ?? 0) / 1000).toFixed(1)}s · ${thinkingEntry.chars} chars\x1b[0m`,
                );
                println(`  \x1b[90m    /thinking show ${thinkingRef}  ·  /thinking latest\x1b[0m`);
            }
            taskThinkingStarts.delete(thinkingId);
            openThinkingIds.delete(thinkingId);
            if (activeAnonymousTaskThinkingId === thinkingId) {
                activeAnonymousTaskThinkingId = null;
            }
        }
    };

    /**
     * @param {unknown} value
     * @returns {string}
     */
    const stringOrEmpty = (value) => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : '');

    /**
     * @param {{ taskId?: string | null } & Record<string, unknown>} evt
     * @returns {string}
     */
    const getTaskKey = (evt) => {
        const taskId = stringOrEmpty(evt.taskId);
        if (taskId) return getTaskTranscriptKey(taskId);
        const streamId = stringOrEmpty(evt['streamId']) || stringOrEmpty(evt['messageId']) || stringOrEmpty(evt['responseId']);
        if (streamId) return getTaskTranscriptKey(`stream:${streamId}`);
        return getTaskTranscriptKey(null);
    };

    /**
     * Task deltas são transitórios durante o streaming, mas não podem desaparecer. Enquanto há um turno explícito em
     * andamento, `turn-display.js` já renderiza a resposta; fora desse caminho, acumulamos o conteúdo e imprimimos um
     * transcript estável no fechamento da tarefa/turno.
     *
     * @param {{ taskId?: string | null } & Record<string, unknown>} evt
     * @param {string} chunk
     * @returns {void}
     */
    const recordTaskDelta = (evt, chunk) => {
        const taskKey = getTaskKey(evt);
        if (getBusy()) {
            taskDeltasSeenWhileBusy.add(taskKey);
        }
        const current = taskDeltaStats.get(taskKey) ?? { chunks: 0, chars: 0 };
        taskDeltaStats.set(taskKey, {
            chunks: current.chunks + 1,
            chars: current.chars + chunk.length,
        });
        taskTranscripts.record(isInternalTaskTranscriptKey(taskKey) ? null : taskKey, chunk);
    };

    const onTaskDelta = (/** @type {{ taskId?: string | null; chunk?: string } & Record<string, unknown>} */ evt) => {
        const chunk = evt?.chunk ?? '';
        if (!chunk) return;
        const taskKey = getTaskKey(evt);
        recordTaskDelta(evt, chunk);
        if (getBusy()) return;
        const { liveRendered } = renderPublicAssistantStreamDelta({ ...evt, key: taskKey, chunk });
        if (liveRendered) {
            taskTranscripts.markLiveRendered(isInternalTaskTranscriptKey(taskKey) ? null : taskKey);
        }
        const now = Date.now();
        const lastAt = taskLastDeltaActivityAt.get(taskKey) ?? 0;
        if (now - lastAt < TASK_DELTA_ACTIVITY_THROTTLE_MS) {
            return;
        }
        taskLastDeltaActivityAt.set(taskKey, now);
        const stats = taskDeltaStats.get(taskKey) ?? { chunks: 0, chars: 0 };
        recordTerminalActivity('task', 'Executando tarefa interna', {
            detail: `delta${evt.taskId ? ` (${evt.taskId})` : ''} · ${stats.chunks} chunks · ${stats.chars} chars`,
            source: 'agent',
            recordHistory: false,
        });
    };

    const onTaskReasoning = (/** @type {{ taskId?: string | null; text?: string; chunk?: string }} */ evt) => {
        const text = evt?.chunk ?? evt?.text ?? '';
        if (!text) return;
        const taskId = evt.taskId ?? null;
        const thinkingId = getThinkingId(taskId);
        recordTerminalActivity('task', 'Raciocinando tarefa interna', {
            detail: taskId ? `task ${taskId}` : 'task interna',
            source: 'agent',
            recordHistory: false,
        });
        appendThinkingHistoryChunk({
            id: thinkingId,
            source: 'task',
            title: taskId ? `Task ${taskId}` : 'Task interna',
            chunk: text,
            taskId,
        });
        if (!taskThinkingStarts.has(thinkingId)) {
            taskThinkingStarts.set(thinkingId, Date.now());
            openThinkingIds.add(thinkingId);
            if (getShowThinking()) {
                const thinkingRef = formatTerminalThinkingRef(thinkingId);
                println(`  \x1b[33m↳ task thinking capturado\x1b[0m \x1b[90m(${taskId ?? 'task interna'})\x1b[0m`);
                println(`  \x1b[90m    /thinking show ${thinkingRef}  ·  /thinking latest\x1b[0m`);
            }
        }
    };

    const onTaskCompleted = (/** @type {{ taskId?: string | null } & Record<string, unknown>} */ evt = {}) => {
        const taskKey = getTaskKey(evt);
        const stats = taskDeltaStats.get(taskKey) ?? { chunks: 0, chars: 0 };
        const { liveRendered } = finalizePublicAssistantStream({ key: taskKey });
        if (liveRendered) {
            taskTranscripts.markLiveRendered(isInternalTaskTranscriptKey(taskKey) ? null : taskKey);
        }
        const wasAlreadyRenderedByTurn = taskDeltasSeenWhileBusy.has(taskKey);
        const hadVisiblePayload = (stats.chunks > 0 || stats.chars > 0) && !wasAlreadyRenderedByTurn;
        recordTerminalActivity('task', 'Tarefa interna concluída', {
            detail: `${stats.chunks} chunks · ${stats.chars} chars`,
            source: 'agent',
            recordHistory: hadVisiblePayload,
            updateCurrent: hadVisiblePayload,
        });
        finalizeTaskThinkings(evt.taskId ?? undefined, 'completed');
        taskTranscripts.flush(isInternalTaskTranscriptKey(taskKey) ? null : taskKey, 'completed', 'task.completed');
        taskDeltaStats.delete(taskKey);
        taskLastDeltaActivityAt.delete(taskKey);
        taskDeltasSeenWhileBusy.delete(taskKey);
    };

    const onTaskError = (/** @type {{ taskId?: string | null } & Record<string, unknown>} */ evt = {}) => {
        const taskKey = getTaskKey(evt);
        const stats = taskDeltaStats.get(taskKey) ?? { chunks: 0, chars: 0 };
        const { liveRendered } = finalizePublicAssistantStream({ key: taskKey });
        if (liveRendered) {
            taskTranscripts.markLiveRendered(isInternalTaskTranscriptKey(taskKey) ? null : taskKey);
        }
        recordTerminalActivity('error', 'Tarefa interna falhou', {
            detail: `${stats.chunks} chunks · ${stats.chars} chars`,
            source: 'agent',
            severity: 'error',
        });
        finalizeTaskThinkings(evt.taskId ?? undefined, 'error');
        taskTranscripts.flush(isInternalTaskTranscriptKey(taskKey) ? null : taskKey, 'error', 'task.error');
        taskDeltaStats.delete(taskKey);
        taskLastDeltaActivityAt.delete(taskKey);
        taskDeltasSeenWhileBusy.delete(taskKey);
    };

    const onAssistantTurnEnd = () => {
        for (const taskKey of finalizeAllPublicAssistantStreams()) {
            taskTranscripts.markLiveRendered(isInternalTaskTranscriptKey(taskKey) ? null : taskKey);
        }
        for (const taskKey of taskTranscripts.flushAll('completed', 'assistant.turn_end')) {
            taskDeltaStats.delete(taskKey);
            taskLastDeltaActivityAt.delete(taskKey);
            taskDeltasSeenWhileBusy.delete(taskKey);
        }
    };

    agent.on(EMITTER_ASSISTANT_TURN_END, onAssistantTurnEnd);
    agent.on(EMITTER_TASK_DELTA, onTaskDelta);
    agent.on(EMITTER_TASK_REASONING, onTaskReasoning);
    agent.on(EMITTER_TASK_COMPLETED, onTaskCompleted);
    agent.on(EMITTER_TASK_ERROR, onTaskError);

    return () => {
        agent.off(EMITTER_ASSISTANT_TURN_END, onAssistantTurnEnd);
        agent.off('task.delta', onTaskDelta);
        agent.off('task.reasoning', onTaskReasoning);
        agent.off('task.completed', onTaskCompleted);
        agent.off('task.error', onTaskError);
    };
}
