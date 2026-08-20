// @ts-check
import { z } from 'zod';
import { log } from '../infra/logger.js';
import { buildTool, withSkipPermission } from '../infra/tool-factory.js';
import { createTask, isOverdue, now, readStore, sanitize, withStore, zId, zPriority } from './store.js';
/**
 * src/copilot/tools/todo/crud-tools.js
 *
 * Tools CRUD do sistema de tarefas: get, update, add-subtask.
 *
 * @module copilot/tools/todo/crud-tools
 * @see EventBus
 * @see module:copilot/tools/todo/store
 */

// ---------------------------------------------------------------------------
// Tool: todo_get
// ---------------------------------------------------------------------------

/**
 * Tool: todo_get — obtém uma tarefa completa com sua árvore de subtarefas.
 */
export const todoGetTool = withSkipPermission(
    buildTool({
        name: 'todo_get',
        description:
            'Obtém uma tarefa pelo ID com todos os seus metadados e subtarefas. ' +
            'Retorna a árvore de subtarefas (1 nível de profundidade como objetos completos). ' +
            'Use para inspecionar detalhes de uma tarefa específica.',
        parameters: z.object({
            id: zId,
            include_subtasks: z
                .boolean()
                .optional()
                .default(true)
                ['describe']('Se true, inclui objetos completos das subtarefas diretas'),
        }),
        handler: async (/** @type {{ id: string; include_subtasks?: boolean }} */ args) => {
            const store = await readStore();
            const task = store.tasks[args.id];
            if (!task) return { success: false, error: `Tarefa não encontrada: ${args.id}` };

            const result = { ...sanitize(task), overdue: isOverdue(task) };

            if (args.include_subtasks !== false && task.subtaskIds.length > 0) {
                const subtasks = task.subtaskIds
                    .map((sid) => store.tasks[sid])
                    .filter(
                        /**
                         * @param {import('./store.js').TodoItem | undefined} x @returns {x is
                         *   import('./store.js').TodoItem}
                         */ (x) => x !== undefined,
                    )
                    .map((st) => ({ ...sanitize(st), overdue: isOverdue(st) }));
                return { success: true, task: { ...result, subtasks } };
            }

            return { success: true, task: result };
        },
    }),
);

// ---------------------------------------------------------------------------
// Tool: todo_update
// ---------------------------------------------------------------------------

/**
 * Tool: todo_update — atualiza qualquer campo de uma tarefa existente.
 */
export const todoUpdateTool = buildTool({
    name: 'todo_update',
    description:
        'Atualiza campos arbitrários de uma tarefa existente. Apenas os campos fornecidos são ' +
        'alterados (patch parcial). Status segue máquina de estados validada. ' +
        'Use para modificar título, descrição, prioridade, tags, data, notas ou metadata.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<any>} */ (
        /** @type {unknown} */ (
            z.object({
                id: zId,
                title: z.string().min(1).optional()['describe']('Novo título'),
                description: z.string().optional()['describe']('Nova descrição'),
                priority: zPriority.optional()['describe']('Nova prioridade'),
                tags: z.array(z.string()).optional()['describe']('Substituir lista de tags'),
                add_tags: z.array(z.string()).optional()['describe']('Adicionar tags (merge com existentes)'),
                remove_tags: z.array(z.string()).optional()['describe']('Remover tags específicas'),
                due_date: z
                    .string()
                    ['datetime']({ offset: true })
                    .nullable()
                    .optional()
                    .describe('Nova data vencimento ISO 8601 (null para remover)'),
                notes: z.string().optional()['describe']('Novas notas (substitui completamente)'),
                append_notes: z.string().optional()['describe']('Adicionar ao final das notas existentes'),
                metadata: z
                    .record(z.string(), z.unknown())
                    .optional()
                    ['describe']('Merge de metadata (deep merge de keys)'),
            })
        )
    ),
    handler: async (
        /**
         * @type {{
         *     id: string;
         *     title?: string;
         *     description?: string;
         *     priority?: import('./store.js').TodoPriority;
         *     tags?: string[];
         *     add_tags?: string[];
         *     remove_tags?: string[];
         *     due_date?: string | null;
         *     notes?: string;
         *     append_notes?: string;
         *     metadata?: Record<string, unknown>;
         * }}
         */ args,
    ) => {
        return withStore(async (store) => {
            const task = store.tasks[args.id];
            if (!task) return { success: false, error: `Tarefa não encontrada: ${args.id}` };

            const ts = now();
            const old = { ...task };

            if (args.title !== undefined) task.title = args.title;
            if (args.description !== undefined) task.description = args.description;
            if (args.priority !== undefined) task.priority = args.priority;
            if (args.due_date !== undefined) task.dueDate = args.due_date;
            if (args.notes !== undefined) task.notes = args.notes;

            // Tags: replace > add/remove
            if (args.tags !== undefined) {
                task.tags = [...new Set(args.tags)];
            } else {
                if (args.add_tags) task.tags = [...new Set([...task.tags, ...args.add_tags])];
                if (args.remove_tags) task.tags = task.tags.filter((t) => !args.remove_tags?.includes(t));
            }

            if (args.append_notes)
                task.notes = task.notes ? `${task.notes}\n\n${args.append_notes}` : args.append_notes;

            if (args.metadata) task.metadata = { ...task.metadata, ...args.metadata };

            task.updatedAt = ts;

            log(
                'INFO',
                `[todo_update] Tarefa atualizada id=${args.id} changed=${Object.keys(args)
                    .filter((k) => k !== 'id')
                    .join(',')}`,
            );
            return { success: true, task: sanitize(task), previous: sanitize(old) };
        });
    },
});

// ---------------------------------------------------------------------------
// Tool: todo_add_subtask
// ---------------------------------------------------------------------------

/**
 * Tool: todo_add_subtask — adiciona uma nova subtarefa a uma tarefa pai existente.
 */
export const todoAddSubtaskTool = buildTool({
    name: 'todo_add_subtask',
    description:
        'Cria uma nova subtarefa vinculada a uma tarefa pai existente. ' +
        'Equivale a todo_create com parent_id preenchido, mas com interface mais direta. ' +
        'A tarefa pai tem sua lista subtaskIds atualizada automaticamente.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<any>} */ (
        /** @type {unknown} */ (
            z.object({
                parent_id: z.string().min(1)['describe']('ID da tarefa pai'),
                title: z.string().min(1)['describe']('Título da subtarefa'),
                description: z.string().optional()['describe']('Descrição da subtarefa'),
                priority: zPriority.optional().default('medium')['describe']('Prioridade da subtarefa'),
                tags: z.array(z.string()).optional()['describe']('Tags da subtarefa'),
                due_date: z.string()['datetime']({ offset: true }).optional().describe('Data de vencimento ISO 8601'),
                notes: z.string().optional()['describe']('Notas livres da subtarefa'),
            })
        )
    ),
    handler: async (
        /**
         * @type {{
         *     parent_id: string;
         *     title: string;
         *     description?: string;
         *     priority?: import('./store.js').TodoPriority;
         *     tags?: string[];
         *     due_date?: string;
         *     notes?: string;
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
                parentId: args.parent_id,
                ...(args.notes !== undefined && { notes: args.notes }),
            });

            if ('error' in result) return { success: false, error: result.error };

            const parent = store.tasks[args.parent_id];
            log(
                'INFO',
                `[todo_add_subtask] Subtarefa criada id=${result.task.id} parent_id=${args.parent_id} title=${result.task.title}`,
            );
            return {
                success: true,
                subtask: sanitize(result.task),
                parent_subtask_count: parent?.subtaskIds.length ?? 0,
            };
        });
    },
});
