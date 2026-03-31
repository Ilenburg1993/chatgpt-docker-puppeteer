// @ts-check
/**
 * src/copilot/conversation-hub/store.js
 *
 * ConversationStore — persistência SQLite para o ambiente permanente LLM-A ↔ LLM-B ↔ Usuário.
 *
 * F7.5: migrado para o banco isolado copilot.sqlite via `getCopilotDb()`. As tabelas são criadas pelas migrations
 * formais em `src/copilot/db/migrations.js`, não mais por DDL inline neste arquivo.
 *
 * @module copilot/conversation-hub/store
 */

import { getCopilotDb } from '#copilot/db/sqlite';
import { log } from '#core/logger';
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
 * @property {0 | 1} [user_read] - Se a mensagem foi processada (0=pendente, 1=processada)
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

/**
 * @typedef {Object} SearchTurnsOpts
 * @property {string} query - Query FTS5 para busca em content
 * @property {string} [hubSessionId] - Filtrar por sessão específica
 * @property {string} [role] - Filtrar por role (user, llm_b, etc.)
 * @property {number} [limit] - Máximo de registros (default 20)
 */

// ─── DDL movido para src/copilot/db/migrations.js (F7.3) ─────────────────────
// As tabelas copilot_hub_sessions, copilot_conversation_turns, FTS5 e copilot_memories
// são criadas pelas migrations v1–v4 no banco copilot.sqlite. O DDL inline foi removido.

/**
 * Popula a tabela FTS5 de turns caso ela esteja vazia mas a tabela de conteúdo não. Executado após migrations para
 * bancos pré-existentes que migraram do maestro.sqlite.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {void}
 */
function initTurnsFts(db) {
    try {
        /** @type {{ count: number } | undefined} */
        const ftsCount = /** @type {any} */ (db.prepare('SELECT COUNT(*) AS count FROM copilot_turns_fts').get());
        /** @type {{ count: number } | undefined} */
        const turnCount = /** @type {any} */ (
            db.prepare('SELECT COUNT(*) AS count FROM copilot_conversation_turns').get()
        );
        if ((ftsCount?.count ?? 0) === 0 && (turnCount?.count ?? 0) > 0) {
            log('INFO', '[ConversationStore] UPG-PROP-06: populando copilot_turns_fts a partir de dados existentes...');
            db.exec(`
                INSERT INTO copilot_turns_fts(rowid, id, hub_session_id, content)
                SELECT id, id, hub_session_id, content FROM copilot_conversation_turns;
            `);
            log('INFO', '[ConversationStore] UPG-PROP-06: copilot_turns_fts populado.');
        }
    } catch (/** @type {any} */ err) {
        log('WARN', `[ConversationStore] UPG-PROP-06: falha ao inicializar turns FTS5: ${err.message}`);
    }
}

// ─── FTS5 tokenizer migration (PERF-03) ──────────────────────────────────────

/**
 * Migra `copilot_memories_fts` para usar o tokenizer `porter unicode61 remove_diacritics 1`.
 *
 * A tabela FTS5 não suporta ALTER TABLE, então a migração recria a estrutura completa caso o tokenizer atual seja
 * diferente. É idempotente: não faz nada se o tokenizer já estiver correto.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {void}
 */
function migrateFts5Tokenizer(db) {
    const TARGET_TOKENIZER = 'porter unicode61 remove_diacritics 1';
    try {
        // FTS5 expõe configuração via tabela shadow <nome>_config
        /** @type {{ v?: string } | undefined} */
        const row = /** @type {any} */ (
            db.prepare("SELECT v FROM copilot_memories_fts_config WHERE k='tokenize'").get()
        );
        // Se o tokenizer já é o correto (ou a tabela foi recém-criada com IF NOT EXISTS no DDL), nada a fazer
        if (!row || row.v === TARGET_TOKENIZER) return;
        log('INFO', '[ConversationStore] PERF-03: migrando FTS5 para porter unicode61...');
    } catch {
        // tabela shadow ainda não existe — será criada com o tokenizer correto pelo DDL
        return;
    }
    // Recriar tabela com tokenizer correto, preservando dados existentes
    db.exec(`
        DROP TABLE IF EXISTS copilot_memories_fts;
        CREATE VIRTUAL TABLE copilot_memories_fts USING fts5(
            id UNINDEXED,
            tag,
            content,
            content='copilot_memories',
            content_rowid='rowid',
            tokenize='porter unicode61 remove_diacritics 1'
        );
        -- Repopular a partir dos dados persistidos
        INSERT INTO copilot_memories_fts(rowid, id, tag, content)
        SELECT rowid, id, tag, content FROM copilot_memories;
    `);
    log('INFO', '[ConversationStore] PERF-03: FTS5 migrado com sucesso.');
}

// ─── Helpers FTS5 ─────────────────────────────────────────────────────────────

/**
 * Sanitiza uma query para uso seguro em FTS5 MATCH. Remove metacaracteres e operadores reservados para evitar FTS5
 * injection e erros de parse.
 *
 * @param {string} raw - Query bruta do usuário
 * @returns {string | null} Query sanitizada pronta para MATCH, ou null se vazia após sanitização
 */
function sanitizeFtsQuery(raw) {
    const sanitized = raw
        .replace(/[*^"():|&!,-]/g, ' ')
        .replace(/\b(AND|OR|NOT|NEAR)\b/gi, ' ')
        .trim();
    if (!sanitized) return null;
    return `"${sanitized}"`;
}

// ─── ConversationStore ────────────────────────────────────────────────────────

/**
 * Persistência SQLite para o Conversation Hub.
 *
 * F7.5: usa o banco isolado copilot.sqlite via getCopilotDb(). As tabelas são criadas pelas migrations formais em
 * src/copilot/db/migrations.js (não mais por DDL inline).
 */
export class ConversationStore {
    /** @type {import('better-sqlite3').Database | null} */
    #db = null;

    /** @type {boolean} */
    #initialized = false;

    // ARCH-04 (fix): armazenar referência do timer para clearInterval() no close()
    /** @type {ReturnType<typeof setInterval> | null} */
    #checkpointTimer = null;

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
            // F7.5: usar banco isolado copilot.sqlite; em testes passa-se dbOverride (:memory:)
            this.#db = dbOverride ?? getCopilotDb();
            const db = this.#db;
            migrateFts5Tokenizer(db);
            initTurnsFts(db);

            this.#initialized = true;
            log('DEBUG', '[ConversationStore] Tabelas inicializadas.');

            // MELHORIA-09 (fix): agendar WAL checkpoint periódico para evitar acúmulo do WAL file
            // em sessões de longa duração. O checkpoint passivo (PASSIVE) não bloqueia readers.
            let _checkpointErrors = 0;
            const checkpointTimer = setInterval(
                () => {
                    try {
                        db.pragma('wal_checkpoint(PASSIVE)');
                        _checkpointErrors = 0; // resetar contador em sucesso
                    } catch (/** @type {any} */ err) {
                        _checkpointErrors++;
                        // GAP-Q07 fix: emitir warning após 10 erros consecutivos
                        if (_checkpointErrors >= 10) {
                            log(
                                'WARN',
                                `[ConversationStore] WAL checkpoint falhou ${_checkpointErrors}x consecutivas: ${err.message}`,
                            );
                        }
                    }
                },
                5 * 60 * 1000,
            ); // a cada 5 minutos
            checkpointTimer.unref?.(); // não impede o processo de sair
            this.#checkpointTimer = checkpointTimer; // ARCH-04 (fix): manter referência
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

    /**
     * Encerra o store: cancela o timer de WAL checkpoint. Deve ser chamado em testes ou em shutdown graceful do
     * servidor.
     *
     * ARCH-04 (fix): sem este método, o timer fica pendente impedindo o processo de sair naturalmente em ambientes onde
     * não se usa .unref() (ex: algumas versões de Bun/Deno).
     *
     * @returns {void}
     */
    close() {
        if (this.#checkpointTimer !== null) {
            clearInterval(this.#checkpointTimer);
            this.#checkpointTimer = null;
        }
        this.#initialized = false;
        this.#db = null;
    }

    // ─── HubSessions ──────────────────────────────────────────────────────────

    /**
     * Expõe o banco SQLite para health checks externos (somente leitura recomendada). Retorna `null` se `init()` ainda
     * não foi chamado.
     *
     * @returns {import('better-sqlite3').Database | null}
     */
    get db() {
        return this.#db;
    }

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
     * @returns {Promise<number>} ID do turno inserido
     */
    async writeTurn(hubSessionId, opts) {
        const db = this.#getDb();

        // BUG-01 (fix): UNIQUE constraint (hub_session_id, turn_number) protege contra insert duplicado.
        // Em cenário com SQLite WAL mode e dois writers simultâneos, o segundo recebe SQLITE_CONSTRAINT
        // e faz retry automaticamente, relendo o MAX(turn_number) para obter o valor correto.
        const doWrite = db.transaction(() => {
            // Calcular o próximo turn_number para esta sessão
            const maxTurn = /** @type {{ max_turn: number | null }} */ (
                db
                    .prepare(
                        `SELECT MAX(turn_number) as max_turn FROM copilot_conversation_turns WHERE hub_session_id = ?`,
                    )
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
        });

        // Retry com backoff para conflicts de UNIQUE constraint (race condition WAL)
        // BUG-C02 (fix): substituído Atomics.wait() (bloqueava event loop) por sleep async
        const WRITE_MAX_RETRIES = 3;
        const RETRY_DELAYS_MS = [5, 15, 40];
        const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
        for (let attempt = 0; attempt < WRITE_MAX_RETRIES; attempt++) {
            try {
                return doWrite();
            } catch (/** @type {any} */ err) {
                const isConstraint = err?.code === 'SQLITE_CONSTRAINT_UNIQUE' || err?.code === 'SQLITE_CONSTRAINT';
                if (!isConstraint || attempt === WRITE_MAX_RETRIES - 1) throw err;
                log(
                    'WARN',
                    `[ConversationStore] writeTurn conflict (attempt=${attempt + 1}), retrying in ${RETRY_DELAYS_MS[attempt] ?? 5}ms...`,
                );
                await sleep(RETRY_DELAYS_MS[attempt] ?? 5);
            }
        }
        /* c8 ignore next */
        throw new Error('[ConversationStore] writeTurn: todos os retries esgotados sem sucesso (SQLITE_CONSTRAINT)');
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
     * Busca turns por conteúdo usando FTS5 (fulltext search).
     *
     * @param {SearchTurnsOpts} opts
     * @returns {ConversationTurn[]}
     */
    searchTurns(opts) {
        const db = this.#getDb();
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
     * @returns {Promise<number>} ID do turno inserido
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

    // ─── Memórias Semânticas (P5) ─────────────────────────────────────────────

    /**
     * Persiste uma memória semântica com tag livre.
     *
     * @param {{ tag?: string; content: string; hubSessionId?: string; metadata?: object }} opts
     * @returns {string} ID da memória criada
     */
    storeMemory(opts) {
        const db = this.#getDb();
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
     * @param {{ tag?: string; search?: string; limit?: number; hubSessionId?: string }} [opts]
     * @returns {{ id: string; tag: string; content: string; created_at: number; hub_session_id: string | null }[]}
     */
    recallMemories(opts = {}) {
        const db = this.#getDb();
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
     * @param {string} memoryId
     * @returns {boolean} true se removida
     */
    deleteMemory(memoryId) {
        const db = this.#getDb();
        const result = db.prepare('DELETE FROM copilot_memories WHERE id = ?').run(memoryId);
        return result.changes > 0;
    }

    /**
     * AI.4 — Sincroniza o histórico do SDK (`session.getHistory()`) para o schema `turns` do ConversationStore. Utiliza
     * `INSERT OR IGNORE` para idempotência — mensagens já existentes não são duplicadas.
     *
     * O mapeamento é:
     *
     * - `ConversationMessage.type = 'user'` → `role: 'user'`
     * - `ConversationMessage.type = 'assistant'` → `role: 'llm_b'` (underscore, canônico)
     * - `ConversationMessage.content` → `content`
     * - `ConversationMessage.id` → usado como `metadata.sdkTurnId` para dedup
     *
     * @param {string} hubSessionId - ID da hub_session destino
     * @param {string} sdkSessionId - ID da sessão SDK de origem
     * @param {{ id?: string; type: string; content: string; createdAt?: number }[]} messages
     * @returns {{ synced: number; skipped: number }}
     */
    syncFromSdkHistory(hubSessionId, sdkSessionId, messages) {
        const db = this.#getDb();
        let synced = 0;
        let skipped = 0;

        const doSync = db.transaction(() => {
            for (const msg of messages) {
                // BUG-CRIT-03 fix: underscore canônico alinhado com TurnRole typedef ('llm_b', não 'llm-b')
                const role = msg.type === 'assistant' ? 'llm_b' : 'user';
                const sdkTurnId = msg.id ?? null;
                const metadata = sdkTurnId ? JSON.stringify({ sdkTurnId }) : null;

                // INSERT OR IGNORE pelo sdkTurnId para idempotência
                // Usamos sdk_session_id + metadata.sdkTurnId como chave natural de dedup
                if (sdkTurnId) {
                    // Escapar metacaracteres SQL LIKE (% e _) para evitar match acidental de outras linhas
                    const escapedId = sdkTurnId.replace(/%/g, '\\%').replace(/_/g, '\\_');
                    const exists = db
                        .prepare(
                            `SELECT 1 FROM copilot_conversation_turns
                             WHERE hub_session_id = ? AND metadata LIKE ? ESCAPE '\\'`,
                        )
                        .get(hubSessionId, `%${escapedId}%`);
                    if (exists) {
                        skipped++;
                        continue;
                    }
                }

                const maxTurn = /** @type {{ max_turn: number | null }} */ (
                    db
                        .prepare(
                            `SELECT MAX(turn_number) as max_turn FROM copilot_conversation_turns WHERE hub_session_id = ?`,
                        )
                        .get(hubSessionId)
                );
                const turnNumber = (maxTurn?.max_turn ?? 0) + 1;

                db.prepare(
                    `INSERT INTO copilot_conversation_turns
                     (hub_session_id, sdk_session_id, role, content, turn_number, created_at, user_read, metadata)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                ).run(
                    hubSessionId,
                    sdkSessionId,
                    role,
                    msg.content ?? '',
                    turnNumber,
                    msg.createdAt ?? Date.now(),
                    1, // mensagens históricas: marcadas como lidas
                    metadata,
                );
                synced++;
            }
        });

        doSync();
        log('DEBUG', `[ConversationStore] syncFromSdkHistory: ${synced} sincronizados, ${skipped} ignorados (dupl).`);
        return { synced, skipped };
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
