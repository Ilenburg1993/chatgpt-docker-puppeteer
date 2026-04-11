// @ts-check
/**
 * src/copilot/tools/todo/todo-schema.js
 *
 * Schemas Zod, tipos JSDoc e constantes do sistema de tarefas.
 *
 * @module copilot/tools/todo/todo-schema
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Constantes e configuração
// ---------------------------------------------------------------------------

/** Versão do schema de dados */
export const SCHEMA_VERSION = 1;

/** Limite máximo de tarefas retornadas em listagens */
export const MAX_LIST = 200;

// ---------------------------------------------------------------------------
// Tipos (JSDoc)
// ---------------------------------------------------------------------------

/**
 * Status possíveis de uma tarefa.
 *
 * @typedef {'todo' | 'in_progress' | 'done' | 'cancelled' | 'blocked'} TodoStatus
 */

/**
 * Prioridades possíveis de uma tarefa.
 *
 * @typedef {'critical' | 'high' | 'medium' | 'low' | 'none'} TodoPriority
 */

/**
 * Estrutura de uma tarefa individual.
 *
 * @typedef {Object} TodoItem
 * @property {string} id - ID único (8 chars alfanuméricos)
 * @property {string} title - Título obrigatório
 * @property {string} description - Descrição detalhada (pode ser string vazia)
 * @property {TodoStatus} status - Status atual
 * @property {TodoPriority} priority - Prioridade
 * @property {string[]} tags - Lista de tags/labels
 * @property {string | null} dueDate - Data de vencimento ISO 8601 (ou null)
 * @property {string | null} parentId - ID da tarefa pai (ou null se raiz)
 * @property {string[]} subtaskIds - IDs das subtarefas (filhos diretos)
 * @property {string} notes - Notas adicionais livres
 * @property {string} createdAt - ISO 8601 timestamp de criação
 * @property {string} updatedAt - ISO 8601 timestamp de última atualização
 * @property {string | null} completedAt - ISO 8601 timestamp de conclusão (ou null)
 * @property {string | null} completedBy - Identificador de quem concluiu a tarefa (agente, usuário, etc.) — UPG-PROP-05
 * @property {Record<string, unknown>} metadata - Campos extensíveis livres
 */

/**
 * Root do arquivo de dados.
 *
 * @typedef {Object} TodoStore
 * @property {number} version - Versão do schema
 * @property {Record<string, TodoItem>} tasks - Mapa id → tarefa
 */

// ---------------------------------------------------------------------------
// Transições de status válidas
// ---------------------------------------------------------------------------

/**
 * Transições de status permitidas: de → [para...]
 *
 * @type {Record<TodoStatus, TodoStatus[]>}
 */
export const VALID_TRANSITIONS = {
    todo: ['in_progress', 'cancelled', 'blocked'],
    in_progress: ['todo', 'done', 'cancelled', 'blocked'],
    done: ['todo'], // reabrir apenas
    cancelled: ['todo'], // reabrir apenas
    blocked: ['todo', 'in_progress'],
};

// ---------------------------------------------------------------------------
// Zod schemas reutilizáveis
// ---------------------------------------------------------------------------

export const zStatus = z.enum(['todo', 'in_progress', 'done', 'cancelled', 'blocked']);
export const zPriority = z.enum(['critical', 'high', 'medium', 'low', 'none']);
export const zId = z.string().min(1).max(64).describe('ID da tarefa (8 chars gerado automaticamente)');

/**
 * Mapa de ordenação de prioridades (menor = mais importante). Usado como chave de sort em listagens e stats.
 *
 * @type {Record<TodoPriority | string, number>}
 */
export const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3, none: 4 };

// ---------------------------------------------------------------------------
