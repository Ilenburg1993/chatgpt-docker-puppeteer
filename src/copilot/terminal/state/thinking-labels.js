// @ts-check
/**
 * Labels estáveis para referências de thinking no terminal.
 *
 * O id completo continua sendo o contrato interno de lookup. Esta camada governa apenas o texto curto apresentado na
 * UX, evitando que sentinelas internas como `__anonymous__` vazem para o operador.
 *
 * @module copilot/terminal/thinking-labels
 */

const LEGACY_ANONYMOUS_TASK_SENTINEL = '__anonymous__';

/**
 * @param {string | null | undefined} id
 * @returns {string}
 */
export function formatTerminalThinkingRef(id) {
    const value = String(id ?? '').trim();
    if (!value) return 'thinking';
    if (value.includes(LEGACY_ANONYMOUS_TASK_SENTINEL)) return 'task-interna';
    if (/^task-internal-\d+$/.test(value)) return value;
    return value.length <= 12 ? value : value.slice(-12);
}

/**
 * @param {string | null | undefined} taskId
 * @param {number} sequence
 * @returns {string}
 */
export function buildTerminalTaskThinkingId(taskId, sequence) {
    const normalizedTaskId = typeof taskId === 'string' && taskId.trim().length > 0 ? taskId.trim() : null;
    if (normalizedTaskId) return `task-${normalizedTaskId}`;
    return `task-internal-${Math.max(1, Math.floor(sequence))}`;
}
