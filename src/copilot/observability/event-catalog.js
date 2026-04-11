// @ts-check
/**
 * src/copilot/observability/event-catalog.js
 *
 * Catálogo de eventos emitidos pelo AlwaysAliveAgent + rastreamento de dead-letters (eventos emitidos sem listener).
 *
 * @module copilot/observability/event-catalog
 * @see EventBus
 */

import { defaultMetrics } from './metrics.js';

// ─── Catálogo estático ────────────────────────────────────────────────────────

/**
 * @typedef {object} CatalogEntry
 * @property {string} event - Nome do evento
 * @property {string} description - Descrição curta
 * @property {string} origin - Módulo de origem
 */

/** @type {CatalogEntry[]} */
const CATALOG = [
    { event: 'status', description: 'Status geral do agente', origin: 'always-alive' },
    { event: 'ready', description: 'Agente pronto para receber mensagens', origin: 'always-alive' },
    { event: 'error', description: 'Erro no agente', origin: 'always-alive' },
    { event: 'stopped', description: 'Sessão parada', origin: 'always-alive' },
    { event: 'before-stop', description: 'Pré-encerramento do agente', origin: 'always-alive' },
    { event: 'task.queued', description: 'Tarefa enfileirada', origin: 'always-alive' },
    { event: 'task.started', description: 'Tarefa iniciada', origin: 'always-alive' },
    { event: 'task.completed', description: 'Tarefa concluída', origin: 'always-alive' },
    { event: 'task.error', description: 'Erro na tarefa', origin: 'always-alive' },
    { event: 'task.delta', description: 'Delta incremental de tarefa', origin: 'always-alive' },
    { event: 'task.reasoning', description: 'Raciocínio da tarefa', origin: 'always-alive' },
    { event: 'question.pending', description: 'Pergunta aguardando resposta', origin: 'always-alive' },
    { event: 'question.answered', description: 'Pergunta respondida', origin: 'always-alive' },
    { event: 'dialog.ready', description: 'Dialog pronto', origin: 'dialog-engine' },
    { event: 'dialog.reply', description: 'Resposta do dialog', origin: 'dialog-engine' },
    { event: 'dialog.stopped', description: 'Dialog parado', origin: 'dialog-engine' },
    { event: 'dialog.stalled', description: 'Dialog travado', origin: 'dialog-engine' },
    { event: 'session.fatal', description: 'Erro fatal na sessão', origin: 'session' },
    { event: 'session.usage', description: 'Uso de tokens da sessão', origin: 'session' },
    { event: 'session.compaction_start', description: 'Início de compactação', origin: 'session' },
    { event: 'session.compaction_complete', description: 'Compactação concluída', origin: 'session' },
    { event: 'tool.execution_start', description: 'Execução de tool iniciada', origin: 'tool-runner' },
    { event: 'tool.execution_complete', description: 'Execução de tool concluída', origin: 'tool-runner' },
];

// ─── Dead-letter tracking ─────────────────────────────────────────────────────

/**
 * @typedef {object} DeadLetterEntry
 * @property {string} event - Nome do evento sem listener
 * @property {number} count - Vezes emitido sem listener
 * @property {number} lastTs - Timestamp da última ocorrência
 */

/** @type {Map<string, DeadLetterEntry>} */
const _deadLetters = new Map();

/**
 * Registra um evento emitido sem listeners (dead-letter).
 *
 * @param {string} event - Nome do evento
 */
export function recordDeadLetter(event) {
    const existing = _deadLetters.get(event);
    if (existing) {
        existing.count++;
        existing.lastTs = Date.now();
    } else {
        _deadLetters.set(event, { event, count: 1, lastTs: Date.now() });
    }
    defaultMetrics.recordCounter('copilot.events.dead_letter_total');
}

/**
 * Retorna o catálogo estático de eventos.
 *
 * @returns {CatalogEntry[]}
 */
export function getCatalog() {
    return [...CATALOG];
}

/**
 * Retorna as dead-letters registradas.
 *
 * @param {number} [limit=50] - Número máximo de entradas. Default is `50`
 * @returns {DeadLetterEntry[]}
 */
export function getDeadLetters(limit = 50) {
    return [..._deadLetters.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

/**
 * Limpa as dead-letters registradas.
 *
 * @returns {void}
 */
export function clearDeadLetters() {
    _deadLetters.clear();
}
