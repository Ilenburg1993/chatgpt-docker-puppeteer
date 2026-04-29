// @ts-check
/**
 * src/copilot/agent/session/cleanup.js
 *
 * F43.1 (GAP-SD-01): Limpeza proativa de sessões antigas no boot do agente.
 *
 * - Lista todas as sessões via `client.listSessions()`
 * - Deleta sessões com mais de `maxAgeMs` (padrão: 24h)
 * - Preserva a sessão ativa atual (se houver)
 *
 * @module copilot/agent/session/cleanup
 * @see EventBus
 */

import { SESSION_MAX_AGE_MS } from '../../config/agent.js';
import { toError } from '../../core/error-handlers.js';
import { withAgentErrorPolicy } from '../error-policy.js';
import {
    deleteAgentSdkSessionByClient,
    listAgentSdkProtectedSessionIdsByClient,
    listAgentSdkSessionsByClient,
} from '../facades/agent-sdk-access.js';
import { log, startSpan } from '../ports/observability-port.js';

/**
 * @typedef {Object} SessionCleanupResult
 * @property {number} total - Sessões encontradas
 * @property {number} deleted - Sessões removidas
 * @property {string[]} deletedIds - IDs removidos
 * @property {number} kept - Sessões mantidas
 * @property {string[]} protectedIds - IDs preservados por política defensiva de ownership/foreground
 * @property {string[]} errors - Erros encontrados
 */

/**
 * Limpa sessões expiradas do servidor SDK.
 *
 * @param {import('#copilot/sdk/types').CopilotClient} client - Cliente SDK
 * @param {{
 *     maxAgeMs?: number;
 *     currentSessionId?: string | null;
 *     preserveSessionIds?: (string | null | undefined)[];
 * }} [options]
 * @returns {Promise<SessionCleanupResult>}
 */
export async function cleanupStaleSessions(client, options = {}) {
    const maxAgeMs = options.maxAgeMs ?? SESSION_MAX_AGE_MS;
    const currentSessionId = options.currentSessionId ?? null;

    return startSpan(
        'copilot.session.cleanup',
        { extra: { maxAgeMs, currentSessionId: currentSessionId ?? '' } },
        async () => {
            /** @type {string[]} */
            const protectedIds = await listAgentSdkProtectedSessionIdsByClient(client, [
                currentSessionId,
                ...(options.preserveSessionIds ?? []),
            ]);
            const protectedIdSet = new Set(protectedIds);
            /** @type {SessionCleanupResult} */
            const result = {
                total: 0,
                deleted: 0,
                deletedIds: [],
                kept: 0,
                protectedIds,
                errors: [],
            };

            try {
                const sessions = await listAgentSdkSessionsByClient(client);
                if (!Array.isArray(sessions)) {
                    log('WARN', '[SessionCleanup] listSessions não retornou array.');
                    return result;
                }
                result.total = sessions.length;

                const now = Date.now();

                /** @type {{ id: string; ageMs: number }[]} */
                const toDelete = [];

                for (const session of sessions) {
                    const id = session.sessionId;
                    if (!id) continue;

                    // Nunca deletar sessões protegidas por ownership/foreground/last-session.
                    if (protectedIdSet.has(id)) {
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
                        toDelete.push({ id, ageMs });
                    } else {
                        result.kept++;
                    }
                }

                // F70.2: Deletar em paralelo com Promise.allSettled (batched)
                if (toDelete.length > 0) {
                    const outcomes = await Promise.allSettled(
                        toDelete.map(({ id, ageMs }) =>
                            deleteAgentSdkSessionByClient(client, id).then(() => {
                                log(
                                    'DEBUG',
                                    `[SessionCleanup] Sessão ${id} removida (idade: ${Math.round(ageMs / 3600_000)}h).`,
                                );
                                return id;
                            }),
                        ),
                    );

                    for (const outcome of outcomes) {
                        if (outcome.status === 'fulfilled') {
                            result.deleted++;
                            result.deletedIds.push(outcome.value);
                        } else {
                            const msg = outcome.reason?.message ?? String(outcome.reason);
                            result.errors.push(msg);
                            log('WARN', `[SessionCleanup] Falha ao remover sessão: ${msg}`);
                        }
                    }
                }

                log(
                    'INFO',
                    `[SessionCleanup] Concluído: ${result.deleted}/${result.total} sessões removidas, ${result.kept} mantidas.`,
                );
            } catch (e) {
                log('WARN', `[SessionCleanup] Erro ao listar sessões: ${toError(e).message}`);
                result.errors.push(toError(e).message);
            }

            return result;
        },
    ); // startSpan copilot.session.cleanup
}

/**
 * Executa a limpeza de sessões sob a error policy canônica do `agent`, enriquecendo logs com contexto operacional.
 *
 * @param {import('#copilot/sdk/types').CopilotClient} client
 * @param {{
 *     maxAgeMs?: number;
 *     currentSessionId?: string | null;
 *     preserveSessionIds?: (string | null | undefined)[];
 * }} [options]
 * @param {{
 *     label?: string;
 *     phase?: string;
 *     taskId?: string;
 *     sessionId?: string;
 * }} [policy]
 * @returns {Promise<import('../error-policy.js').AgentPolicyResult<SessionCleanupResult>>}
 */
export async function cleanupStaleSessionsWithPolicy(client, options = {}, policy = {}) {
    const label = policy.label ?? 'session.cleanup.stale';
    /**
     * @type {{
     *     label: string;
     *     phase: string;
     *     taskId?: string;
     *     sessionId?: string;
     *     onError: (
     *         error: Error,
     *         disposition: import('../error-policy.js').AgentErrorDisposition,
     *         context: import('../error-policy.js').AgentErrorContext,
     *     ) => void;
     * }}
     */
    const policyOptions = {
        label,
        phase: policy.phase ?? 'boot',
        ...(policy.taskId !== undefined ? { taskId: policy.taskId } : {}),
        onError: (error, disposition, context) => {
            const level = disposition === 'fatal' ? 'ERROR' : 'WARN';
            log(level, `[SessionCleanup] ${context.label ?? label}: ${error.message}`);
        },
    };
    const resolvedSessionId = policy.sessionId ?? options.currentSessionId ?? null;
    if (typeof resolvedSessionId === 'string' && resolvedSessionId.length > 0) {
        policyOptions.sessionId = resolvedSessionId;
    }
    return withAgentErrorPolicy(() => cleanupStaleSessions(client, options), policyOptions);
}
