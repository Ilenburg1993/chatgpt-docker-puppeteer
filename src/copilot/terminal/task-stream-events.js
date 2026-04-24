// @ts-check
/**
 * src/copilot/terminal/task-stream-events.js
 *
 * Tradução do streaming de tarefas internas do runtime (`task.*`) para stdout/SSE local do terminal.
 *
 * @module copilot/terminal/task-stream-events
 */

import {
    EMITTER_TASK_COMPLETED,
    EMITTER_TASK_DELTA,
    EMITTER_TASK_ERROR,
    EMITTER_TASK_REASONING,
} from '#copilot/events';
import { appendThinkingHistoryChunk, finalizeThinkingHistoryEntry } from '../presentation/runtime-ui-state-store.js';
import { recordTerminalActivity } from './activity-state.js';
import { println } from './dialog/index.js';

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
    /** @type {Map<string, number>} */
    const taskThinkingStarts = new Map();
    /** @type {Set<string>} */
    const openThinkingIds = new Set();
    /** @type {Map<string, { chunks: number; chars: number }>} */
    const taskDeltaStats = new Map();

    /**
     * @param {string | null | undefined} taskId
     * @returns {string}
     */
    const getThinkingId = (taskId) => `task-${taskId ?? '__anonymous__'}`;

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
            if (thinkingEntry) {
                const color = status === 'error' ? '\x1b[31m' : '\x1b[90m';
                const label = status === 'error' ? 'falhou' : 'concluído';
                println(
                    `  ${color}└── task thinking #${thinkingEntry.id.slice(-12)} ${label} · ${(Number(thinkingEntry.durationMs ?? 0) / 1000).toFixed(1)}s · ${thinkingEntry.chars} chars\x1b[0m`,
                );
                println(`  \x1b[90m    /thinking show ${thinkingEntry.id.slice(-12)}  ·  /thinking latest\x1b[0m`);
            }
            taskThinkingStarts.delete(thinkingId);
            openThinkingIds.delete(thinkingId);
        }
    };

    /**
     * @param {string | null | undefined} taskId
     * @returns {string}
     */
    const getTaskKey = (taskId) => taskId ?? '__anonymous__';

    /**
     * Task deltas representam saída incremental de uma tarefa interna do Agent. No terminal, eles não são renderizados
     * como streaming bruto: isso evita duplicar a resposta final e preserva o prompt legível. O payload continua
     * observável por histórico/SSE/telemetria quando esses canais estiverem habilitados.
     *
     * @param {string | null | undefined} taskId
     * @param {string} chunk
     * @returns {void}
     */
    const recordTaskDelta = (taskId, chunk) => {
        const taskKey = getTaskKey(taskId);
        const current = taskDeltaStats.get(taskKey) ?? { chunks: 0, chars: 0 };
        taskDeltaStats.set(taskKey, {
            chunks: current.chunks + 1,
            chars: current.chars + chunk.length,
        });
    };

    const onTaskDelta = (/** @type {{ taskId?: string | null; chunk?: string }} */ evt) => {
        const chunk = evt?.chunk ?? '';
        if (!chunk) return;
        recordTaskDelta(evt.taskId, chunk);
        recordTerminalActivity('task', 'Executando tarefa interna', {
            detail: `delta${evt.taskId ? ` (${evt.taskId})` : ''}`,
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
            println(`  \x1b[33m↳ task thinking capturado\x1b[0m \x1b[90m(${taskId ?? 'task interna'})\x1b[0m`);
            println(`  \x1b[90m    /thinking show ${thinkingId.slice(-12)}  ·  /thinking latest\x1b[0m`);
        }
    };

    const onTaskCompleted = (/** @type {{ taskId?: string | null }} */ evt = {}) => {
        recordTerminalActivity('task', 'Tarefa interna concluída', {
            source: 'agent',
        });
        finalizeTaskThinkings(evt.taskId ?? undefined, 'completed');
        taskDeltaStats.delete(getTaskKey(evt.taskId));
    };

    const onTaskError = (/** @type {{ taskId?: string | null }} */ evt = {}) => {
        recordTerminalActivity('error', 'Tarefa interna falhou', {
            source: 'agent',
            severity: 'error',
        });
        finalizeTaskThinkings(evt.taskId ?? undefined, 'error');
        taskDeltaStats.delete(getTaskKey(evt.taskId));
    };

    agent.on(EMITTER_TASK_DELTA, onTaskDelta);
    agent.on(EMITTER_TASK_REASONING, onTaskReasoning);
    agent.on(EMITTER_TASK_COMPLETED, onTaskCompleted);
    agent.on(EMITTER_TASK_ERROR, onTaskError);

    return () => {
        agent.off('task.delta', onTaskDelta);
        agent.off('task.reasoning', onTaskReasoning);
        agent.off('task.completed', onTaskCompleted);
        agent.off('task.error', onTaskError);
    };
}
