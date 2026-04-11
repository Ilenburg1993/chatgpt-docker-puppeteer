// @ts-check
/**
 * src/copilot/conversation-hub/store-helpers.js
 *
 * Tipos, helpers FTS5 e funções de inicialização usadas pelo ConversationStore.
 *
 * Extraído de store.js para reduzir o tamanho do módulo principal e manter responsabilidades claras.
 *
 * @module copilot/conversation-hub/store-helpers
 * @see EventBus
 * @see module:copilot/conversation-hub/store
 */

import { log } from '#copilot/observability';

// ─── Typedefs (re-exportadas por store.js) ────────────────────────────────────

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

// ─── FTS5 Init ────────────────────────────────────────────────────────────────

/**
 * Popula a tabela FTS5 de turns caso ela esteja vazia mas a tabela de conteúdo não. Executado após migrations para
 * bancos pré-existentes que migraram do maestro.sqlite.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {void}
 */
export function initTurnsFts(db) {
    try {
        /** @type {{ count: number } | undefined} */
        const ftsCount = /** @type {{ count: number } | undefined} */ (
            db.prepare('SELECT COUNT(*) AS count FROM copilot_turns_fts').get()
        );
        /** @type {{ count: number } | undefined} */
        const turnCount = /** @type {{ count: number } | undefined} */ (
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
export function migrateFts5Tokenizer(db) {
    const TARGET_TOKENIZER = 'porter unicode61 remove_diacritics 1';
    try {
        /** @type {{ v?: string } | undefined} */
        const row = /** @type {{ v?: string } | undefined} */ (
            db.prepare("SELECT v FROM copilot_memories_fts_config WHERE k='tokenize'").get()
        );
        if (!row || row.v === TARGET_TOKENIZER) return;
        log('INFO', '[ConversationStore] PERF-03: migrando FTS5 para porter unicode61...');
    } catch {
        return;
    }
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
export function sanitizeFtsQuery(raw) {
    const sanitized = raw
        .replace(/[*^"():|&!,-]/g, ' ')
        .replace(/\b(AND|OR|NOT|NEAR)\b/gi, ' ')
        .trim();
    if (!sanitized) return null;
    return `"${sanitized}"`;
}
