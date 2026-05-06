// @ts-check
/**
 * src/copilot/tools/todo/bulk-tools.js
 *
 * Tools de operações em lote do sistema de tarefas: bulk-update, clear-completed, import.
 *
 * @module copilot/tools/todo/bulk-tools
 * @see EventBus
 * @see module:copilot/tools/todo/store
 */

import { createTool } from '#copilot/sdk';
import { z } from 'zod';
import { log } from '../logger.js';
import { generateUniqueId, now, readStore, withStore, zId, zPriority, zStatus } from './store.js';

// ---------------------------------------------------------------------------
// Tool: todo_bulk_update
// ---------------------------------------------------------------------------

/**
 * Tool: todo_bulk_update — atualiza status/prioridade/tags em múltiplas tarefas.
 */
export const todoBulkUpdateTool = createTool({
    name: 'todo_bulk_update',
    description:
        'Atualiza status, prioridade ou tags em múltiplas tarefas simultaneamente. ' +
        'Aplica a mesma mudança a todas as tarefas do array de IDs fornecido. ' +
        'Use para completar um sprint, repriorizar um conjunto ou etiquetar em lote.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<any>} */ (
        /** @type {unknown} */ (
            z.object({
                ids: z.array(zId).min(1).describe('Lista de IDs de tarefas a atualizar'),
                status: zStatus
                    .optional()
                    .describe('Novo status a aplicar a todas (máquina de estados ignorada em bulk)'),
                priority: zPriority.optional().describe('Nova prioridade a aplicar a todas'),
                add_tags: z.array(z.string()).optional().describe('Tags a adicionar a todas'),
                remove_tags: z.array(z.string()).optional().describe('Tags a remover de todas'),
                completed_by: z.string().optional().describe('Identificador de quem concluiu (agente, usuário, etc.)'),
            })
        )
    ),
    handler: async (
        /**
         * @type {{
         *     ids: string[];
         *     status?: import('./store.js').TodoStatus;
         *     priority?: import('./store.js').TodoPriority;
         *     add_tags?: string[];
         *     remove_tags?: string[];
         *     completed_by?: string;
         * }}
         */ args,
    ) => {
        if (!args.status && !args.priority && !args.add_tags && !args.remove_tags) {
            return {
                success: false,
                error: 'Forneça pelo menos um campo para atualizar: status, priority, add_tags ou remove_tags',
            };
        }

        return withStore(async (store) => {
            const ts = now();
            const updated = [];
            const notFound = [];

            for (const id of args.ids) {
                const task = store.tasks[id];
                if (!task) {
                    notFound.push(id);
                    continue;
                }

                if (args.status) {
                    task.status = args.status;
                    if (args.status === 'done') {
                        task.completedAt = ts;
                        task.completedBy = args.completed_by ?? null;
                    } else {
                        task.completedAt = null;
                        task.completedBy = null;
                    }
                }
                if (args.priority) task.priority = args.priority;
                if (args.add_tags) task.tags = [...new Set([...task.tags, ...args.add_tags])];
                if (args.remove_tags) task.tags = task.tags.filter((t) => !args.remove_tags?.includes(t));
                task.updatedAt = ts;
                updated.push(id);
            }

            log('INFO', `[todo_bulk_update] Bulk update updated=${updated.length} not_found=${notFound.length}`);
            return { success: true, updated, not_found: notFound, count: updated.length };
        });
    },
});

// ---------------------------------------------------------------------------
// Tool: todo_clear_completed
// ---------------------------------------------------------------------------

/**
 * Tool: todo_clear_completed — remove todas as tarefas concluídas ou canceladas.
 */
export const todoClearCompletedTool = createTool({
    name: 'todo_clear_completed',
    description:
        'Remove todas as tarefas com status "done" ou "cancelled" (ou apenas um deles via status_filter). ' +
        'Limpeza periódica para manter o sistema organizado. ' +
        'Retorna contagem de tarefas removidas e IDs afetados.',
    parameters: z.object({
        status_filter: z
            .enum(['done', 'cancelled', 'both'])
            .optional()
            .default('both')
            .describe('Quais status limpar: done | cancelled | both'),
        dry_run: z.boolean().optional().default(false).describe('Se true, simula a remoção sem persistir'),
    }),
    handler: async (/** @type {{ status_filter?: 'done' | 'cancelled' | 'both'; dry_run?: boolean }} */ args) => {
        const filter = args.status_filter ?? 'both';

        if (args.dry_run) {
            const store = await readStore();
            const toDelete = [];
            for (const task of Object.values(store.tasks)) {
                const match =
                    (filter === 'both' && (task.status === 'done' || task.status === 'cancelled')) ||
                    (filter === 'done' && task.status === 'done') ||
                    (filter === 'cancelled' && task.status === 'cancelled');

                if (match) toDelete.push(task.id);
            }

            return {
                success: true,
                deleted: toDelete,
                count: toDelete.length,
                dry_run: true,
                message: `Simulação: ${toDelete.length} tarefas seriam removidas`,
            };
        }

        return withStore(async (store) => {
            const ts = now();
            const toDelete = [];

            for (const task of Object.values(store.tasks)) {
                const match =
                    (filter === 'both' && (task.status === 'done' || task.status === 'cancelled')) ||
                    (filter === 'done' && task.status === 'done') ||
                    (filter === 'cancelled' && task.status === 'cancelled');

                if (match) toDelete.push(task.id);
            }

            if (toDelete.length > 0) {
                for (const id of toDelete) {
                    const task = store.tasks[id];
                    if (task?.parentId) {
                        const parent = store.tasks[task.parentId];
                        if (parent) {
                            parent.subtaskIds = parent.subtaskIds.filter((sid) => sid !== id);
                            parent.updatedAt = ts;
                        }
                    }
                    delete store.tasks[id];
                }
            }

            log('INFO', `[todo_clear_completed] Clear completed count=${toDelete.length} dry_run=false`);
            return {
                success: true,
                deleted: toDelete,
                count: toDelete.length,
                dry_run: false,
                message: `${toDelete.length} tarefas removidas`,
            };
        });
    },
});

// ---------------------------------------------------------------------------
// Tool: todo_import
// ---------------------------------------------------------------------------

/**
 * Tool: todo_import — importa tarefas de uma lista de objetos JSON.
 */
export const todoImportTool = createTool({
    name: 'todo_import',
    description:
        'Importa múltiplas tarefas de uma vez a partir de um array de objetos. ' +
        'Cada objeto deve ter pelo menos "title". Campos opcionais: description, priority, status, ' +
        'tags, due_date, notes, metadata. IDs novos são gerados automaticamente. ' +
        'Use para migrar tarefas de outros sistemas ou criar um sprint inteiro de uma vez.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<any>} */ (
        /** @type {unknown} */ (
            z.object({
                tasks: z
                    .array(
                        z.object({
                            title: z.string().min(1),
                            description: z.string().optional(),
                            status: zStatus.optional(),
                            priority: zPriority.optional(),
                            tags: z.array(z.string()).optional(),
                            due_date: z.string().datetime({ offset: true }).optional(),
                            notes: z.string().optional(),
                            metadata: z.record(z.string(), z.unknown()).optional(),
                        }),
                    )
                    .min(1)
                    .describe('Array de tarefas a importar'),
                default_priority: zPriority
                    .optional()
                    .default('medium')
                    .describe('Prioridade padrão para tarefas sem priority'),
            })
        )
    ),
    handler: async (
        /**
         * @type {{
         *     tasks: {
         *         title: string;
         *         description?: string;
         *         status?: import('./store.js').TodoStatus;
         *         priority?: import('./store.js').TodoPriority;
         *         tags?: string[];
         *         due_date?: string;
         *         notes?: string;
         *         metadata?: Record<string, unknown>;
         *     }[];
         *     default_priority?: import('./store.js').TodoPriority;
         * }}
         */ args,
    ) => {
        return withStore(async (store) => {
            const ts = now();
            const created = [];

            for (const item of args.tasks) {
                const id = generateUniqueId(store);
                /** @type {import('./store.js').TodoItem} */
                const task = {
                    id,
                    title: item.title,
                    description: item.description ?? '',
                    status: item.status ?? 'todo',
                    priority: item.priority ?? args.default_priority ?? 'medium',
                    tags: item.tags ?? [],
                    dueDate: item.due_date ?? null,
                    parentId: null,
                    subtaskIds: [],
                    notes: item.notes ?? '',
                    createdAt: ts,
                    updatedAt: ts,
                    completedAt: item.status === 'done' ? ts : null,
                    completedBy: null,
                    metadata: item.metadata ?? {},
                };
                store.tasks[id] = task;
                created.push(id);
            }

            log('INFO', `[todo_import] Tarefas importadas count=${created.length}`);
            return { success: true, created_ids: created, count: created.length };
        });
    },
});
