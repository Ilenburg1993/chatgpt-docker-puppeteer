// @ts-check
/**
 * src/copilot/db/migrations.js
 *
 * Migrations formais para o banco de dados isolado `copilot.sqlite`.
 *
 * Padrão idêntico ao `src/infra/db/migrations.js` (SSOT central), mas de escopo exclusivo do módulo copilot. Não há
 * dependências das tabelas do domínio principal (missions, tasks, artifacts, etc.) — qualquer integração com o
 * workspace é feita via HTTP (task-tools.js).
 *
 * Convenção:
 *
 * - Cada migration é append-only e idempotente (IF NOT EXISTS / DROP IF EXISTS).
 * - O campo `up` é SQL; `upFn` é alternativa para lógica imperativa.
 * - Versões não podem ser reutilizadas.
 *
 * @module copilot/db/migrations
 * @see EventBus
 * @see module:copilot/db/sqlite
 * @see module:copilot/conversation-hub/store
 */

/**
 * @typedef {Object} CopilotMigration
 * @property {number} version - Versão única incremental
 * @property {string} name - Nome descritivo (sem espaços)
 * @property {string} [up] - SQL puro
 * @property {(db: import('better-sqlite3').Database) => void} [upFn] - Alternativa imperativa
 */

/** @type {CopilotMigration[]} */
const COPILOT_MIGRATIONS = [
    {
        version: 1,
        name: 'create_hub_sessions',
        up: `
            CREATE TABLE IF NOT EXISTS copilot_hub_sessions (
                id              TEXT PRIMARY KEY,
                sdk_session_id  TEXT,
                title           TEXT NOT NULL DEFAULT 'Conversa sem título',
                status          TEXT NOT NULL DEFAULT 'active',
                metadata        TEXT,
                created_at      INTEGER NOT NULL,
                updated_at      INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_hub_sessions_status
                ON copilot_hub_sessions(status, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_hub_sessions_sdk
                ON copilot_hub_sessions(sdk_session_id);
        `,
    },
    {
        version: 2,
        name: 'create_conversation_turns',
        up: `
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
                FOREIGN KEY (hub_session_id) REFERENCES copilot_hub_sessions(id) ON DELETE CASCADE,
                CONSTRAINT uq_hub_turn UNIQUE (hub_session_id, turn_number)
            );
            CREATE INDEX IF NOT EXISTS idx_conv_turns_session
                ON copilot_conversation_turns(hub_session_id, turn_number);
            CREATE INDEX IF NOT EXISTS idx_conv_turns_time
                ON copilot_conversation_turns(created_at DESC);
            -- UPG-05: índice para markAllUserMessagesRead() — filtra por role='user' + user_read=0
            CREATE INDEX IF NOT EXISTS idx_conv_turns_user_unread
                ON copilot_conversation_turns(hub_session_id)
                WHERE role = 'user' AND user_read = 0;
        `,
    },
    {
        version: 3,
        name: 'create_turns_fts5',
        up: `
            CREATE VIRTUAL TABLE IF NOT EXISTS copilot_turns_fts USING fts5(
                id UNINDEXED,
                hub_session_id UNINDEXED,
                content,
                content='copilot_conversation_turns',
                content_rowid='id',
                tokenize='porter unicode61 remove_diacritics 1'
            );
            CREATE TRIGGER IF NOT EXISTS turns_ai
                AFTER INSERT ON copilot_conversation_turns BEGIN
                    INSERT INTO copilot_turns_fts(rowid, id, hub_session_id, content)
                    VALUES (new.id, new.id, new.hub_session_id, new.content);
                END;
            CREATE TRIGGER IF NOT EXISTS turns_au
                AFTER UPDATE ON copilot_conversation_turns BEGIN
                    INSERT INTO copilot_turns_fts(copilot_turns_fts, rowid, id, hub_session_id, content)
                        VALUES('delete', old.id, old.id, old.hub_session_id, old.content);
                    INSERT INTO copilot_turns_fts(rowid, id, hub_session_id, content)
                        VALUES (new.id, new.id, new.hub_session_id, new.content);
                END;
            CREATE TRIGGER IF NOT EXISTS turns_ad
                AFTER DELETE ON copilot_conversation_turns BEGIN
                    INSERT INTO copilot_turns_fts(copilot_turns_fts, rowid, id, hub_session_id, content)
                        VALUES('delete', old.id, old.id, old.hub_session_id, old.content);
                END;
        `,
    },
    {
        version: 4,
        name: 'create_memories',
        up: `
            CREATE TABLE IF NOT EXISTS copilot_memories (
                id          TEXT PRIMARY KEY,
                hub_session_id TEXT,
                tag         TEXT NOT NULL DEFAULT 'geral',
                content     TEXT NOT NULL,
                metadata    TEXT,
                created_at  INTEGER NOT NULL,
                updated_at  INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_memories_tag ON copilot_memories(tag, created_at DESC);
            CREATE VIRTUAL TABLE IF NOT EXISTS copilot_memories_fts USING fts5(
                id UNINDEXED,
                tag,
                content,
                content='copilot_memories',
                content_rowid='rowid',
                tokenize='porter unicode61 remove_diacritics 1'
            );
            CREATE TRIGGER IF NOT EXISTS memories_ai
                AFTER INSERT ON copilot_memories BEGIN
                    INSERT INTO copilot_memories_fts(rowid, id, tag, content)
                    VALUES (new.rowid, new.id, new.tag, new.content);
                END;
            CREATE TRIGGER IF NOT EXISTS memories_au
                AFTER UPDATE ON copilot_memories BEGIN
                    INSERT INTO copilot_memories_fts(copilot_memories_fts, rowid, id, tag, content)
                        VALUES('delete', old.rowid, old.id, old.tag, old.content);
                    INSERT INTO copilot_memories_fts(rowid, id, tag, content)
                        VALUES (new.rowid, new.id, new.tag, new.content);
                END;
            CREATE TRIGGER IF NOT EXISTS memories_ad
                AFTER DELETE ON copilot_memories BEGIN
                    INSERT INTO copilot_memories_fts(copilot_memories_fts, rowid, id, tag, content)
                        VALUES('delete', old.rowid, old.id, old.tag, old.content);
                END;
        `,
    },
    {
        version: 5,
        name: 'create_todo_tasks',
        up: `
            CREATE TABLE IF NOT EXISTS copilot_todo_tasks (
                id          TEXT PRIMARY KEY,
                data        TEXT NOT NULL,
                status      TEXT GENERATED ALWAYS AS (json_extract(data, '$.status')) STORED,
                priority    TEXT GENERATED ALWAYS AS (json_extract(data, '$.priority')) STORED,
                parent_id   TEXT GENERATED ALWAYS AS (json_extract(data, '$.parentId')) STORED,
                created_at  TEXT GENERATED ALWAYS AS (json_extract(data, '$.createdAt')) STORED,
                updated_at  TEXT GENERATED ALWAYS AS (json_extract(data, '$.updatedAt')) STORED
            ) STRICT;
            CREATE INDEX IF NOT EXISTS idx_todo_status    ON copilot_todo_tasks(status);
            CREATE INDEX IF NOT EXISTS idx_todo_priority  ON copilot_todo_tasks(priority);
            CREATE INDEX IF NOT EXISTS idx_todo_parent_id ON copilot_todo_tasks(parent_id);
            CREATE INDEX IF NOT EXISTS idx_todo_created   ON copilot_todo_tasks(created_at);
        `,
    },
    {
        version: 6,
        name: 'fix_llm_b_role_hyphen',
        // BUG-CRIT-03: corrigir role 'llm-b' (hífen) para 'llm_b' (underscore canônico)
        // Idempotente — linhas já corrigidas não são afetadas.
        up: `UPDATE copilot_conversation_turns SET role = 'llm_b' WHERE role = 'llm-b';`,
    },
    {
        version: 7,
        name: 'add_sdk_turn_id_column',
        // C11-03: adicionar coluna sdk_turn_id indexada para deduplicação O(1) em syncFromSdkHistory
        // Substitui o LIKE scan em metadata JSON que era O(n) sem índice
        up: `
            ALTER TABLE copilot_conversation_turns ADD COLUMN sdk_turn_id TEXT;
            CREATE UNIQUE INDEX IF NOT EXISTS idx_conv_turns_sdk_id
                ON copilot_conversation_turns(hub_session_id, sdk_turn_id)
                WHERE sdk_turn_id IS NOT NULL;
        `,
    },
];

export { COPILOT_MIGRATIONS };
