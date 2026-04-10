// @ts-check
/**
 * src/copilot/tools/todo/query-tools.js
 *
 * Tools de leitura/consulta do sistema de tarefas: list, search, stats.
 *
 * @module copilot/tools/todo/query-tools
 * @see module:copilot/tools/todo/store
 */

import { createTool } from '#copilot/sdk';
import { z } from 'zod';
import { withSkipPermission } from '../tool-factory.js';
import { MAX_LIST, PRIORITY_ORDER, isOverdue, readStore, sanitize, zPriority, zStatus } from './store.js';

// ---------------------------------------------------------------------------
// Tool: todo_list
// ---------------------------------------------------------------------------

/**
 * Tool: todo_list — lista tarefas com filtros compostos.
 */
export const todoListTool = withSkipPermission(
    createTool({ name: 'todo_list',
        description:
            'Lista tarefas com filtros opcionais compostos. Pode filtrar por status, prioridade, ' +
            'tag, parent_id (listar subtarefas de uma tarefa), texto de busca, e overdue. ' +
            'Retorna tarefas ordenadas por: overdue → priority → createdAt desc. ' +
            'Use para obter uma visão geral ou filtrar por critério.',
        parameters: /** @type {import('@github/copilot-sdk').ZodSchema<any>} */ (
            /** @type {unknown} */ (
                z.object({
                    status: zStatus.optional().describe('Filtrar por status específico'),
                    priority: zPriority.optional().describe('Filtrar por prioridade específica'),
                    tag: z.string().optional().describe('Filtrar tarefas que contenham esta tag'),
                    parent_id: z
                        .string()
                        .nullable()
                        .optional()
                        .describe('null = apenas raiz; string = subtarefas deste pai; omitido = todas'),
                    text: z
                        .string()
                        .max(200)
                        .optional()
                        .describe('Busca de texto em título, descrição e notas (case-insensitive)'),
                    overdue_only: z.boolean().optional().describe('Se true, retorna apenas tarefas vencidas'),
                    limit: z
                        .number()
                        .int()
                        .min(1)
                        .max(MAX_LIST)
                        .optional()
                        .default(50)
                        .describe('Máximo de resultados'),
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
             * }}
             */ args,
        ) => {
            const store = await readStore();
            const allTasks = Object.values(store.tasks);

            /** @type {(import('./store.js').TodoItem & { overdue: boolean })[]} */
            let filtered = allTasks.map((t) => ({ ...t, overdue: isOverdue(t) }));

            if (args.status) filtered = filtered.filter((t) => t.status === args.status);
            if (args.priority) filtered = filtered.filter((t) => t.priority === args.priority);
            if (args.tag) {
                const tag = args.tag;
                filtered = filtered.filter((t) => t.tags.includes(tag));
            }
            if (args.overdue_only) filtered = filtered.filter((t) => t.overdue);

            // parent_id: null = apenas raiz, string = filhos do pai, undefined = todos
            if (args.parent_id === null) {
                filtered = filtered.filter((t) => t.parentId === null);
            } else if (typeof args.parent_id === 'string') {
                filtered = filtered.filter((t) => t.parentId === args.parent_id);
            }

            if (args.text) {
                const q = args.text.toLowerCase();
                filtered = filtered.filter(
                    (t) =>
                        t.title.toLowerCase().includes(q) ||
                        t.description.toLowerCase().includes(q) ||
                        t.notes.toLowerCase().includes(q) ||
                        t.tags.some((tag) => tag.toLowerCase().includes(q)),
                );
            }

            // Ordenação: overdue primeiro → prioridade → mais recente
            filtered.sort((a, b) => {
                if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
                const pa = PRIORITY_ORDER[a.priority] ?? 99;
                const pb = PRIORITY_ORDER[b.priority] ?? 99;
                if (pa !== pb) return pa - pb;
                return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            });

            const limit = args.limit ?? 50;
            const total = filtered.length;
            filtered = filtered.slice(0, limit);

            return {
                success: true,
                tasks: filtered,
                total,
                returned: filtered.length,
                has_more: total > limit,
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
    createTool({ name: 'todo_search',
        description:
            'Busca full-text avançada em todas as tarefas. Pesquisa simultânea em título, ' +
            'descrição, notas e tags. Suporta múltiplos termos (todos devem corresponder). ' +
            'Retorna tarefas ordenadas por relevância (número de campos com match) + prioridade.',
        parameters: /** @type {import('@github/copilot-sdk').ZodSchema<any>} */ (
            /** @type {unknown} */ (
                z.object({
                    query: z
                        .string()
                        .min(1)
                        .max(500)
                        .describe('Texto de busca. Múltiplos termos separados por espaço (AND implícito)'),
                    status: zStatus.optional().describe('Filtrar por status após a busca'),
                    priority: zPriority.optional().describe('Filtrar por prioridade após a busca'),
                    limit: z
                        .number()
                        .int()
                        .min(1)
                        .max(MAX_LIST)
                        .optional()
                        .default(20)
                        .describe('Máximo de resultados'),
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
             * }}
             */ args,
        ) => {
            const store = await readStore();
            const terms = args.query
                .toLowerCase()
                .split(/\s+/)
                .filter((t) => t.length > 0);

            /** @type {{ task: import('./store.js').TodoItem & { overdue: boolean }; score: number }[]} */
            const scored = [];

            for (const task of Object.values(store.tasks)) {
                if (args.status && task.status !== args.status) continue;
                if (args.priority && task.priority !== args.priority) continue;

                const haystack = [task.title, task.description, task.notes, ...task.tags].join(' ').toLowerCase();

                const matchCount = terms.filter((t) => haystack.includes(t)).length;
                if (matchCount === terms.length) {
                    scored.push({ task: { ...task, overdue: isOverdue(task) }, score: matchCount });
                }
            }

            // Ordenar por: score desc → priority → createdAt desc
            scored.sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                const pa = PRIORITY_ORDER[a.task.priority] ?? 99;
                const pb = PRIORITY_ORDER[b.task.priority] ?? 99;
                if (pa !== pb) return pa - pb;
                return new Date(b.task.createdAt).getTime() - new Date(a.task.createdAt).getTime();
            });

            const total = scored.length;
            const limit = args.limit ?? 20;
            const results = scored.slice(0, limit).map(({ task, score }) => ({ ...task, _score: score }));

            return { success: true, query: args.query, results, total, returned: results.length };
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
    createTool({ name: 'todo_stats',
        description:
            'Retorna estatísticas completas do sistema de tarefas: contagem por status e prioridade, ' +
            'tarefas vencidas (overdue), taxa de conclusão, distribuição de tags, ' +
            'e resumo de tarefas mais recentes e de maior prioridade.',
        parameters: z.object({
            include_recent: z
                .boolean()
                .optional()
                .default(true)
                .describe('Se true, inclui lista das 5 tarefas mais recentes'),
            include_top_priority: z
                .boolean()
                .optional()
                .default(true)
                .describe('Se true, inclui lista das 5 tarefas de maior prioridade pendentes'),
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
