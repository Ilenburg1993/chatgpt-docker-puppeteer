// @ts-check
/**
 * src/copilot/conversation-hub/store-queries.js
 *
 * Funções de consulta (read-side) para conversation turns: readTurns, searchTurns, getTurn, countTurns. Extraídas do
 * ConversationStore para reduzir complexidade da classe principal.
 *
 * @module copilot/conversation-hub/store-queries
 * @see EventBus
 */

import { sanitizeFtsQuery } from './store-helpers.js';

/** @typedef {import('./store-helpers.js').ConversationTurn} ConversationTurn */
/** @typedef {import('./store-helpers.js').ReadTurnsOpts} ReadTurnsOpts */
/** @typedef {import('./store-helpers.js').SearchTurnsOpts} SearchTurnsOpts */

/**
 * Lê os turns de uma hub_session (paginado, mais antigos primeiro).
 *
 * @param {import('#copilot/infra/public/database/sqlite').SqliteDatabasePort} db
 * @param {string} hubSessionId
 * @param {ReadTurnsOpts} [opts]
 * @returns {ConversationTurn[]}
 */
export function readTurns(db, hubSessionId, opts = {}) {
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;

    if (opts.after != null) {
        return /** @type {ConversationTurn[]} */ (
            db
                .prepare(
                    `SELECT * FROM copilot_conversation_turns
                     WHERE hub_session_id = ? AND id > ?
                     ORDER BY turn_number ASC LIMIT ? OFFSET ?`,
                )
                .all(hubSessionId, opts.after, limit, offset)
        );
    }

    return /** @type {ConversationTurn[]} */ (
        db
            .prepare(
                `SELECT * FROM copilot_conversation_turns
                 WHERE hub_session_id = ?
                 ORDER BY turn_number ASC LIMIT ? OFFSET ?`,
            )
            .all(hubSessionId, limit, offset)
    );
}

/**
 * Busca turns por conteúdo usando FTS5 (fulltext search).
 *
 * @param {import('#copilot/infra/public/database/sqlite').SqliteDatabasePort} db
 * @param {SearchTurnsOpts} opts
 * @returns {ConversationTurn[]}
 */
export function searchTurns(db, opts) {
    const limit = opts.limit ?? 20;
    const ftsQuery = sanitizeFtsQuery(opts.query);
    if (!ftsQuery) return [];

    const roleFilter = opts.role ? 'AND t.role = ?' : '';
    const roleArg = opts.role ? [opts.role] : [];
    const sessionFilter = opts.hubSessionId ? 'AND t.hub_session_id = ?' : '';
    const sessionArg = opts.hubSessionId ? [opts.hubSessionId] : [];

    const rows = db
        .prepare(
            `SELECT t.*
             FROM copilot_turns_fts fts
             JOIN copilot_conversation_turns t ON fts.id = t.id
             WHERE copilot_turns_fts MATCH ?
             ${roleFilter}
             ${sessionFilter}
             ORDER BY rank
             LIMIT ?`,
        )
        .all(ftsQuery, ...roleArg, ...sessionArg, limit);
    return /** @type {ConversationTurn[]} */ (rows);
}

/**
 * Obtém um turno específico pelo id.
 *
 * @param {import('#copilot/infra/public/database/sqlite').SqliteDatabasePort} db
 * @param {number} turnId
 * @returns {ConversationTurn | null}
 */
export function getTurn(db, turnId) {
    const row = db.prepare('SELECT * FROM copilot_conversation_turns WHERE id = ?').get(turnId);
    return row ? /** @type {ConversationTurn} */ (row) : null;
}

/**
 * Conta os turns de uma hub_session.
 *
 * @param {import('#copilot/infra/public/database/sqlite').SqliteDatabasePort} db
 * @param {string} hubSessionId
 * @returns {number}
 */
export function countTurns(db, hubSessionId) {
    const row = /** @type {{ count: number }} */ (
        db
            .prepare('SELECT COUNT(*) as count FROM copilot_conversation_turns WHERE hub_session_id = ?')
            .get(hubSessionId)
    );
    return row?.count ?? 0;
}
