// @ts-check
/**
 * src/copilot/conversation-hub/store.js
 *
 * ConversationStore — persistência SQLite para o ambiente permanente LLM-A ↔ LLM-B ↔ Usuário.
 *
 * F7.5: migrado para o banco isolado copilot.sqlite via `getCopilotDb()`. As tabelas são criadas pelas migrations
 * formais em `src/copilot/db/migrations.js`, não mais por DDL inline neste arquivo.
 *
 * Tipos e helpers FTS5 vivem em `store-helpers.js` para manter este módulo focado na classe.
 *
 * @module copilot/conversation-hub/store
 * @see module:copilot/conversation-hub/store-helpers
 * @see module:copilot/conversation-hub/orchestrator
 * @see module:copilot/db/sqlite
 */

import { SessionError } from '#copilot/core/errors';
import { getCopilotDb } from '#copilot/db/sqlite';
import { log } from '#copilot/observability/logger';
import { v4 as uuidv4 } from 'uuid';
import { initTurnsFts, migrateFts5Tokenizer, sanitizeFtsQuery } from './store-helpers.js';

/**
 * @deprecated F33.1: Importar tipos diretamente de `./store-helpers.js`. Re-export de tipos para manter backward
 *   compatibility nas import paths existentes.
 * @typedef {import('./store-helpers.js').TurnRole} TurnRole
 *
 * @typedef {import('./store-helpers.js').HubSessionStatus} HubSessionStatus
 *
 * @typedef {import('./store-helpers.js').HubSession} HubSession
 *
 * @typedef {import('./store-helpers.js').ConversationTurn} ConversationTurn
 *
 * @typedef {import('./store-helpers.js').WriteTurnOpts} WriteTurnOpts
 *
 * @typedef {import('./store-helpers.js').ReadTurnsOpts} ReadTurnsOpts
 *
 * @typedef {import('./store-helpers.js').SearchTurnsOpts} SearchTurnsOpts
 */

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
     * @throws {SessionError} Se init() não foi chamado
     */
    #getDb() {
        if (!this.#db || !this.#initialized) {
            throw new SessionError('[ConversationStore] store.init() não foi chamado.', 'STORE_NOT_INITIALIZED');
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
     * F12.3: Persiste métricas de qualidade ao fechar uma sessão.
     *
     * Armazena no campo `metadata` da hub_session um objeto `_metrics` com totais de turnos, duração média por turno,
     * taxa de respostas estruturadas e timestamp de fechamento. Não sobrescreve campos existentes em `metadata` — faz
     * um merge superficial.
     *
     * @param {string} hubSessionId
     * @param {{
     *     totalTurns: number;
     *     avgTurnDurationMs: number;
     *     structuredResponseRate: number;
     *     closedAt?: number;
     * }} metrics
     * @returns {void}
     */
    recordHubSessionMetrics(hubSessionId, metrics) {
        const db = this.#getDb();
        const row = db.prepare('SELECT metadata FROM copilot_hub_sessions WHERE id = ?').get(hubSessionId);
        if (!row) return;
        /** @type {Record<string, unknown>} */
        let existing = {};
        try {
            existing = JSON.parse(/** @type {any} */ (row).metadata ?? '{}') ?? {};
        } catch {
            /* parse falhou — começa com objeto vazio */
        }
        const merged = {
            ...existing,
            _metrics: { ...metrics, closedAt: metrics.closedAt ?? Date.now() },
        };
        db.prepare(`UPDATE copilot_hub_sessions SET metadata = ?, updated_at = ? WHERE id = ?`).run(
            JSON.stringify(merged),
            Date.now(),
            hubSessionId,
        );
        log('DEBUG', `[ConversationStore] Métricas persistidas para sessão ${hubSessionId}`);
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

    /**
     * Conta sessões por status (ou total) com SELECT COUNT(*) — O(1) com índice. T-08: substitui
     * listHubSessions({limit:1000}).length no health check.
     *
     * @param {{ status?: string }} [opts]
     * @returns {number}
     */
    countHubSessions(opts = {}) {
        const db = this.#getDb();
        if (opts.status) {
            const row = /** @type {{ count: number }} */ (
                db.prepare(`SELECT COUNT(*) as count FROM copilot_hub_sessions WHERE status = ?`).get(opts.status)
            );
            return row?.count ?? 0;
        }
        const row = /** @type {{ count: number }} */ (
            db.prepare(`SELECT COUNT(*) as count FROM copilot_hub_sessions`).get()
        );
        return row?.count ?? 0;
    }

    // ─── ConversationTurns ─────────────────────────────────────────────────────

    /**
     * Registra um turno de conversa.
     *
     * @param {string} hubSessionId - ID da hub_session
     * @param {WriteTurnOpts} opts
     * @returns {Promise<number>} ID do turno inserido
     * @throws {Error} Se init() não foi chamado ou todos os retries esgotados (SQLITE_CONSTRAINT)
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
        throw new SessionError(
            '[ConversationStore] writeTurn: todos os retries esgotados sem sucesso (SQLITE_CONSTRAINT)',
            'STORE_WRITE_FAILED',
        );
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
                    // C11-03: usar coluna sdk_turn_id indexada para dedup O(1) (antes era LIKE scan O(n))
                    const exists = db
                        .prepare(
                            `SELECT 1 FROM copilot_conversation_turns
                             WHERE hub_session_id = ? AND sdk_turn_id = ?`,
                        )
                        .get(hubSessionId, sdkTurnId);
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
                     (hub_session_id, sdk_session_id, role, content, turn_number, created_at, user_read, metadata, sdk_turn_id)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                ).run(
                    hubSessionId,
                    sdkSessionId,
                    role,
                    msg.content ?? '',
                    turnNumber,
                    msg.createdAt ?? Date.now(),
                    1, // mensagens históricas: marcadas como lidas
                    metadata,
                    sdkTurnId,
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
