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
import { recordTerminalActivity } from './activity-state.js';
import { println } from './dialog.js';
import { getShowStreaming } from './state.js';

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
    /** @type {string | null} */
    let activeTaskId = null;

    /**
     * @param {string | null} taskId
     */
    const startTaskBlock = (taskId) => {
        if (activeTaskId) return;
        activeTaskId = taskId ?? '__anonymous__';
        if (!getShowStreaming()) return;
        println('');
        println(`  \x1b[90m┌── task streaming${taskId ? ` (${taskId})` : ''} ──┐\x1b[0m`);
        process.stdout.write('  \x1b[90m│\x1b[0m  ');
    };

    /**
     * @param {string} text
     */
    const writeTaskChunk = (text) => {
        if (!getShowStreaming()) return;
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (i > 0) process.stdout.write('\n  \x1b[90m│\x1b[0m  ');
            process.stdout.write(/** @type {string} */ (lines[i]));
        }
    };

    const onTaskDelta = (/** @type {{ taskId?: string | null; chunk?: string }} */ evt) => {
        const chunk = evt?.chunk ?? '';
        if (!chunk) return;
        recordTerminalActivity('task', 'Executando tarefa interna', {
            detail: `delta${evt.taskId ? ` (${evt.taskId})` : ''}`,
            source: 'agent',
            recordHistory: false,
        });
        startTaskBlock(evt.taskId ?? null);
        writeTaskChunk(chunk);
    };

    const onTaskReasoning = (/** @type {{ taskId?: string | null; text?: string }} */ evt) => {
        const text = evt?.text ?? '';
        if (!text) return;
        recordTerminalActivity('task', 'Raciocinando tarefa interna', {
            detail: evt.taskId ? `task ${evt.taskId}` : 'task interna',
            source: 'agent',
            recordHistory: false,
        });
        startTaskBlock(evt.taskId ?? null);
        writeTaskChunk(`\x1b[2m${text}\x1b[22m`);
    };

    const onTaskCompleted = () => {
        recordTerminalActivity('task', 'Tarefa interna concluída', {
            source: 'agent',
        });
        if (activeTaskId) {
            process.stdout.write('\n');
            if (getShowStreaming()) println('  \x1b[90m└── task complete ───┘\x1b[0m');
            activeTaskId = null;
        }
    };

    const onTaskError = () => {
        recordTerminalActivity('error', 'Tarefa interna falhou', {
            source: 'agent',
            severity: 'error',
        });
        if (activeTaskId) {
            process.stdout.write('\n');
            if (getShowStreaming()) println('  \x1b[31m└── task error ──────┘\x1b[0m');
            activeTaskId = null;
        }
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
