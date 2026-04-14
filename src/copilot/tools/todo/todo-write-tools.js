// @ts-check
/**
 * src/copilot/tools/todo/todo-write-tools.js
 *
 * Tools de escrita destrutiva: todo_create, todo_set_status, todo_delete.
 *
 * @module copilot/tools/todo/todo-write-tools
 * @see EventBus
 */

import { createTool } from '#copilot/sdk';
import { z } from 'zod';
import { log } from '../logger.js';
import { VALID_TRANSITIONS, createTask, now, sanitize, withStore, zId, zPriority, zStatus } from './store.js';

// ---------------------------------------------------------------------------
// Tool: todo_create
// ---------------------------------------------------------------------------

/**
 * Tool: todo_create — cria uma nova tarefa com metadados ricos.
 */
export const todoCreateTool = createTool({
    name: 'todo_create',
    description:
        'Cria uma nova tarefa no sistema de gerenciamento profundo. ' +
        'Suporta título, descrição detalhada, prioridade (critical/high/medium/low/none), ' +
        'tags, data de vencimento, notas livres, e subtarefas via parentId. ' +
        'Retorna o objeto completo da tarefa criada com seu ID gerado.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<any>} */ (
        /** @type {unknown} */ (
            z.object({
                title: z.string().min(1).max(500).describe('Título da tarefa (obrigatório)'),
                description: z.string().max(5000).optional().describe('Descrição detalhada da tarefa'),
                priority: zPriority
                    .optional()
                    .default('medium')
                    .describe('Prioridade: critical | high | medium | low | none'),
                tags: z
                    .array(z.string().max(100))
                    .max(20)
                    .optional()
                    .default([])
                    .describe('Lista de tags/labels para categorização'),
                due_date: z
                    .string()
                    .datetime({ offset: true })
                    .optional()
                    .describe('Data de vencimento ISO 8601 (ex: 2026-04-01T18:00:00Z)'),
                parent_id: z.string().optional().describe('ID da tarefa pai para criar como subtarefa'),
                notes: z.string().max(10000).optional().describe('Notas livres associadas à tarefa'),
                metadata: z
                    .record(z.string(), z.unknown())
                    .optional()
                    .describe('Campos extras extensíveis (JSON livre)'),
            })
        )
    ),
    handler: async (
        /**
         * @type {{
         *     title: string;
         *     description?: string;
         *     priority?: import('./store.js').TodoPriority;
         *     tags?: string[];
         *     due_date?: string;
         *     parent_id?: string;
         *     notes?: string;
         *     metadata?: Record<string, unknown>;
         * }}
         */ args,
    ) => {
        return withStore(async (store) => {
            const result = createTask(store, {
                title: args.title,
                ...(args.description !== undefined && { description: args.description }),
                ...(args.priority !== undefined && { priority: args.priority }),
                ...(args.tags !== undefined && { tags: args.tags }),
                ...(args.due_date !== undefined && { dueDate: args.due_date }),
                ...(args.parent_id !== undefined && { parentId: args.parent_id }),
                ...(args.notes !== undefined && { notes: args.notes }),
                ...(args.metadata !== undefined && { metadata: args.metadata }),
            });

            if ('error' in result) return { success: false, error: result.error };

            log(
                'INFO',
                `[todo_create] Tarefa criada id=${result.task.id} title=${result.task.title} priority=${result.task.priority}`,
            );
            return { success: true, task: sanitize(result.task) };
        });
    },
});

// ---------------------------------------------------------------------------
// Tool: todo_set_status
// ---------------------------------------------------------------------------

/**
 * Tool: todo_set_status — transiciona o status de uma tarefa com validação.
 */
export const todoSetStatusTool = createTool({
    name: 'todo_set_status',
    description:
        'Altera o status de uma tarefa seguindo a máquina de estados validada. ' +
        'Transições válidas: todo → in_progress | cancelled | blocked; ' +
        'in_progress → todo | done | cancelled | blocked; ' +
        'done | cancelled → todo (reabrir); blocked → todo | in_progress. ' +
        'Use force: true para forçar transição fora do grafo (casos excepcionais).',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<any>} */ (
        /** @type {unknown} */ (
            z.object({
                id: zId,
                status: zStatus.describe('Novo status da tarefa'),
                force: z.boolean().optional().describe('Forçar transição mesmo fora do grafo de estados'),
                completed_by: z
                    .string()
                    .optional()
                    .describe(
                        'Identificador de quem concluiu (agente, usuário). Gravado em completedBy quando status=done.',
                    ),
            })
        )
    ),
    handler: async (
        /** @type {{ id: string; status: import('./store.js').TodoStatus; force?: boolean; completed_by?: string }} */ args,
    ) =>
        withStore(async (store) => {
            const task = store.tasks[args.id];
            if (!task) return { success: false, error: `Tarefa não encontrada: ${args.id}` };

            const current = task.status;
            const next = args.status;

            if (current === next) return { success: true, task: sanitize(task), message: 'Status já é o solicitado' };

            const allowed = VALID_TRANSITIONS[current] ?? [];
            if (!args.force && !allowed.includes(next)) {
                return {
                    success: false,
                    error: `Transição inválida: ${current} → ${next}. Permitidas: ${allowed.join(', ')}`,
                    current_status: current,
                    allowed_transitions: allowed,
                };
            }

            const ts = now();
            task.status = next;
            task.updatedAt = ts;
            if (next === 'done') {
                task.completedAt = ts;
                task.completedBy = args.completed_by ?? null;
            } else if (task.completedAt !== null) {
                task.completedAt = null;
                task.completedBy = null;
            }

            log('INFO', `[todo_set_status] Status alterado id=${args.id} from=${current} to=${next}`);
            return { success: true, task: sanitize(task), previous_status: current };
        }),
});

// ---------------------------------------------------------------------------
// Tool: todo_delete
// ---------------------------------------------------------------------------

/**
 * Tool: todo_delete — exclui uma tarefa e desvincula do pai.
 */
export const todoDeleteTool = createTool({
    name: 'todo_delete',
    description:
        'Exclui uma tarefa permanentemente. Por padrão, subtarefas são desvinculadas (tornam-se raiz). ' +
        'Com cascade: true, remove também todas as subtarefas recursivamente. ' +
        'A tarefa pai (se houver) tem a referência removida automaticamente.',
    parameters: z.object({
        id: zId,
        cascade: z
            .boolean()
            .optional()
            .default(false)
            .describe('Se true, remove subtarefas recursivamente; se false, desvincula-as'),
    }),
    handler: async (/** @type {{ id: string; cascade?: boolean }} */ args) =>
        withStore(async (store) => {
            const task = store.tasks[args.id];
            if (!task) return { success: false, error: `Tarefa não encontrada: ${args.id}` };

            const ts = now();
            const deleted = [args.id];

            // Remover referência no pai
            if (task.parentId) {
                const parent = store.tasks[task.parentId];
                if (parent) {
                    parent.subtaskIds = parent.subtaskIds.filter((id) => id !== args.id);
                    parent.updatedAt = ts;
                }
            }

            if (args.cascade) {
                const queue = [...task.subtaskIds];
                while (queue.length > 0) {
                    const childId = queue.shift();
                    if (!childId) continue;
                    const child = store.tasks[childId];
                    if (child) {
                        queue.push(...child.subtaskIds);
                        deleted.push(childId);
                        delete store.tasks[childId];
                    }
                }
            } else {
                for (const childId of task.subtaskIds) {
                    const child = store.tasks[childId];
                    if (child) {
                        child.parentId = null;
                        child.updatedAt = ts;
                    }
                }
            }

            delete store.tasks[args.id];

            const orphaned = !args.cascade && task.subtaskIds.length > 0 ? [...task.subtaskIds] : undefined;

            log(
                'INFO',
                `[todo_delete] Tarefa removida id=${args.id} cascade=${args.cascade} count=${deleted.length}${orphaned ? ` orphaned=${orphaned.join(',')}` : ''}`,
            );
            return {
                success: true,
                deleted,
                count: deleted.length,
                ...(orphaned !== undefined && { orphaned }),
            };
        }),
});
