// @ts-check
import { z } from 'zod';
import { buildTool, withSkipPermission } from '../infra/tool-factory.js';
import {
    PRIORITY_ORDER,
    isOverdue,
    readStore,
    readTasksPage,
    sanitize,
    searchTasksPage,
    zPriority,
    zStatus,
} from './store.js';
/**
 * src/copilot/tools/todo/query-tools.js
 *
 * Tools de leitura/consulta do sistema de tarefas: list, search, stats.
 *
 * @module copilot/tools/todo/query-tools
 * @see EventBus
 * @see module:copilot/tools/todo/store
 */

// ---------------------------------------------------------------------------
// Tool: todo_list
// ---------------------------------------------------------------------------

/**
 * Tool: todo_list — lista tarefas com filtros compostos.
 */
export const todoListTool = withSkipPermission(
    buildTool({
        name: 'todo_list',
        description:
            'Lista tarefas com filtros opcionais compostos. Pode filtrar por status, prioridade, ' +
            'tag, parent_id (listar subtarefas de uma tarefa), texto de busca, e overdue. ' +
            'Retorna tarefas ordenadas por: overdue → priority → createdAt desc. ' +
            'Use para obter uma visão geral ou filtrar por critério.',
        parameters: /** @type {import('#copilot/sdk/types').ZodSchema<any>} */ (
            /** @type {unknown} */ (
                z.object({
                    status: zStatus.optional()['describe']('Filtrar por status específico'),
                    priority: zPriority.optional()['describe']('Filtrar por prioridade específica'),
                    tag: z.string().optional()['describe']('Filtrar tarefas que contenham esta tag'),
                    parent_id: z
                        .string()
                        .nullable()
                        .optional()
                        ['describe']('null = apenas raiz; string = subtarefas deste pai; omitido = todas'),
                    text: z
                        .string()
                        .optional()
                        ['describe']('Busca de texto em título, descrição e notas (case-insensitive)'),
                    overdue_only: z.boolean().optional()['describe']('Se true, retorna apenas tarefas vencidas'),
                    limit: z
                        .number()
                        .int()
                        .min(1)
                        .optional()
                        ['describe']('Quantidade sugerida de resultados; omitido retorna todos.'),
                    offset: z
                        .number()
                        .int()
                        .min(0)
                        .optional()
                        ['describe']('Offset de paginação para avançar na lista de resultados.'),
                })
            )
        ),
        handler: async (
            /**
             * @type {{
             *     status?: import('./store.js').TodoStatus;
             *     priority?: import('./store.js').TodoPriority;
             *     tag?: string;
             *     parent_id?: string | null;
             *     text?: string;
             *     overdue_only?: boolean;
             *     limit?: number;
             *     offset?: number;
             * }}
             */ args,
        ) => {
            /** @type {Parameters<typeof readTasksPage>[0]} */
            const pageRequest = {};
            if (args.status !== undefined) pageRequest.status = args.status;
            if (args.priority !== undefined) pageRequest.priority = args.priority;
            if (args.tag !== undefined) pageRequest.tag = args.tag;
            if (args.parent_id !== undefined) pageRequest.parentId = args.parent_id;
            if (args.text !== undefined) pageRequest.text = args.text;
            if (args.overdue_only !== undefined) pageRequest.overdueOnly = args.overdue_only;
            if (args.limit !== undefined) pageRequest.limit = args.limit;
            if (args.offset !== undefined) pageRequest.offset = args.offset;

            const page = await readTasksPage(pageRequest);
            const returnedTasks = page.tasks.map((task) => ({ ...task, overdue: isOverdue(task) }));

            return {
                success: true,
                tasks: returnedTasks,
                total: page.total,
                returned: page.returned,
                has_more: page.hasMore,
                advisoryLimit: page.limit,
                offset: page.offset,
                nextOffset: page.hasMore ? page.offset + page.returned : null,
            };
        },
    }),
);

// ---------------------------------------------------------------------------
// Tool: todo_search
// ---------------------------------------------------------------------------

/**
 * Tool: todo_search — busca full-text avançada em todos os campos de texto.
 */
export const todoSearchTool = withSkipPermission(
    buildTool({
        name: 'todo_search',
        description:
            'Busca full-text avançada em todas as tarefas. Pesquisa simultânea em título, ' +
            'descrição, notas e tags. Suporta múltiplos termos (todos devem corresponder). ' +
            'Retorna tarefas ordenadas por relevância (número de campos com match) + prioridade.',
        parameters: /** @type {import('#copilot/sdk/types').ZodSchema<any>} */ (
            /** @type {unknown} */ (
                z.object({
                    query: z
                        .string()
                        .min(1)
                        ['describe']('Texto de busca. Múltiplos termos separados por espaço (AND implícito)'),
                    status: zStatus.optional()['describe']('Filtrar por status após a busca'),
                    priority: zPriority.optional()['describe']('Filtrar por prioridade após a busca'),
                    limit: z
                        .number()
                        .int()
                        .min(1)
                        .optional()
                        ['describe']('Quantidade sugerida de resultados; omitido retorna todos.'),
                    offset: z
                        .number()
                        .int()
                        .min(0)
                        .optional()
                        ['describe']('Offset de paginação para avançar na busca.'),
                })
            )
        ),
        handler: async (
            /**
             * @type {{
             *     query: string;
             *     status?: import('./store.js').TodoStatus;
             *     priority?: import('./store.js').TodoPriority;
             *     limit?: number;
             *     offset?: number;
             * }}
             */ args,
        ) => {
            const terms = args.query
                .toLowerCase()
                .split(/\s+/)
                .filter((t) => t.length > 0);
            /** @type {Parameters<typeof searchTasksPage>[0]} */
            const pageRequest = { terms };
            if (args.status !== undefined) pageRequest.status = args.status;
            if (args.priority !== undefined) pageRequest.priority = args.priority;
            if (args.limit !== undefined) pageRequest.limit = args.limit;
            if (args.offset !== undefined) pageRequest.offset = args.offset;

            const page = await searchTasksPage(pageRequest);
            const results = page.tasks.map((task) => {
                const haystack = [task.title, task.description, task.notes, ...task.tags].join(' ').toLowerCase();
                const score = terms.filter((t) => haystack.includes(t)).length;
                return { ...task, overdue: isOverdue(task), _score: score };
            });

            // Ordenar por score apenas dentro da janela paginada
            results.sort((a, b) => {
                if ((b._score ?? 0) !== (a._score ?? 0)) return (b._score ?? 0) - (a._score ?? 0);
                const pa = PRIORITY_ORDER[a.priority] ?? 99;
                const pb = PRIORITY_ORDER[b.priority] ?? 99;
                if (pa !== pb) return pa - pb;
                return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            });

            return {
                success: true,
                query: args.query,
                results,
                total: page.total,
                returned: page.returned,
                advisoryLimit: page.limit,
                offset: page.offset,
                nextOffset: page.hasMore ? page.offset + page.returned : null,
            };
        },
    }),
);

// ---------------------------------------------------------------------------
// Tool: todo_stats
// ---------------------------------------------------------------------------

/**
 * Tool: todo_stats — estatísticas completas do sistema de tarefas.
 */
export const todoStatsTool = withSkipPermission(
    buildTool({
        name: 'todo_stats',
        description:
            'Retorna estatísticas completas do sistema de tarefas: contagem por status e prioridade, ' +
            'tarefas vencidas (overdue), taxa de conclusão, distribuição de tags, ' +
            'e resumo de tarefas mais recentes e de maior prioridade.',
        parameters: z.object({
            include_recent: z
                .boolean()
                .optional()
                .default(true)
                ['describe']('Se true, inclui lista das 5 tarefas mais recentes'),
            include_top_priority: z
                .boolean()
                .optional()
                .default(true)
                ['describe']('Se true, inclui lista das 5 tarefas de maior prioridade pendentes'),
        }),
        handler: async (/** @type {{ include_recent?: boolean; include_top_priority?: boolean }} */ args) => {
            const store = await readStore();
            const allTasks = Object.values(store.tasks);
            const total = allTasks.length;

            if (total === 0) {
                return {
                    success: true,
                    total: 0,
                    by_status: {},
                    by_priority: {},
                    overdue: 0,
                    completion_rate: 0,
                    top_tags: [],
                    recent: [],
                    top_priority_pending: [],
                };
            }

            /** @type {Record<string, number>} */
            const byStatus = {};
            /** @type {Record<string, number>} */
            const byPriority = {};
            /** @type {Record<string, number>} */
            const tagCounts = {};
            let overdueCount = 0;
            let doneCount = 0;

            for (const task of allTasks) {
                byStatus[task.status] = (byStatus[task.status] ?? 0) + 1;
                byPriority[task.priority] = (byPriority[task.priority] ?? 0) + 1;
                if (task.status === 'done') doneCount++;
                if (isOverdue(task)) overdueCount++;
                for (const tag of task.tags) {
                    tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
                }
            }

            const completionRate = total > 0 ? Math.round((doneCount / total) * 100) : 0;

            // Top 10 tags por frequência
            const topTags = Object.entries(tagCounts)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 10)
                .map(([tag, count]) => ({ tag, count }));

            /** @type {import('./store.js').TodoItem[]} */
            const result_recent = [];
            /** @type {import('./store.js').TodoItem[]} */
            const result_top = [];

            if (args.include_recent !== false) {
                result_recent.push(
                    ...[...allTasks]
                        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                        .slice(0, 5)
                        .map(sanitize),
                );
            }

            if (args.include_top_priority !== false) {
                result_top.push(
                    ...[...allTasks]
                        .filter((t) => t.status !== 'done' && t.status !== 'cancelled')
                        .sort((a, b) => {
                            const pa = PRIORITY_ORDER[a.priority] ?? 99;
                            const pb = PRIORITY_ORDER[b.priority] ?? 99;
                            if (pa !== pb) return pa - pb;
                            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
                        })
                        .slice(0, 5)
                        .map(sanitize),
                );
            }

            return {
                success: true,
                total,
                by_status: byStatus,
                by_priority: byPriority,
                overdue: overdueCount,
                completion_rate: completionRate,
                top_tags: topTags,
                recent: result_recent,
                top_priority_pending: result_top,
            };
        },
    }),
);
