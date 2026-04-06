// @ts-check
/**
 * src/copilot/agent/session-cleanup.js
 *
 * F43.1 (GAP-SD-01): Limpeza proativa de sessões antigas no boot do agente.
 *
 * - Lista todas as sessões via `client.listSessions()`
 * - Deleta sessões com mais de `maxAgeMs` (padrão: 24h)
 * - Preserva a sessão ativa atual (se houver)
 *
 * @module copilot/agent/session-cleanup
 */

import { log } from '#copilot/observability/logger';
import { listSessions, deleteSession } from '#copilot/lib/session';

/**
 * @typedef {Object} SessionCleanupResult
 * @property {number} total - Sessões encontradas
 * @property {number} deleted - Sessões removidas
 * @property {string[]} deletedIds - IDs removidos
 * @property {number} kept - Sessões mantidas
 * @property {string[]} errors - Erros encontrados
 */

/**
 * Limpa sessões expiradas do servidor SDK.
 *
 * @param {import('@github/copilot-sdk').CopilotClient} client - Cliente SDK
 * @param {{
 *     maxAgeMs?: number;
 *     currentSessionId?: string | null;
 * }} [options]
 * @returns {Promise<SessionCleanupResult>}
 */
export async function cleanupStaleSessions(client, options = {}) {
    const maxAgeMs = options.maxAgeMs ?? Number(process.env['AGENT_SESSION_MAX_AGE_MS'] || 24 * 60 * 60_000);
    const currentSessionId = options.currentSessionId ?? null;

    /** @type {SessionCleanupResult} */
    const result = { total: 0, deleted: 0, deletedIds: [], kept: 0, errors: [] };

    try {
        const sessions = await listSessions(client);
        if (!Array.isArray(sessions)) {
            log('WARN', '[SessionCleanup] listSessions não retornou array.');
            return result;
        }
        result.total = sessions.length;

        const now = Date.now();

        for (const session of sessions) {
            const id = session.sessionId;
            if (!id) continue;

            // Nunca deletar a sessão ativa
            if (id === currentSessionId) {
                result.kept++;
                continue;
            }

            // Verificar idade — se `startTime` não estiver disponível, pular
            const createdAt = session.startTime ? new Date(session.startTime).getTime() : null;
            if (createdAt === null || isNaN(createdAt)) {
                result.kept++;
                continue;
            }

            const ageMs = now - createdAt;
            if (ageMs > maxAgeMs) {
                try {
                    await deleteSession(client, id);
                    result.deleted++;
                    result.deletedIds.push(id);
                    log('DEBUG', `[SessionCleanup] Sessão ${id} removida (idade: ${Math.round(ageMs / 3600_000)}h).`);
                } catch (/** @type {any} */ e) {
                    result.errors.push(`${id}: ${e.message}`);
                    log('WARN', `[SessionCleanup] Falha ao remover sessão ${id}: ${e.message}`);
                }
            } else {
                result.kept++;
            }
        }

        log('INFO', `[SessionCleanup] Concluído: ${result.deleted}/${result.total} sessões removidas, ${result.kept} mantidas.`);
    } catch (/** @type {any} */ e) {
        log('WARN', `[SessionCleanup] Erro ao listar sessões: ${e.message}`);
        result.errors.push(e.message);
    }

    return result;
}
