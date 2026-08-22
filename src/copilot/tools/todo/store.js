// @ts-check
import { resolveHooksStateFile } from '#copilot/boot';
import { getApplicationSqliteDatabase } from '#copilot/boot/application-infra';
import { logSwallowed, registerInterval, toError } from '#copilot/core';
import { runSqliteTransaction } from '#copilot/infra/public/database/sqlite';
import { log } from '../infra/logger.js';
import { SCHEMA_VERSION } from './todo-schema.js';
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
 * @see EventBus
 * @see module:copilot/infra/database/sqlite/application/migrations
 * @see module:copilot/infra/database/sqlite/better-sqlite3/runtime
 */

import { createConfiguredFsGrant, createConfiguredFsIo } from '#copilot/infra/public/composition/filesystem/configured';

export { MAX_LIST, PRIORITY_ORDER, SCHEMA_VERSION, VALID_TRANSITIONS, zId, zPriority, zStatus } from './todo-schema.js';

/**
 * @typedef {import('./todo-schema.js').TodoStatus} TodoStatus
 *
 * @typedef {import('./todo-schema.js').TodoPriority} TodoPriority
 *
 * @typedef {import('./todo-schema.js').TodoItem} TodoItem
 *
 * @typedef {import('./todo-schema.js').TodoStore} TodoStore
 */

/** Arquivo JSON legado (mantido para migração one-shot) */
const TODOS_FILE = resolveHooksStateFile('todos.json');
const TODO_MIGRATION_FS = createConfiguredFsIo(
    createConfiguredFsGrant({
        id: 'tools.todo.store.migration',
        exactPaths: [TODOS_FILE],
        operations: ['read'],
        symlinkPolicy: 'deny',
        durability: ['file-and-directory'],
    }),
);

// SQLite backend — persistência
// ---------------------------------------------------------------------------

/** @type {Promise<void> | null} */
let _legacyMigrationPromise = null;

/**
 * Migração one-shot JSON -> SQLite. A primeira operação assíncrona do store a executa sob uma promise compartilhada;
 * importar o módulo nunca bloqueia o event loop com filesystem síncrono.
 *
 * @returns {Promise<void>}
 */
async function ensureTodoLegacyMigration() {
    if (_legacyMigrationPromise) return _legacyMigrationPromise;
    _legacyMigrationPromise = (async () => {
        try {
            const db = getApplicationSqliteDatabase();
            const count = /** @type {{ n: number }} */ (
                db.prepare('SELECT COUNT(*) AS n FROM copilot_todo_tasks').get()
            );
            if (count.n !== 0) return;
            let raw;
            try {
                raw = (await TODO_MIGRATION_FS.readTextFresh(TODOS_FILE)).content;
            } catch (error) {
                if (toError(error).code === 'ENOENT') return;
                throw error;
            }
            const data = JSON.parse(raw);
            const tasks = typeof data?.tasks === 'object' ? data.tasks : {};
            const insert = db.prepare('INSERT OR IGNORE INTO copilot_todo_tasks (id, data) VALUES (?, ?)');
            const rows = /** @type {[string, string][]} */ (
                Object.entries(tasks).map(([id, task]) => [id, JSON.stringify(task)])
            );
            if (rows.length > 0) {
                runSqliteTransaction(db, () => {
                    for (const [id, json] of rows) insert.run(id, json);
                });
                log('INFO', `[todo/store] Migração JSON->SQLite: ${rows.length} tarefas importadas.`);
            }
        } catch (error) {
            log('WARN', `[todo/store] Migração JSON legado falhou (não-crítico): ${toError(error).message}`);
        }
    })();
    return _legacyMigrationPromise;
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
    await ensureTodoLegacyMigration();
    const acquire = _storeMutex.then(() => undefined);
    /** @type {() => void} */
    let release = () => {};
    _storeMutex = new Promise((resolve) => {
        release = () => resolve();
    });
    await acquire;
    try {
        const store = await _readStoreRaw();
        const result = await fn(store);
        await _writeStoreRaw(store);
        return result;
    } finally {
        release();
    }
}

/**
 * Serializa uma operação somente-leitura no store, reutilizando o mesmo mutex de escrita para consistência.
 *
 * @template T
 * @param {(store: TodoStore) => Promise<T> | T} fn
 * @returns {Promise<T>}
 */
export async function withStoreRead(fn) {
    await ensureTodoLegacyMigration();
    const acquire = _storeMutex.then(() => undefined);
    await acquire;
    const store = await _readStoreRaw();
    return fn(store);
}

/**
 * @returns {Promise<TodoStore>}
 */
async function _readStoreRaw() {
    try {
        const db = getApplicationSqliteDatabase();
        const rows = /** @type {{ id: string; data: string }[]} */ (
            db.prepare('SELECT id, data FROM copilot_todo_tasks').all()
        );
        /** @type {Record<string, TodoItem>} */
        const tasks = {};
        for (const row of rows) {
            try {
                tasks[row.id] = JSON.parse(row.data);
            } catch (e) {
                logSwallowed(e, 'todo.store.parseRow');
            }
        }

        // Saneamento de integridade referencial (parent/subtasks) para tolerar DB legado/corrompido.
        for (const task of Object.values(tasks)) {
            if (!Array.isArray(task.subtaskIds)) {
                task.subtaskIds = [];
            }
            task.subtaskIds = task.subtaskIds.filter((id) => typeof id === 'string' && id in tasks);
            if (task.parentId && !(task.parentId in tasks)) {
                task.parentId = null;
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
    const db = getApplicationSqliteDatabase();
    const upsert = db.prepare('INSERT OR REPLACE INTO copilot_todo_tasks (id, data) VALUES (?, ?)');
    const del = db.prepare('DELETE FROM copilot_todo_tasks WHERE id NOT IN (SELECT value FROM json_each(?))');
    const ids = Object.keys(store.tasks);
    runSqliteTransaction(db, () => {
        for (const [id, task] of Object.entries(store.tasks)) {
            upsert.run(id, JSON.stringify(task));
        }
        del.run(JSON.stringify(ids));
    });
}

/**
 * Lê o store de tarefas (read-only, sem mutex).
 *
 * @returns {Promise<TodoStore>}
 */
export async function readStore() {
    return withStoreRead((store) => store);
}

/**
 * @param {{ id: string; data: string }[]} rows
 * @returns {TodoItem[]}
 */
function deserializeTaskRows(rows) {
    /** @type {TodoItem[]} */
    const tasks = [];
    for (const row of rows) {
        try {
            const task = /** @type {TodoItem} */ (JSON.parse(row.data));
            tasks.push(task);
        } catch (e) {
            logSwallowed(e, 'todo.store.deserializeTaskRows');
        }
    }
    return tasks;
}

/**
 * Lê tarefas paginadas via SQL, com filtros aplicados no banco para evitar full-load em memória.
 *
 * @param {{
 *     status?: TodoStatus;
 *     priority?: TodoPriority;
 *     tag?: string;
 *     parentId?: string | null;
 *     text?: string;
 *     overdueOnly?: boolean;
 *     limit?: number;
 *     offset?: number;
 * }} [opts]
 * @returns {Promise<{
 *     tasks: TodoItem[];
 *     total: number;
 *     returned: number;
 *     limit: number;
 *     offset: number;
 *     hasMore: boolean;
 * }>}
 */
export async function readTasksPage(opts = {}) {
    await ensureTodoLegacyMigration();
    const { status, priority, tag, parentId, text, overdueOnly, limit = 100, offset = 0 } = opts;

    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 100;
    const safeOffset = Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0;

    const acquire = _storeMutex.then(() => undefined);
    await acquire;

    const db = getApplicationSqliteDatabase();
    /** @type {string[]} */
    const where = [];
    /** @type {unknown[]} */
    const params = [];

    if (status) {
        where.push("json_extract(data, '$.status') = ?");
        params.push(status);
    }
    if (priority) {
        where.push("json_extract(data, '$.priority') = ?");
        params.push(priority);
    }
    if (typeof parentId === 'string') {
        where.push("json_extract(data, '$.parentId') = ?");
        params.push(parentId);
    } else if (parentId === null) {
        where.push("json_extract(data, '$.parentId') IS NULL");
    }
    if (typeof tag === 'string' && tag.trim().length > 0) {
        where.push("EXISTS (SELECT 1 FROM json_each(data, '$.tags') jt WHERE jt.value = ?)");
        params.push(tag.trim());
    }
    if (typeof text === 'string' && text.trim().length > 0) {
        where.push(
            "(LOWER(COALESCE(json_extract(data, '$.title'), '')) LIKE ? " +
                "OR LOWER(COALESCE(json_extract(data, '$.description'), '')) LIKE ? " +
                "OR LOWER(COALESCE(json_extract(data, '$.notes'), '')) LIKE ?)",
        );
        const like = `%${text.trim().toLowerCase()}%`;
        params.push(like, like, like);
    }
    if (overdueOnly) {
        where.push(
            "json_extract(data, '$.dueDate') IS NOT NULL " +
                "AND json_extract(data, '$.status') NOT IN ('done', 'cancelled') " +
                "AND json_extract(data, '$.dueDate') < ?",
        );
        params.push(new Date().toISOString());
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const countSql = `SELECT COUNT(*) AS n FROM copilot_todo_tasks ${whereClause}`;
    const countRow = /** @type {{ n: number }} */ (db.prepare(countSql).get(...params));
    const total = Number(countRow?.n ?? 0);

    const listSql =
        `SELECT id, data FROM copilot_todo_tasks ${whereClause} ` +
        `ORDER BY ` +
        `CASE ` +
        `WHEN json_extract(data, '$.dueDate') IS NOT NULL ` +
        `AND json_extract(data, '$.status') NOT IN ('done', 'cancelled') ` +
        `AND json_extract(data, '$.dueDate') < ? THEN 0 ELSE 1 END ASC, ` +
        `CASE json_extract(data, '$.priority') ` +
        `WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END ASC, ` +
        `json_extract(data, '$.createdAt') DESC ` +
        `LIMIT ? OFFSET ?`;

    const rows = /** @type {{ id: string; data: string }[]} */ (
        db.prepare(listSql).all(...params, new Date().toISOString(), safeLimit, safeOffset)
    );

    const tasks = deserializeTaskRows(rows);
    return {
        tasks,
        total,
        returned: tasks.length,
        limit: safeLimit,
        offset: safeOffset,
        hasMore: safeOffset + tasks.length < total,
    };
}

/**
 * Busca paginada SQL com todos os termos (AND) aplicados em título/descrição/notas/tags.
 *
 * @param {{
 *     terms: string[];
 *     status?: TodoStatus;
 *     priority?: TodoPriority;
 *     limit?: number;
 *     offset?: number;
 * }} opts
 * @returns {Promise<{
 *     tasks: TodoItem[];
 *     total: number;
 *     returned: number;
 *     limit: number;
 *     offset: number;
 *     hasMore: boolean;
 * }>}
 */
export async function searchTasksPage(opts) {
    await ensureTodoLegacyMigration();
    const { terms, status, priority, limit = 100, offset = 0 } = opts;
    const safeTerms = terms.map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0);
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 100;
    const safeOffset = Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0;

    const acquire = _storeMutex.then(() => undefined);
    await acquire;

    const db = getApplicationSqliteDatabase();
    /** @type {string[]} */
    const where = [];
    /** @type {unknown[]} */
    const params = [];

    if (status) {
        where.push("json_extract(data, '$.status') = ?");
        params.push(status);
    }
    if (priority) {
        where.push("json_extract(data, '$.priority') = ?");
        params.push(priority);
    }

    for (const term of safeTerms) {
        where.push(
            "(LOWER(COALESCE(json_extract(data, '$.title'), '')) LIKE ? " +
                "OR LOWER(COALESCE(json_extract(data, '$.description'), '')) LIKE ? " +
                "OR LOWER(COALESCE(json_extract(data, '$.notes'), '')) LIKE ? " +
                "OR EXISTS (SELECT 1 FROM json_each(data, '$.tags') jt WHERE LOWER(COALESCE(jt.value, '')) LIKE ?))",
        );
        const like = `%${term}%`;
        params.push(like, like, like, like);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const countSql = `SELECT COUNT(*) AS n FROM copilot_todo_tasks ${whereClause}`;
    const countRow = /** @type {{ n: number }} */ (db.prepare(countSql).get(...params));
    const total = Number(countRow?.n ?? 0);

    const listSql =
        `SELECT id, data FROM copilot_todo_tasks ${whereClause} ` +
        `ORDER BY ` +
        `CASE json_extract(data, '$.priority') ` +
        `WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END ASC, ` +
        `json_extract(data, '$.createdAt') DESC ` +
        `LIMIT ? OFFSET ?`;

    const rows = /** @type {{ id: string; data: string }[]} */ (
        db.prepare(listSql).all(...params, safeLimit, safeOffset)
    );
    const tasks = deserializeTaskRows(rows);
    return {
        tasks,
        total,
        returned: tasks.length,
        limit: safeLimit,
        offset: safeOffset,
        hasMore: safeOffset + tasks.length < total,
    };
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
    cleanupExpiredTasks(maxAgeDays).catch((e) =>
        log('WARN', `[todo/store] cleanup inicial falhou: ${toError(e).message}`),
    );

    const timerId = `todo.store.cleanup:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const timer = registerInterval(
        timerId,
        () => {
            cleanupExpiredTasks(maxAgeDays).catch((e) =>
                log('WARN', `[todo/store] cleanup periódico falhou: ${toError(e).message}`),
            );
        },
        intervalMs,
    );

    return timer;
}
