// @ts-check
/**
 * src/copilot/conversation-hub/store.js
 *
 * ConversationStore — persistência SQLite para o ambiente permanente LLM-A ↔ LLM-B ↔ Usuário.
 *
 * Usa o mesmo DB maestro.sqlite do projeto (via getDb()) com tabelas adicionais para gerenciar hub_sessions e
 * conversation_turns independentemente das sessões SDK do AlwaysAliveAgent.
 *
 * @module copilot/conversation-hub/store
 */

import { log } from '#core/logger';
import { getDb } from '#infra/db/sqlite';
import { v4 as uuidv4 } from 'uuid';

// ─── Constantes ──────────────────────────────────────────────────────────────

/** @typedef {'llm_a' | 'llm_b' | 'user'} TurnRole */
/** @typedef {'active' | 'closed' | 'error'} HubSessionStatus */

/**
 * @typedef {Object} HubSession
 * @property {string} id - UUID único da sessão do hub
 * @property {string} [sdk_session_id] - sessionId do SDK AlwaysAliveAgent (pode mudar por restart)
 * @property {string} title - Título legível da sessão
 * @property {HubSessionStatus} status - Estado da sessão
 * @property {string} [metadata] - JSON de metadados extras
 * @property {number} created_at - Unix timestamp ms
 * @property {number} updated_at - Unix timestamp ms
 */

/**
 * @typedef {Object} ConversationTurn
 * @property {number} id - ID autoincrement
 * @property {string} hub_session_id - FK para hub_sessions.id
 * @property {string} [sdk_session_id] - sessionId do SDK no momento do turno
 * @property {TurnRole} role - Quem enviou ('llm_a' | 'llm_b' | 'user')
 * @property {string} content - Texto raw ou serializado da mensagem
 * @property {string} [structured] - JSON StructuredMessage (nullable)
 * @property {string} [tools_used] - JSON array de ferramentas invocadas
 * @property {number} turn_number - Número sequencial do turno na sessão
 * @property {number} created_at - Unix timestamp ms
 * @property {number} [duration_ms] - Duração do turno em ms (para LLM-B)
 * @property {string} [model] - Modelo usado ('gpt-4.1' | 'copilot-claude-sonnet-4.6')
 * @property {boolean} [user_read] - Se o usuário leu (para mensagens injetadas pelo usuário)
 * @property {string} [metadata] - JSON livre para extensão
 */

/**
 * @typedef {Object} WriteTurnOpts
 * @property {TurnRole} role
 * @property {string} content
 * @property {string} [sdkSessionId]
 * @property {object | string | null} [structured]
 * @property {string[] | null} [toolsUsed]
 * @property {number | null} [durationMs]
 * @property {string | null} [model]
 * @property {object | null} [metadata]
 */

/**
 * @typedef {Object} ReadTurnsOpts
 * @property {number} [limit] - Máximo de registros (default 50)
 * @property {number} [offset] - Offset para paginação (default 0)
 * @property {number} [after] - Retornar apenas turns com id > after
 */

// ─── DDL (gerenciado aqui, não via migrations principais) ────────────────────

const DDL_HUB_SESSIONS = `
    CREATE TABLE IF NOT EXISTS copilot_hub_sessions (
        id              TEXT PRIMARY KEY,
        sdk_session_id  TEXT,
        title           TEXT NOT NULL DEFAULT 'Conversa sem título',
        status          TEXT NOT NULL DEFAULT 'active',
        metadata        TEXT,
        created_at      INTEGER NOT NULL,
        updated_at      INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hub_sessions_status ON copilot_hub_sessions(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_hub_sessions_sdk ON copilot_hub_sessions(sdk_session_id);
`;

const DDL_CONVERSATION_TURNS = `
    CREATE TABLE IF NOT EXISTS copilot_conversation_turns (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        hub_session_id  TEXT NOT NULL,
        sdk_session_id  TEXT,
        role            TEXT NOT NULL,
        content         TEXT NOT NULL,
        structured      TEXT,
        tools_used      TEXT,
        turn_number     INTEGER NOT NULL,
        created_at      INTEGER NOT NULL,
        duration_ms     INTEGER,
        model           TEXT,
        user_read       INTEGER NOT NULL DEFAULT 1,
        metadata        TEXT,
        FOREIGN KEY (hub_session_id) REFERENCES copilot_hub_sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_conv_turns_session ON copilot_conversation_turns(hub_session_id, turn_number);
    CREATE INDEX IF NOT EXISTS idx_conv_turns_time ON copilot_conversation_turns(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_conv_turns_unread ON copilot_conversation_turns(hub_session_id, user_read)
        WHERE user_read = 0;
`;

// ─── ConversationStore ────────────────────────────────────────────────────────

/**
 * Persistência SQLite para o Conversation Hub.
 *
 * Usa a mesma instância do DB maestro.sqlite do projeto. As tabelas são criadas via DDL inline (não via migrations
 * principais para não acoplá-las ao ciclo de lifecycle das migrations de missões).
 */
export class ConversationStore {
    /** @type {import('better-sqlite3').Database | null} */
    #db = null;

    /** @type {boolean} */
    #initialized = false;

    /**
     * Inicializa as tabelas (idempotente — CREATE TABLE IF NOT EXISTS). Deve ser chamado uma vez antes de usar qualquer
     * outro método.
     *
     * @param {import('better-sqlite3').Database} [dbOverride] - DB a usar em vez do padrão (útil em testes).
     * @returns {void}
     */
    init(dbOverride) {
        if (this.#initialized) return;

        try {
            this.#db = dbOverride ?? getDb();
            this.#db.exec(DDL_HUB_SESSIONS);
            this.#db.exec(DDL_CONVERSATION_TURNS);
            this.#initialized = true;
            log('DEBUG', '[ConversationStore] Tabelas inicializadas.');
        } catch (/** @type {any} */ err) {
            log('ERROR', `[ConversationStore] Falha ao inicializar tabelas: ${err.message}`);
            throw err;
        }
    }

    /**
     * Garante que o store foi inicializado antes de qualquer operação.
     *
     * @returns {import('better-sqlite3').Database}
     * @throws {Error} Se init() não foi chamado
     */
    #getDb() {
        if (!this.#db || !this.#initialized) {
            throw new Error('[ConversationStore] store.init() não foi chamado.');
        }
        return this.#db;
    }

    // ─── HubSessions ──────────────────────────────────────────────────────────

    /**
     * Cria uma nova hub_session.
     *
     * @param {{ title?: string; sdkSessionId?: string; metadata?: object }} [opts]
     * @returns {string} O id da hub_session criada
     */
    createHubSession(opts = {}) {
        const db = this.#getDb();
        const id = uuidv4();
        const now = Date.now();

        db.prepare(
            `INSERT INTO copilot_hub_sessions (id, sdk_session_id, title, status, metadata, created_at, updated_at)
             VALUES (?, ?, ?, 'active', ?, ?, ?)`,
        ).run(
            id,
            opts.sdkSessionId ?? null,
            opts.title ?? 'Conversa sem título',
            opts.metadata ? JSON.stringify(opts.metadata) : null,
            now,
            now,
        );

        log('DEBUG', `[ConversationStore] Hub session criada: ${id}`);
        return id;
    }

    /**
     * Obtém uma hub_session pelo id.
     *
     * @param {string} hubSessionId
     * @returns {HubSession | null}
     */
    getHubSession(hubSessionId) {
        const db = this.#getDb();
        const row = db.prepare('SELECT * FROM copilot_hub_sessions WHERE id = ?').get(hubSessionId);
        return row ? /** @type {HubSession} */ (row) : null;
    }

    /**
     * Atualiza o sdk_session_id de uma hub_session (por ex, após restart do SDK).
     *
     * @param {string} hubSessionId
     * @param {string} sdkSessionId
     * @returns {void}
     */
    updateSdkSession(hubSessionId, sdkSessionId) {
        const db = this.#getDb();
        db.prepare(`UPDATE copilot_hub_sessions SET sdk_session_id = ?, updated_at = ? WHERE id = ?`).run(
            sdkSessionId,
            Date.now(),
            hubSessionId,
        );
    }

    /**
     * Fecha uma hub_session.
     *
     * @param {string} hubSessionId
     * @returns {void}
     */
    closeHubSession(hubSessionId) {
        const db = this.#getDb();
        db.prepare(`UPDATE copilot_hub_sessions SET status = 'closed', updated_at = ? WHERE id = ?`).run(
            Date.now(),
            hubSessionId,
        );
        log('DEBUG', `[ConversationStore] Hub session encerrada: ${hubSessionId}`);
    }

    /**
     * Lista hub_sessions (paginado, mais recentes primeiro).
     *
     * @param {{ limit?: number; offset?: number; status?: HubSessionStatus }} [opts]
     * @returns {HubSession[]}
     */
    listHubSessions(opts = {}) {
        const db = this.#getDb();
        const limit = opts.limit ?? 20;
        const offset = opts.offset ?? 0;

        if (opts.status) {
            return /** @type {HubSession[]} */ (
                db
                    .prepare(
                        `SELECT * FROM copilot_hub_sessions WHERE status = ?
                         ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
                    )
                    .all(opts.status, limit, offset)
            );
        }

        return /** @type {HubSession[]} */ (
            db
                .prepare(`SELECT * FROM copilot_hub_sessions ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
                .all(limit, offset)
        );
    }

    // ─── ConversationTurns ─────────────────────────────────────────────────────

    /**
     * Registra um turno de conversa.
     *
     * @param {string} hubSessionId - ID da hub_session
     * @param {WriteTurnOpts} opts
     * @returns {number} ID do turno inserido
     */
    writeTurn(hubSessionId, opts) {
        const db = this.#getDb();

        // Calcular o próximo turn_number para esta sessão
        const maxTurn = /** @type {{ max_turn: number | null }} */ (
            db
                .prepare(`SELECT MAX(turn_number) as max_turn FROM copilot_conversation_turns WHERE hub_session_id = ?`)
                .get(hubSessionId)
        );
        const turnNumber = (maxTurn?.max_turn ?? 0) + 1;

        // user_read: mensagens do usuário começam como "não lidas" (0) para que LLM-A as processe
        const userRead = opts.role === 'user' ? 0 : 1;

        const result = db
            .prepare(
                `INSERT INTO copilot_conversation_turns
                 (hub_session_id, sdk_session_id, role, content, structured, tools_used,
                  turn_number, created_at, duration_ms, model, user_read, metadata)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
                hubSessionId,
                opts.sdkSessionId ?? null,
                opts.role,
                opts.content,
                opts.structured
                    ? typeof opts.structured === 'string'
                        ? opts.structured
                        : JSON.stringify(opts.structured)
                    : null,
                opts.toolsUsed ? JSON.stringify(opts.toolsUsed) : null,
                turnNumber,
                Date.now(),
                opts.durationMs ?? null,
                opts.model ?? null,
                userRead,
                opts.metadata ? JSON.stringify(opts.metadata) : null,
            );

        // Atualizar updated_at da session
        db.prepare(`UPDATE copilot_hub_sessions SET updated_at = ? WHERE id = ?`).run(Date.now(), hubSessionId);

        return Number(result.lastInsertRowid);
    }

    /**
     * Lê os turns de uma hub_session (paginado, mais antigos primeiro).
     *
     * @param {string} hubSessionId
     * @param {ReadTurnsOpts} [opts]
     * @returns {ConversationTurn[]}
     */
    readTurns(hubSessionId, opts = {}) {
        const db = this.#getDb();
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
     * Obtém um turno específico pelo id.
     *
     * @param {number} turnId
     * @returns {ConversationTurn | null}
     */
    getTurn(turnId) {
        const db = this.#getDb();
        const row = db.prepare('SELECT * FROM copilot_conversation_turns WHERE id = ?').get(turnId);
        return row ? /** @type {ConversationTurn} */ (row) : null;
    }

    /**
     * Conta os turns de uma hub_session.
     *
     * @param {string} hubSessionId
     * @returns {number}
     */
    countTurns(hubSessionId) {
        const db = this.#getDb();
        const row = /** @type {{ count: number }} */ (
            db
                .prepare('SELECT COUNT(*) as count FROM copilot_conversation_turns WHERE hub_session_id = ?')
                .get(hubSessionId)
        );
        return row?.count ?? 0;
    }

    // ─── Mensagens do Usuário ─────────────────────────────────────────────────

    /**
     * Injeta uma mensagem do usuário na conversa. A mensagem é registrada como turn com user_read=0 para que LLM-A
     * possa processá-la via pollUserMessages().
     *
     * @param {string} hubSessionId
     * @param {string} content
     * @param {{ metadata?: object }} [opts]
     * @returns {number} ID do turno inserido
     */
    injectUserMessage(hubSessionId, content, opts = {}) {
        return this.writeTurn(hubSessionId, {
            role: 'user',
            content,
            metadata: opts.metadata ?? null,
        });
    }

    /**
     * Retorna as mensagens do usuário ainda não processadas por LLM-A (user_read=0).
     *
     * @param {string} hubSessionId
     * @returns {ConversationTurn[]}
     */
    getPendingUserMessages(hubSessionId) {
        const db = this.#getDb();
        return /** @type {ConversationTurn[]} */ (
            db
                .prepare(
                    `SELECT * FROM copilot_conversation_turns
                     WHERE hub_session_id = ? AND role = 'user' AND user_read = 0
                     ORDER BY turn_number ASC`,
                )
                .all(hubSessionId)
        );
    }

    /**
     * Marca uma mensagem do usuário como lida (processada por LLM-A).
     *
     * @param {number} turnId
     * @returns {void}
     */
    markUserMessageRead(turnId) {
        const db = this.#getDb();
        db.prepare(`UPDATE copilot_conversation_turns SET user_read = 1 WHERE id = ?`).run(turnId);
    }

    /**
     * Marca todas as mensagens pendentes de uma sessão como lidas.
     *
     * @param {string} hubSessionId
     * @returns {number} Quantidade de mensagens marcadas
     */
    markAllUserMessagesRead(hubSessionId) {
        const db = this.#getDb();
        const result = db
            .prepare(
                `UPDATE copilot_conversation_turns SET user_read = 1
                 WHERE hub_session_id = ? AND role = 'user' AND user_read = 0`,
            )
            .run(hubSessionId);
        return result.changes;
    }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

/**
 * Instância única do ConversationStore para uso em toda a aplicação. Deve ser inicializada com
 * `conversationStore.init()` antes do uso.
 *
 * @type {ConversationStore}
 */
export const conversationStore = new ConversationStore();
