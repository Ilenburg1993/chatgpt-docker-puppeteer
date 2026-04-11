// @ts-check
/**
 * src/copilot/tools/todo/store.js
 *
 * Persistência, migração, schemas Zod e helpers do sistema de tarefas.
 *
 * Responsabilidades:
 *
 * - Tipos (JSDoc): TodoStatus, TodoPriority, TodoItem, TodoStore
 * - Constantes: SCHEMA_VERSION, MAX_LIST, VALID_TRANSITIONS, PRIORITY_ORDER
 * - Schemas Zod reutilizáveis (zStatus, zPriority, zId)
 * - Persistência SQLite: withStore, readStore, _readStoreRaw, _writeStoreRaw
 * - Migração one-shot JSON → SQLite (_migrateJsonLegacy)
 * - Helpers puros: generateId, generateUniqueId, now, sanitize, isOverdue, createTask
 *
 * @module copilot/tools/todo/store
 * @see module:copilot/db/migrations
 * @see module:copilot/db/sqlite
 */

import { logSwallowed } from '#copilot/core';
import { getCopilotDb } from '#copilot/db';
import { log } from '#copilot/observability';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Constantes e configuração
// ---------------------------------------------------------------------------

/** Raiz do workspace */
const WORKSPACE_ROOT = new URL('../../../..', import.meta.url).pathname;

/** Arquivo JSON legado (mantido para migração one-shot) */
const TODOS_FILE = path.join(WORKSPACE_ROOT, '.github', 'hooks', 'state', 'todos.json');

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
// SQLite backend — persistência
// ---------------------------------------------------------------------------

/**
 * Migração one-shot do arquivo JSON legado (todos.json) para o SQLite isolado. Executada apenas se a tabela estiver
 * vazia e o arquivo legado existir.
 *
 * @returns {void}
 */
function _migrateJsonLegacy() {
    // FS-SYNC: init-time-safe (one-shot migration)
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
                log('INFO', `[todo/store] Migração JSON→SQLite: ${rows.length} tarefas importadas.`);
            }
        }
    } catch (e) {
        log('WARN', `[todo/store] Migração JSON legado falhou (não-crítico): ${/** @type {Error} */ (e).message}`);
    }
}

// Executa migração legada na carga do módulo (síncrono, one-time).
try {
    _migrateJsonLegacy();
} catch (e) {
    log('WARN', `[todo/store] _migrateJsonLegacy falhou: ${/** @type {Error} */ (e).message}`);
}

// BUG-CRIT-04 (fix): mutex serial para serializar ciclos read-modify-write do store.
let _storeMutex = Promise.resolve();

/**
 * Serializa uma operação de read-modify-write no store. O callback `fn` recebe o store, modifica-o in-place e retorna
 * um valor opcional.
 *
 * @template T
 * @param {(store: TodoStore) => Promise<T> | T} fn
 * @returns {Promise<T>}
 */
export async function withStore(fn) {
    /** @type {(v?: unknown) => void} */
    let release;
    const token = new Promise((r) => {
        release = /** @type {(v?: unknown) => void} */ (r);
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

/**
 * @returns {Promise<TodoStore>}
 */
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
            } catch (/** @type {any} */ e) {
                logSwallowed(e, 'todo.store.parseRow');
            }
        }
        return { version: SCHEMA_VERSION, tasks };
    } catch (e) {
        log('WARN', `[todo/store] _readStoreRaw falhou, retornando vazio: ${/** @type {Error} */ (e).message}`);
        return { version: SCHEMA_VERSION, tasks: {} };
    }
}

/**
 * @param {TodoStore} store
 * @returns {Promise<void>}
 */
async function _writeStoreRaw(store) {
    const db = getCopilotDb();
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

/**
 * Lê o store de tarefas (read-only, sem mutex).
 *
 * @returns {Promise<TodoStore>}
 */
export async function readStore() {
    return _readStoreRaw();
}

// ---------------------------------------------------------------------------
// Helpers puros
// ---------------------------------------------------------------------------

/**
 * Gera um ID único de 8 caracteres alfanuméricos.
 *
 * @returns {string}
 */
export function generateId() {
    return Math.random().toString(36).slice(2, 10).padEnd(8, '0');
}

/**
 * Gera um ID único para o store atual, evitando colisão com tarefas já existentes.
 *
 * @param {TodoStore} store
 * @returns {string}
 */
export function generateUniqueId(store) {
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
export function now() {
    return new Date().toISOString();
}

/**
 * Retorna uma cópia da tarefa sem campos internos desnecessários para exibição.
 *
 * @param {TodoItem} task
 * @returns {TodoItem}
 */
export function sanitize(task) {
    return { ...task };
}

/**
 * Verifica se uma tarefa está vencida.
 *
 * @param {TodoItem} task
 * @returns {boolean}
 */
export function isOverdue(task) {
    if (!task.dueDate || task.status === 'done' || task.status === 'cancelled') return false;
    return new Date(task.dueDate) < new Date();
}

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
export function createTask(store, opts) {
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
// F7.1 — TTL e cleanup automático de tarefas antigas
// ---------------------------------------------------------------------------

/** Dias máximos de retenção para tarefas concluídas/canceladas (default: 7). */
export const TODO_MAX_AGE_DAYS = 7;

/**
 * Remove tarefas com status `done` ou `cancelled` cujo campo `completedAt` seja mais antigo que `maxAgeDays`. Limpa
 * também referências em `subtaskIds` de tarefas pai que continuam ativas.
 *
 * @param {number} [maxAgeDays] - Limite de retenção em dias (default: {@link TODO_MAX_AGE_DAYS})
 * @returns {Promise<number>} Quantidade de tarefas removidas
 */
export async function cleanupExpiredTasks(maxAgeDays = TODO_MAX_AGE_DAYS) {
    return withStore((store) => {
        const cutoffTs = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
        /** @type {Set<string>} */
        const removed = new Set();

        for (const [id, task] of Object.entries(store.tasks)) {
            const expired =
                (task.status === 'done' || task.status === 'cancelled') &&
                task.completedAt != null &&
                task.completedAt < cutoffTs;
            if (expired) removed.add(id);
        }

        if (removed.size === 0) return 0;

        // Remove as tarefas expiradas
        for (const id of removed) {
            delete store.tasks[id];
        }

        // Limpa referências em subtaskIds de tarefas que ainda existem
        for (const task of Object.values(store.tasks)) {
            if (task.subtaskIds.some((id) => removed.has(id))) {
                task.subtaskIds = task.subtaskIds.filter((id) => !removed.has(id));
            }
        }

        log('INFO', `[todo/store] cleanup: ${removed.size} tarefa(s) expirada(s) removida(s) (>${maxAgeDays}d).`);
        return removed.size;
    });
}

/**
 * Agenda cleanup periódico de tarefas antigas. Seguro para chamar múltiplas vezes (idempotente via flag). Executa
 * imediatamente na primeira chamada, depois a cada `intervalMs` milissegundos.
 *
 * @param {{ intervalMs?: number; maxAgeDays?: number }} [opts]
 * @returns {NodeJS.Timeout} Timer retornado por setInterval (use clearInterval para cancelar)
 */
export function startTodoCleanupJob(opts = {}) {
    const { intervalMs = 24 * 60 * 60 * 1000, maxAgeDays = TODO_MAX_AGE_DAYS } = opts;

    // Executa imediatamente (assíncrono, sem bloquear)
    cleanupExpiredTasks(maxAgeDays).catch((/** @type {Error} */ e) =>
        log('WARN', `[todo/store] cleanup inicial falhou: ${e.message}`),
    );

    return setInterval(() => {
        cleanupExpiredTasks(maxAgeDays).catch((/** @type {Error} */ e) =>
            log('WARN', `[todo/store] cleanup periódico falhou: ${e.message}`),
        );
    }, intervalMs);
}
