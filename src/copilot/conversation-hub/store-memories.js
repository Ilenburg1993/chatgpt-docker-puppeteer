// @ts-check
/**
 * src/copilot/conversation-hub/store-memories.js
 *
 * Queries de memórias semânticas (P5) extraídas de ConversationStore para reduzir o God Module. Cada função recebe `db`
 * (better-sqlite3 Database) como primeiro argumento.
 *
 * @module copilot/conversation-hub/store-memories
 */

import { log } from '#copilot/observability/logger';
import { v4 as uuidv4 } from 'uuid';
import { sanitizeFtsQuery } from './store-helpers.js';

/**
 * Persiste uma memória semântica com tag livre.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ tag?: string; content: string; hubSessionId?: string; metadata?: object }} opts
 * @returns {string} ID da memória criada
 */
export function storeMemory(db, opts) {
    const id = uuidv4();
    const now = Date.now();
    db.prepare(
        `INSERT INTO copilot_memories (id, hub_session_id, tag, content, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
        id,
        opts.hubSessionId ?? null,
        opts.tag ?? 'geral',
        opts.content,
        opts.metadata ? JSON.stringify(opts.metadata) : null,
        now,
        now,
    );
    log('DEBUG', `[ConversationStore] Memória persistida: ${id} (tag: ${opts.tag ?? 'geral'})`);
    return id;
}

/**
 * Recupera memórias por tag e/ou busca textual (FTS5).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ tag?: string; search?: string; limit?: number; hubSessionId?: string }} [opts]
 * @returns {{ id: string; tag: string; content: string; created_at: number; hub_session_id: string | null }[]}
 */
export function recallMemories(db, opts = {}) {
    const limit = opts.limit ?? 20;
    const sessionFilter = opts.hubSessionId ? 'AND m.hub_session_id = ?' : '';
    const sessionArg = opts.hubSessionId ? [opts.hubSessionId] : [];

    if (opts.search) {
        const ftsQuery = sanitizeFtsQuery(opts.search);
        if (!ftsQuery) return [];
        const tagFilter = opts.tag ? 'AND m.tag = ?' : '';
        const tagArg = opts.tag ? [opts.tag] : [];
        const rows = db
            .prepare(
                `SELECT m.id, m.tag, m.content, m.created_at, m.hub_session_id
                 FROM copilot_memories_fts fts
                 JOIN copilot_memories m ON fts.id = m.id
                 WHERE copilot_memories_fts MATCH ?
                 ${tagFilter}
                 ${sessionFilter}
                 ORDER BY rank
                 LIMIT ?`,
            )
            .all(ftsQuery, ...tagArg, ...sessionArg, limit);
        return /** @type {any[]} */ (rows);
    }

    if (opts.tag) {
        return /** @type {any[]} */ (
            db
                .prepare(
                    `SELECT id, tag, content, created_at, hub_session_id FROM copilot_memories
                     WHERE tag = ? ${opts.hubSessionId ? 'AND hub_session_id = ?' : ''}
                     ORDER BY created_at DESC LIMIT ?`,
                )
                .all(opts.tag, ...sessionArg, limit)
        );
    }

    return /** @type {any[]} */ (
        db
            .prepare(
                `SELECT id, tag, content, created_at, hub_session_id FROM copilot_memories
                 ${opts.hubSessionId ? 'WHERE hub_session_id = ?' : ''}
                 ORDER BY created_at DESC LIMIT ?`,
            )
            .all(...sessionArg, limit)
    );
}

/**
 * Remove uma memória pelo id.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} memoryId
 * @returns {boolean} true se removida
 */
export function deleteMemory(db, memoryId) {
    const result = db.prepare('DELETE FROM copilot_memories WHERE id = ?').run(memoryId);
    return result.changes > 0;
}
