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

import { MODEL_GATEWAY_SQLITE_SCHEMA_SQL } from '../model-gateway/catalog/sqlite-schema.js';
import { ensureIoIndexSchema } from './io-index-schema.js';

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
    {
        version: 8,
        name: 'create_convergence_trace_events',
        // A.15: persistência durável de eventos de convergência SDK↔FS por traceId
        // Ring-buffer in-memory permanece como L1; SQLite é o L2 que sobrevive a restart.
        up: `
            CREATE TABLE IF NOT EXISTS copilot_convergence_trace_events (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                trace_id     TEXT NOT NULL,
                operation    TEXT NOT NULL,
                phase        TEXT NOT NULL,
                direction    TEXT,
                status       TEXT NOT NULL,
                bytes_read   INTEGER,
                bytes_written INTEGER,
                duration_ms  INTEGER,
                error_msg    TEXT,
                created_at_ms INTEGER NOT NULL
            ) STRICT;
            CREATE INDEX IF NOT EXISTS idx_conv_trace_trace_id
                ON copilot_convergence_trace_events(trace_id);
            CREATE INDEX IF NOT EXISTS idx_conv_trace_created
                ON copilot_convergence_trace_events(created_at_ms DESC);
            CREATE INDEX IF NOT EXISTS idx_conv_trace_op_status
                ON copilot_convergence_trace_events(operation, status);
        `,
    },
    {
        version: 9,
        name: 'create_io_cache_l2_entries',
        // A.13.x/L2 prep: estrutura durável para cache de leitura de arquivos (bytes/text/json)
        up: `
            CREATE TABLE IF NOT EXISTS copilot_io_cache_l2 (
                cache_key       TEXT PRIMARY KEY,
                file_path       TEXT NOT NULL,
                cache_kind      TEXT NOT NULL,
                payload         BLOB NOT NULL,
                encoding        TEXT,
                size_bytes      INTEGER NOT NULL,
                created_at_ms   INTEGER NOT NULL,
                expires_at_ms   INTEGER NOT NULL,
                mtime_ms        INTEGER,
                ctime_ms        INTEGER,
                meta_json       TEXT,
                last_accessed_ms INTEGER NOT NULL
            ) STRICT;
            CREATE INDEX IF NOT EXISTS idx_io_cache_l2_path
                ON copilot_io_cache_l2(file_path);
            CREATE INDEX IF NOT EXISTS idx_io_cache_l2_expires
                ON copilot_io_cache_l2(expires_at_ms);
            CREATE INDEX IF NOT EXISTS idx_io_cache_l2_access
                ON copilot_io_cache_l2(last_accessed_ms);
        `,
    },
    {
        version: 10,
        name: 'create_io_index_l2',
        // A.20/A.21: índice persistente separado do cache blob L2. Guarda metadados, FTS textual, símbolos e imports.
        up: `
            CREATE TABLE IF NOT EXISTS copilot_io_index_files (
                file_path       TEXT PRIMARY KEY,
                workspace_root  TEXT NOT NULL,
                relative_path   TEXT NOT NULL,
                file_name       TEXT NOT NULL,
                extension       TEXT NOT NULL,
                content_kind    TEXT NOT NULL,
                size_bytes      INTEGER NOT NULL,
                mtime_ms        REAL NOT NULL,
                ctime_ms        REAL,
                content_hash    TEXT,
                line_count      INTEGER NOT NULL DEFAULT 0,
                symbol_count    INTEGER NOT NULL DEFAULT 0,
                import_count    INTEGER NOT NULL DEFAULT 0,
                status          TEXT NOT NULL,
                parse_error     TEXT,
                indexed_at_ms   INTEGER NOT NULL,
                refreshed_at_ms INTEGER NOT NULL,
                metadata_json   TEXT
            ) STRICT;
            CREATE INDEX IF NOT EXISTS idx_io_index_files_workspace
                ON copilot_io_index_files(workspace_root, relative_path);
            CREATE INDEX IF NOT EXISTS idx_io_index_files_status
                ON copilot_io_index_files(status, indexed_at_ms DESC);
            CREATE INDEX IF NOT EXISTS idx_io_index_files_ext
                ON copilot_io_index_files(extension);

            CREATE VIRTUAL TABLE IF NOT EXISTS copilot_io_index_fts USING fts5(
                file_path UNINDEXED,
                relative_path,
                content,
                tokenize='porter unicode61 remove_diacritics 1'
            );

            CREATE TABLE IF NOT EXISTS copilot_io_index_symbols (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                file_path    TEXT NOT NULL,
                symbol_name  TEXT NOT NULL,
                symbol_kind  TEXT NOT NULL,
                exported     INTEGER NOT NULL DEFAULT 0,
                line         INTEGER NOT NULL DEFAULT 0,
                doc_comment  TEXT,
                FOREIGN KEY (file_path) REFERENCES copilot_io_index_files(file_path) ON DELETE CASCADE
            ) STRICT;
            CREATE INDEX IF NOT EXISTS idx_io_index_symbols_name
                ON copilot_io_index_symbols(symbol_name);
            CREATE INDEX IF NOT EXISTS idx_io_index_symbols_file
                ON copilot_io_index_symbols(file_path);

            CREATE TABLE IF NOT EXISTS copilot_io_index_imports (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                file_path       TEXT NOT NULL,
                source          TEXT NOT NULL,
                specifiers_json TEXT NOT NULL,
                is_dynamic      INTEGER NOT NULL DEFAULT 0,
                line            INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (file_path) REFERENCES copilot_io_index_files(file_path) ON DELETE CASCADE
            ) STRICT;
            CREATE INDEX IF NOT EXISTS idx_io_index_imports_source
                ON copilot_io_index_imports(source);
            CREATE INDEX IF NOT EXISTS idx_io_index_imports_file
                ON copilot_io_index_imports(file_path);
        `,
    },
    {
        version: 11,
        name: 'create_io_index_chunks',
        // A.19/A.22: chunks textuais persistentes para leitura/pesquisa incremental e respostas pagináveis.
        up: `
            CREATE TABLE IF NOT EXISTS copilot_io_index_chunks (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                file_path      TEXT NOT NULL,
                chunk_index    INTEGER NOT NULL,
                start_line     INTEGER NOT NULL,
                end_line       INTEGER NOT NULL,
                content        TEXT NOT NULL,
                content_hash   TEXT NOT NULL,
                created_at_ms  INTEGER NOT NULL,
                FOREIGN KEY (file_path) REFERENCES copilot_io_index_files(file_path) ON DELETE CASCADE,
                UNIQUE(file_path, chunk_index)
            ) STRICT;
            CREATE INDEX IF NOT EXISTS idx_io_index_chunks_file
                ON copilot_io_index_chunks(file_path, chunk_index);
        `,
    },
    {
        version: 12,
        name: 'create_model_gateway_catalog',
        // Model Gateway R.1: schema relacional reservado para catálogo universal, overlays e eligibility pré-runtime.
        up: MODEL_GATEWAY_SQLITE_SCHEMA_SQL,
    },
    {
        version: 13,
        name: 'create_mcp_http_sessions',
        up: `
            CREATE TABLE IF NOT EXISTS copilot_mcp_http_sessions (
                session_id_hash    TEXT PRIMARY KEY,
                session_id_preview TEXT NOT NULL,
                protocol_version   TEXT NOT NULL,
                created_at_ms      INTEGER NOT NULL,
                last_seen_at_ms    INTEGER NOT NULL,
                expires_at_ms      INTEGER NOT NULL,
                status             TEXT NOT NULL CHECK(status IN ('active', 'terminated', 'expired')),
                terminated_at_ms   INTEGER,
                terminate_reason   TEXT,
                auth_binding_json  TEXT NOT NULL,
                transport_json     TEXT NOT NULL
            ) STRICT;
            CREATE INDEX IF NOT EXISTS idx_mcp_http_sessions_status
                ON copilot_mcp_http_sessions(status, expires_at_ms);
            CREATE INDEX IF NOT EXISTS idx_mcp_http_sessions_last_seen
                ON copilot_mcp_http_sessions(last_seen_at_ms DESC);
        `,
    },
    {
        version: 14,
        name: 'create_mcp_http_events',
        up: `
            CREATE TABLE IF NOT EXISTS copilot_mcp_http_events (
                event_id TEXT PRIMARY KEY,
                stream_id TEXT NOT NULL,
                sequence INTEGER NOT NULL,
                message_json TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                expires_at_ms INTEGER NOT NULL,
                UNIQUE(stream_id, sequence)
            ) STRICT;
            CREATE INDEX IF NOT EXISTS idx_mcp_http_events_stream_seq
                ON copilot_mcp_http_events(stream_id, sequence);
            CREATE INDEX IF NOT EXISTS idx_mcp_http_events_expires
                ON copilot_mcp_http_events(expires_at_ms);
        `,
    },
    {
        version: 15,
        name: 'migrate_io_index_fts_to_chunks',
        upFn: ensureIoIndexSchema,
    },
];

export { COPILOT_MIGRATIONS };
