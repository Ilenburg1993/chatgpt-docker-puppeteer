// @ts-check
/**
 * src/copilot/conversation-hub/store-sync.js
 *
 * Funções de sincronização SDK → ConversationStore extraídas para reduzir o God Module.
 *
 * @module copilot/conversation-hub/store-sync
 * @see EventBus
 */

import { log } from '#copilot/observability';

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
 * @param {import('better-sqlite3').Database} db
 * @param {string} hubSessionId - ID da hub_session destino
 * @param {string} sdkSessionId - ID da sessão SDK de origem
 * @param {{ id?: string; type: string; content: string; createdAt?: number }[]} messages
 * @returns {{ synced: number; skipped: number }}
 */
export function syncFromSdkHistory(db, hubSessionId, sdkSessionId, messages) {
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
