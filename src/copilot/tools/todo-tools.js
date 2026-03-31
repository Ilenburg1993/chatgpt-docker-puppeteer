// @ts-check
/**
 * src/copilot/tools/todo-tools.js
 *
 * Deep Todo Management System — sistema completo de gerenciamento de tarefas para o agente LLM-B.
 *
 * Funcionalidades:
 *
 * - Criação/atualização/exclusão de tarefas com metadados ricos (prioridade, tags, data, notas)
 * - Hierarquia de tarefas: subtarefas via parentId (n níveis de profundidade)
 * - Status com máquina de estados validada (todo → in_progress → done|cancelled|blocked)
 * - Busca full-text em título, descrição, notas e tags
 * - Filtros compostos: status + prioridade + tag + texto + parentId
 * - Operações em lote (bulk): atualização de status em múltiplas tarefas
 * - Estatísticas: counts por status/prioridade, overdue, completion rate
 * - Persistência em JSON atômico (escrita via .tmp + rename para prevenir corrupção)
 * - Sem dependências externas: usa apenas node:fs, node:path, node:crypto
 *
 * Arquivo de dados: `.github/hooks/state/todos.json` (criado automaticamente se ausente)
 *
 * @module copilot/tools/todo-tools
 */

import { getCopilotDb } from '#copilot/db/sqlite';
import { log } from '#core/logger';
import { defineTool } from '@github/copilot-sdk';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { withSkipPermission } from './tool-factory.js';

// ---------------------------------------------------------------------------
// Constantes e configuração
// ---------------------------------------------------------------------------

/** Raiz do workspace */
const WORKSPACE_ROOT = new URL('../../..', import.meta.url).pathname;

/** Arquivo JSON legado (mantido para migração one-shot) */
const TODOS_FILE = path.join(WORKSPACE_ROOT, '.github', 'hooks', 'state', 'todos.json');

/** Versão do schema de dados */
const SCHEMA_VERSION = 1;

/** Limite máximo de tarefas retornadas em listagens */
const MAX_LIST = 200;

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
const VALID_TRANSITIONS = {
    todo: ['in_progress', 'cancelled', 'blocked'],
    in_progress: ['todo', 'done', 'cancelled', 'blocked'],
    done: ['todo'], // reabrir apenas
    cancelled: ['todo'], // reabrir apenas
    blocked: ['todo', 'in_progress'],
};

// ---------------------------------------------------------------------------
// Helpers de persistência
// ---------------------------------------------------------------------------

/**
 * Lê o store de tarefas do disco. Cria estrutura vazia se o arquivo não existir.
 *
 * ARCH-N09/UPG-N06 (fix): I/O assíncrono via fs/promises para não bloquear o event loop.
 *
 * @returns {Promise<TodoStore>}
 */

// ---------------------------------------------------------------------------
// SQLite backend — F4.2 (UPG-03) + F7.6: banco isolado copilot.sqlite
// ---------------------------------------------------------------------------
// O DDL da tabela copilot_todo_tasks (migration v5) está em src/copilot/db/migrations.js.
// getCopilotDb() aplica as migrations ao abrir copilot.sqlite, portanto não é necessário
// criar a tabela aqui. A migração one-shot JSON→SQLite é feita em _migrateJsonLegacy().

/**
 * Migração one-shot do arquivo JSON legado (todos.json) para o SQLite isolado. Executada apenas se a tabela estiver
 * vazia e o arquivo legado existir.
 *
 * @returns {void}
 */
function _migrateJsonLegacy() {
    try {
        const db = getCopilotDb();
        const count = /** @type {{ n: number }} */ (db.prepare('SELECT COUNT(*) AS n FROM copilot_todo_tasks').get());
        if (count.n === 0 && fs.existsSync(TODOS_FILE)) {
            const raw = fs.readFileSync(TODOS_FILE, 'utf8');
            const data = JSON.parse(raw);
            const tasks = typeof data?.tasks === 'object' ? data.tasks : {};
            const insert = db.prepare('INSERT OR IGNORE INTO copilot_todo_tasks (id, data) VALUES (?, ?)');
            const insertMany = db.transaction((/** @type {[string, string][]} */ rows) => {
                for (const [id, json] of rows) insert.run(id, json);
            });
            const rows = /** @type {[string, string][]} */ (
                Object.entries(tasks).map(([id, task]) => [id, JSON.stringify(task)])
            );
            if (rows.length > 0) {
                insertMany(rows);
                log('INFO', `[todo-tools] Migração JSON→SQLite: ${rows.length} tarefas importadas.`);
            }
        }
    } catch (e) {
        log('WARN', `[todo-tools] Migração JSON legado falhou (não-crítico): ${/** @type {Error} */ (e).message}`);
    }
}

// Executa migração legada na carga do módulo (síncrono, one-time).
try {
    _migrateJsonLegacy();
} catch (e) {
    log('WARN', `[todo-tools] _migrateJsonLegacy falhou: ${/** @type {Error} */ (e).message}`);
}

// BUG-CRIT-04 (fix): mutex serial para serializar ciclos read-modify-write do store.
// Todas as operações que leem E escrevem devem usar withStore(fn).
let _storeMutex = Promise.resolve();

/**
 * Serializa uma operação de read-modify-write no store. O callback `fn` recebe o store, modifica-o in-place e retorna
 * um valor opcional.
 *
 * @template T
 * @param {(store: TodoStore) => Promise<T> | T} fn
 * @returns {Promise<T>}
 */
async function withStore(fn) {
    /** @type {(v?: unknown) => void} */
    let release;
    const token = new Promise((r) => {
        release = /** @type {any} */ (r);
    });
    const prev = _storeMutex;
    _storeMutex = _storeMutex.then(() => token);
    await prev;
    try {
        const store = await _readStoreRaw();
        const result = await fn(store);
        await _writeStoreRaw(store);
        return result;
    } finally {
        // @ts-expect-error — release is always assigned before await prev resolves
        release();
    }
}

async function _readStoreRaw() {
    try {
        const db = getCopilotDb();
        const rows = /** @type {{ id: string; data: string }[]} */ (
            db.prepare('SELECT id, data FROM copilot_todo_tasks').all()
        );
        /** @type {Record<string, TodoItem>} */
        const tasks = {};
        for (const row of rows) {
            try {
                tasks[row.id] = JSON.parse(row.data);
            } catch {
                // ignora linhas corrompidas
            }
        }
        return { version: SCHEMA_VERSION, tasks };
    } catch (e) {
        log('WARN', `[todo-tools] _readStoreRaw falhou, retornando vazio: ${/** @type {Error} */ (e).message}`);
        return { version: SCHEMA_VERSION, tasks: {} };
    }
}

/**
 * @param {TodoStore} store
 * @returns {Promise<void>}
 */
async function _writeStoreRaw(store) {
    const db = getCopilotDb();
    // Upsert todas as tarefas do store em memória para o SQLite.
    // Para deletados (removidos do store), apagamos do DB comparando os ids presentes.
    const upsert = db.prepare('INSERT OR REPLACE INTO copilot_todo_tasks (id, data) VALUES (?, ?)');
    const del = db.prepare('DELETE FROM copilot_todo_tasks WHERE id NOT IN (SELECT value FROM json_each(?))');
    const ids = Object.keys(store.tasks);
    const txn = db.transaction(() => {
        for (const [id, task] of Object.entries(store.tasks)) {
            upsert.run(id, JSON.stringify(task));
        }
        del.run(JSON.stringify(ids));
    });
    txn();
}

/** @returns {Promise<TodoStore>} */
async function readStore() {
    return _readStoreRaw();
}

/**
 * Gera um ID único de 8 caracteres alfanuméricos.
 *
 * @returns {string}
 */
function generateId() {
    return Math.random().toString(36).slice(2, 10).padEnd(8, '0');
}

/**
 * Gera um ID único para o store atual, evitando colisão com tarefas já existentes.
 *
 * @param {TodoStore} store
 * @returns {string}
 */
function generateUniqueId(store) {
    let id = generateId();
    while (store.tasks[id]) {
        id = generateId();
    }
    return id;
}

/**
 * Retorna o ISO 8601 timestamp atual.
 *
 * @returns {string}
 */
function now() {
    return new Date().toISOString();
}

/**
 * Retorna uma cópia da tarefa sem campos internos desnecessários para exibição.
 *
 * @param {TodoItem} task
 * @returns {TodoItem}
 */
function sanitize(task) {
    return { ...task };
}

/**
 * Verifica se uma tarefa está vencida.
 *
 * @param {TodoItem} task
 * @returns {boolean}
 */
function isOverdue(task) {
    if (!task.dueDate || task.status === 'done' || task.status === 'cancelled') return false;
    return new Date(task.dueDate) < new Date();
}

// ---------------------------------------------------------------------------
// Zod schemas reutilizáveis
// ---------------------------------------------------------------------------

const zStatus = z.enum(['todo', 'in_progress', 'done', 'cancelled', 'blocked']);
const zPriority = z.enum(['critical', 'high', 'medium', 'low', 'none']);
const zId = z.string().min(1).max(64).describe('ID da tarefa (8 chars gerado automaticamente)');

/**
 * Mapa de ordenação de prioridades (menor = mais importante). Usado como chave de sort em listagens e stats.
 *
 * @type {Record<import('./todo-tools.js').TodoPriority | string, number>}
 */
const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3, none: 4 };

// ---------------------------------------------------------------------------
// Helper de criação de tarefa
// ---------------------------------------------------------------------------

/**
 * Cria uma nova `TodoItem` no `store`, atualiza o pai se fornecido, mas NÃO persiste. O chamador é responsável por
 * executar a operação dentro de `withStore(...)` para garantir persistência atômica.
 *
 * @param {TodoStore} store - Store mutável já carregado do disco
 * @param {{
 *     title: string;
 *     description?: string;
 *     priority?: TodoPriority;
 *     tags?: string[];
 *     dueDate?: string | null;
 *     parentId?: string | null;
 *     notes?: string;
 *     metadata?: Record<string, unknown>;
 * }} opts
 * @returns {{ task: TodoItem } | { error: string }}
 */
function createTask(store, opts) {
    if (opts.parentId && !store.tasks[opts.parentId]) {
        return { error: `Tarefa pai não encontrada: ${opts.parentId}` };
    }
    const id = generateUniqueId(store);
    const ts = now();
    /** @type {TodoItem} */
    const task = {
        id,
        title: opts.title,
        description: opts.description ?? '',
        status: 'todo',
        priority: opts.priority ?? 'medium',
        tags: opts.tags ?? [],
        dueDate: opts.dueDate ?? null,
        parentId: opts.parentId ?? null,
        subtaskIds: [],
        notes: opts.notes ?? '',
        createdAt: ts,
        updatedAt: ts,
        completedAt: null,
        completedBy: null,
        metadata: opts.metadata ?? {},
    };
    store.tasks[id] = task;
    if (opts.parentId) {
        const parent = store.tasks[opts.parentId];
        if (parent && !parent.subtaskIds.includes(id)) {
            parent.subtaskIds.push(id);
            parent.updatedAt = ts;
        }
    }
    return { task };
}

// ---------------------------------------------------------------------------
// Tool: todo_create
// ---------------------------------------------------------------------------

/**
 * Tool: todo_create — cria uma nova tarefa com metadados ricos.
 */
const todoCreateTool = defineTool('todo_create', {
    description:
        'Cria uma nova tarefa no sistema de gerenciamento profundo. ' +
        'Suporta título, descrição detalhada, prioridade (critical/high/medium/low/none), ' +
        'tags, data de vencimento, notas livres, e subtarefas via parentId. ' +
        'Retorna o objeto completo da tarefa criada com seu ID gerado.',
    parameters: /** @type {any} */ (
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
            metadata: z.record(z.string(), z.unknown()).optional().describe('Campos extras extensíveis (JSON livre)'),
        })
    ),
    handler: async (
        /**
         * @type {{
         *     title: string;
         *     description?: string;
         *     priority?: TodoPriority;
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
// Tool: todo_get
// ---------------------------------------------------------------------------

/**
 * Tool: todo_get — obtém uma tarefa completa com sua árvore de subtarefas.
 */
const todoGetTool = withSkipPermission(
    defineTool('todo_get', {
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
                .describe('Se true, inclui objetos completos das subtarefas diretas'),
        }),
        handler: async (/** @type {{ id: string; include_subtasks?: boolean }} */ args) => {
            const store = await readStore();
            const task = store.tasks[args.id];
            if (!task) return { success: false, error: `Tarefa não encontrada: ${args.id}` };

            /** @type {object} */
            const result = { ...sanitize(task), overdue: isOverdue(task) };

            if (args.include_subtasks !== false && task.subtaskIds.length > 0) {
                /** @type {TodoItem[]} */
                const subtasks = task.subtaskIds
                    .map((sid) => store.tasks[sid])
                    .filter(/** @param {TodoItem | undefined} x @returns {x is TodoItem} */ (x) => x !== undefined)
                    .map((st) => ({ ...sanitize(st), overdue: isOverdue(st) }));
                // @ts-expect-error — `result` é construído dinamicamente, o campo subtasks é adicionado condicionalmente
                result.subtasks = subtasks;
            }

            return { success: true, task: result };
        },
    }),
);

// ---------------------------------------------------------------------------
// Tool: todo_list
// ---------------------------------------------------------------------------

/**
 * Tool: todo_list — lista tarefas com filtros compostos.
 */
const todoListTool = withSkipPermission(
    defineTool('todo_list', {
        description:
            'Lista tarefas com filtros opcionais compostos. Pode filtrar por status, prioridade, ' +
            'tag, parent_id (listar subtarefas de uma tarefa), texto de busca, e overdue. ' +
            'Retorna tarefas ordenadas por: overdue → priority → createdAt desc. ' +
            'Use para obter uma visão geral ou filtrar por critério.',
        parameters: /** @type {any} */ (
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
                limit: z.number().int().min(1).max(MAX_LIST).optional().default(50).describe('Máximo de resultados'),
            })
        ),
        handler: async (
            /**
             * @type {{
             *     status?: TodoStatus;
             *     priority?: TodoPriority;
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

            /** @type {(TodoItem & { overdue: boolean })[]} */
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
// Tool: todo_update
// ---------------------------------------------------------------------------

/**
 * Tool: todo_update — atualiza qualquer campo de uma tarefa existente.
 */
const todoUpdateTool = defineTool('todo_update', {
    description:
        'Atualiza campos arbitrários de uma tarefa existente. Apenas os campos fornecidos são ' +
        'alterados (patch parcial). Status segue máquina de estados validada. ' +
        'Use para modificar título, descrição, prioridade, tags, data, notas ou metadata.',
    parameters: /** @type {any} */ (
        z.object({
            id: zId,
            title: z.string().min(1).max(500).optional().describe('Novo título'),
            description: z.string().max(5000).optional().describe('Nova descrição'),
            priority: zPriority.optional().describe('Nova prioridade'),
            tags: z.array(z.string().max(100)).max(20).optional().describe('Substituir lista de tags'),
            add_tags: z.array(z.string().max(100)).max(20).optional().describe('Adicionar tags (merge com existentes)'),
            remove_tags: z.array(z.string()).optional().describe('Remover tags específicas'),
            due_date: z
                .string()
                .datetime({ offset: true })
                .nullable()
                .optional()
                .describe('Nova data vencimento ISO 8601 (null para remover)'),
            notes: z.string().max(10000).optional().describe('Novas notas (substitui completamente)'),
            append_notes: z.string().max(5000).optional().describe('Adicionar ao final das notas existentes'),
            metadata: z.record(z.string(), z.unknown()).optional().describe('Merge de metadata (deep merge de keys)'),
        })
    ),
    handler: async (
        /**
         * @type {{
         *     id: string;
         *     title?: string;
         *     description?: string;
         *     priority?: TodoPriority;
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
// Tool: todo_set_status
// ---------------------------------------------------------------------------

/**
 * Tool: todo_set_status — transiciona o status de uma tarefa com validação.
 */
const todoSetStatusTool = defineTool('todo_set_status', {
    description:
        'Altera o status de uma tarefa seguindo a máquina de estados validada. ' +
        'Transições válidas: todo → in_progress | cancelled | blocked; ' +
        'in_progress → todo | done | cancelled | blocked; ' +
        'done | cancelled → todo (reabrir); blocked → todo | in_progress. ' +
        'Use force: true para forçar transição fora do grafo (casos excepcionais).',
    parameters: /** @type {any} */ (
        z.object({
            id: zId,
            status: zStatus.describe('Novo status da tarefa'),
            force: z.boolean().optional().describe('Forçar transição mesmo fora do grafo de estados'),
            // UPG-PROP-05 (fix): identificador de quem concluiu a tarefa (agente, usuário, etc.)
            completed_by: z
                .string()
                .optional()
                .describe(
                    'Identificador de quem concluiu (agente, usuário). Gravado em completedBy quando status=done.',
                ),
        })
    ),
    handler: async (/** @type {{ id: string; status: TodoStatus; force?: boolean; completed_by?: string }} */ args) =>
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
                // UPG-PROP-05 (fix): registrar quem concluiu para rastreabilidade
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
const todoDeleteTool = defineTool('todo_delete', {
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
                // Exclusão recursiva de subtarefas
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
                // Desvincular subtarefas (tornam-se raiz)
                for (const childId of task.subtaskIds) {
                    const child = store.tasks[childId];
                    if (child) {
                        child.parentId = null;
                        child.updatedAt = ts;
                    }
                }
            }

            delete store.tasks[args.id];

            // F6.16 (BUG-LEVE-10): reportar subtarefas orfanizadas quando cascade: false
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

// ---------------------------------------------------------------------------
// Tool: todo_add_subtask
// ---------------------------------------------------------------------------

/**
 * Tool: todo_add_subtask — adiciona uma nova subtarefa a uma tarefa pai existente.
 */
const todoAddSubtaskTool = defineTool('todo_add_subtask', {
    description:
        'Cria uma nova subtarefa vinculada a uma tarefa pai existente. ' +
        'Equivale a todo_create com parent_id preenchido, mas com interface mais direta. ' +
        'A tarefa pai tem sua lista subtaskIds atualizada automaticamente.',
    parameters: /** @type {any} */ (
        z.object({
            parent_id: z.string().min(1).describe('ID da tarefa pai'),
            title: z.string().min(1).max(500).describe('Título da subtarefa'),
            description: z.string().max(5000).optional().describe('Descrição da subtarefa'),
            priority: zPriority.optional().default('medium').describe('Prioridade da subtarefa'),
            tags: z.array(z.string().max(100)).max(10).optional().describe('Tags da subtarefa'),
            due_date: z.string().datetime({ offset: true }).optional().describe('Data de vencimento ISO 8601'),
            notes: z.string().max(5000).optional().describe('Notas livres da subtarefa'),
        })
    ),
    handler: async (
        /**
         * @type {{
         *     parent_id: string;
         *     title: string;
         *     description?: string;
         *     priority?: TodoPriority;
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

// ---------------------------------------------------------------------------
// Tool: todo_search
// ---------------------------------------------------------------------------

/**
 * Tool: todo_search — busca full-text avançada em todos os campos de texto.
 */
const todoSearchTool = withSkipPermission(
    defineTool('todo_search', {
        description:
            'Busca full-text avançada em todas as tarefas. Pesquisa simultânea em título, ' +
            'descrição, notas e tags. Suporta múltiplos termos (todos devem corresponder). ' +
            'Retorna tarefas ordenadas por relevância (número de campos com match) + prioridade.',
        parameters: /** @type {any} */ (
            z.object({
                query: z
                    .string()
                    .min(1)
                    .max(500)
                    .describe('Texto de busca. Múltiplos termos separados por espaço (AND implícito)'),
                status: zStatus.optional().describe('Filtrar por status após a busca'),
                priority: zPriority.optional().describe('Filtrar por prioridade após a busca'),
                limit: z.number().int().min(1).max(MAX_LIST).optional().default(20).describe('Máximo de resultados'),
            })
        ),
        handler: async (
            /** @type {{ query: string; status?: TodoStatus; priority?: TodoPriority; limit?: number }} */ args,
        ) => {
            const store = await readStore();
            const terms = args.query
                .toLowerCase()
                .split(/\s+/)
                .filter((t) => t.length > 0);

            /** @type {{ task: TodoItem & { overdue: boolean }; score: number }[]} */
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
const todoStatsTool = withSkipPermission(
    defineTool('todo_stats', {
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

            const result = {
                success: true,
                total,
                by_status: byStatus,
                by_priority: byPriority,
                overdue: overdueCount,
                completion_rate: completionRate,
                top_tags: topTags,
                recent: /** @type {TodoItem[]} */ ([]),
                top_priority_pending: /** @type {TodoItem[]} */ ([]),
            };

            if (args.include_recent !== false) {
                result.recent = [...allTasks]
                    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                    .slice(0, 5)
                    .map(sanitize);
            }

            if (args.include_top_priority !== false) {
                result.top_priority_pending = [...allTasks]
                    .filter((t) => t.status !== 'done' && t.status !== 'cancelled')
                    .sort((a, b) => {
                        const pa = PRIORITY_ORDER[a.priority] ?? 99;
                        const pb = PRIORITY_ORDER[b.priority] ?? 99;
                        if (pa !== pb) return pa - pb;
                        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
                    })
                    .slice(0, 5)
                    .map(sanitize);
            }

            return result;
        },
    }),
);

// ---------------------------------------------------------------------------
// Tool: todo_bulk_update
// ---------------------------------------------------------------------------

/**
 * Tool: todo_bulk_update — atualiza status/prioridade/tags em múltiplas tarefas.
 */
const todoBulkUpdateTool = defineTool('todo_bulk_update', {
    description:
        'Atualiza status, prioridade ou tags em múltiplas tarefas simultaneamente. ' +
        'Aplica a mesma mudança a todas as tarefas do array de IDs fornecido. ' +
        'Use para completar um sprint, repriorizar um conjunto ou etiquetar em lote.',
    parameters: /** @type {any} */ (
        z.object({
            ids: z.array(zId).min(1).max(100).describe('Lista de IDs de tarefas a atualizar (máximo 100)'),
            status: zStatus.optional().describe('Novo status a aplicar a todas (máquina de estados ignorada em bulk)'),
            priority: zPriority.optional().describe('Nova prioridade a aplicar a todas'),
            add_tags: z.array(z.string().max(100)).max(10).optional().describe('Tags a adicionar a todas'),
            remove_tags: z.array(z.string()).optional().describe('Tags a remover de todas'),
            // UPG-PROP-05 (fix): identificador de quem concluiu (propagado quando status=done)
            completed_by: z.string().optional().describe('Identificador de quem concluiu (agente, usuário, etc.)'),
        })
    ),
    handler: async (
        /**
         * @type {{
         *     ids: string[];
         *     status?: TodoStatus;
         *     priority?: TodoPriority;
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
                        // UPG-PROP-05 (fix): completedBy propagado no bulk update
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
const todoClearCompletedTool = defineTool('todo_clear_completed', {
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
const todoImportTool = defineTool('todo_import', {
    description:
        'Importa múltiplas tarefas de uma vez a partir de um array de objetos. ' +
        'Cada objeto deve ter pelo menos "title". Campos opcionais: description, priority, status, ' +
        'tags, due_date, notes, metadata. IDs novos são gerados automaticamente. ' +
        'Use para migrar tarefas de outros sistemas ou criar um sprint inteiro de uma vez.',
    parameters: /** @type {any} */ (
        z.object({
            tasks: z
                .array(
                    z.object({
                        title: z.string().min(1).max(500),
                        description: z.string().max(5000).optional(),
                        status: zStatus.optional(),
                        priority: zPriority.optional(),
                        tags: z.array(z.string().max(100)).max(20).optional(),
                        due_date: z.string().datetime({ offset: true }).optional(),
                        notes: z.string().max(10000).optional(),
                        metadata: z.record(z.string(), z.unknown()).optional(),
                    }),
                )
                .min(1)
                .max(50)
                .describe('Array de tarefas a importar (máximo 50 por chamada)'),
            default_priority: zPriority
                .optional()
                .default('medium')
                .describe('Prioridade padrão para tarefas sem priority'),
        })
    ),
    handler: async (
        /**
         * @type {{
         *     tasks: {
         *         title: string;
         *         description?: string;
         *         status?: TodoStatus;
         *         priority?: TodoPriority;
         *         tags?: string[];
         *         due_date?: string;
         *         notes?: string;
         *         metadata?: Record<string, unknown>;
         *     }[];
         *     default_priority?: TodoPriority;
         * }}
         */ args,
    ) => {
        return withStore(async (store) => {
            const ts = now();
            const created = [];

            for (const item of args.tasks) {
                const id = generateUniqueId(store);
                /** @type {TodoItem} */
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

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/**
 * Tools de leitura (skipPermission: true) — não modificam estado.
 *
 * @type {import('@github/copilot-sdk').Tool[]}
 */
export const todoReadTools = [todoGetTool, todoListTool, todoSearchTool, todoStatsTool];

/**
 * Tools de escrita (requerem aprovação) — modificam estado.
 *
 * @type {import('@github/copilot-sdk').Tool[]}
 */
export const todoWriteTools = [
    todoCreateTool,
    todoUpdateTool,
    todoSetStatusTool,
    todoDeleteTool,
    todoAddSubtaskTool,
    todoBulkUpdateTool,
    todoClearCompletedTool,
    todoImportTool,
];

/**
 * Conjunto completo das 12 todo tools.
 *
 * @type {import('@github/copilot-sdk').Tool[]}
 */
export const todoTools = [...todoReadTools, ...todoWriteTools];
