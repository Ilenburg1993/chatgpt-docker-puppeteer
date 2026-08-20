// @ts-check
import { LLM_B_TURN_TIMEOUT_MS, resolveHubTurnTimeout } from '#copilot/config';
import { toError } from '#copilot/core';
import { z } from 'zod';
import { log } from '../infra/logger.js';
import { buildTool } from '../infra/tool-factory.js';
/**
 * src/copilot/tools/hub/hub-tools.js
 *
 * Tools do AlwaysAliveAgent para o ConversationHub — ambiente permanente LLM-A ↔ LLM-B ↔ Usuário.
 *
 * LLM-A usa estas ferramentas para:
 *
 * - Criar e gerenciar hub_sessions de conversa
 * - Enviar mensagens para LLM-B com histórico persistente
 * - Verificar mensagens injetadas pelo usuário
 * - Consultar histórico de conversas
 *
 * @module copilot/tools/hub/hub-tools
 * @see EventBus
 * @see module:copilot/conversation-hub/orchestrator
 * @see module:copilot/channel/client
 */

// ─── Injeção de dependência do hub (ARCH-02) ─────────────────────────────────

/** @type {import('#copilot/conversation-hub/hub').ConversationHub | null} */
let _injectedHub = null;

/**
 * Injeta o ConversationHub para evitar import dinâmico implícito. Seguir o padrão de `setSessionRpc()` em
 * session-rpc-tools.js. Deve ser chamado em `bootstrapTools()` após o hub ser inicializado.
 *
 * @param {import('#copilot/conversation-hub/hub').ConversationHub} hub
 * @returns {void}
 */
export function setHub(hub) {
    _injectedHub = hub;
}

/**
 * Reseta o estado de injeção do hub para isolamento de testes.
 *
 * @returns {void}
 */
export function resetHubForTests() {
    _injectedHub = null;
}

/**
 * Retorna o hub injetado via `setHub()`. Retorna null se não injetado ou não pronto.
 *
 * @returns {import('#copilot/conversation-hub/hub').ConversationHub | null}
 */
function requireHub() {
    if (_injectedHub === null) return null;
    return _injectedHub.isReady ? _injectedHub : null;
}

// ─── Tool: hub_create_session ─────────────────────────────────────────────────

/**
 * Tool: hub_create_session — LLM-A cria uma nova sessão de conversa persistente.
 */
const hubCreateSessionTool = buildTool({
    name: 'hub_create_session',
    description: `Cria uma nova hub_session de conversa persistente no ConversationHub.
Retorna o hub_session_id que deve ser usado em todas as chamadas subsequentes de hub_send_message.
A sessão persiste no SQLite e sobrevive a restarts do servidor.`,
    parameters: z.object({
        title: z
            .string()
            .optional()
            ['describe']('Título descritivo da conversa (ex: "Análise de arquitetura Sprint Hub")'),
        metadata: z
            .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
            .optional()
            ['describe']('Metadados extras em JSON (apenas primitivos: string, number, boolean, null)'),
    }),
    handler: async (/** @type {{ title?: string; metadata?: Record<string, unknown> }} */ { title, metadata }) => {
        try {
            const hub = requireHub();
            if (!hub) return { success: false, error: 'ConversationHub não disponível neste modo de execução.' };
            const hubSessionId = hub.createSession({
                ...(title !== undefined && { title }),
                ...(metadata !== undefined && { metadata }),
            });
            log('INFO', `[hub_create_session] Hub session criada: ${hubSessionId}`);
            return {
                success: true,
                hubSessionId,
                message: `Hub session criada: ${hubSessionId}. Use este ID em hub_send_message.`,
            };
        } catch (err) {
            log('ERROR', `[hub_create_session] Erro: ${toError(err).message}`);
            return { success: false, error: toError(err).message };
        }
    },
});

// ─── Tool: hub_send_message ───────────────────────────────────────────────────

/**
 * Tool: hub_send_message — LLM-A envia mensagem para LLM-B com persistência.
 */
const hubSendMessageTool = buildTool({
    name: 'hub_send_message',
    description: `Envia uma mensagem de LLM-A para LLM-B via ConversationHub com persistência e streaming.
A mensagem e a resposta são salvas no SQLite. O usuário observa a conversa em tempo real via Socket.io.
Se useStructured=true (padrão), usa o protocolo StructuredMessage para resposta estruturada em JSON.`,
    parameters: z.object({
        hubSessionId: z.string()['describe']('ID da hub_session (obtido via hub_create_session)'),
        message: z.string()['describe']('Mensagem a enviar para LLM-B'),
        context: z.string().optional()['describe']('Contexto adicional para o protocolo StructuredMessage'),
        intent: z.string().optional()['describe']('Intenção explícita da mensagem para o protocolo StructuredMessage'),
        priority: z
            .enum(['low', 'medium', 'high', 'critical'])
            .optional()
            .default('medium')
            ['describe']('Prioridade da mensagem'),
        responseType: z
            .enum(['diagnostic', 'plan', 'code', 'question', 'acknowledgment', 'error'])
            .optional()
            ['describe']('Tipo de resposta esperado de LLM-B'),
        useStructured: z
            .boolean()
            .optional()
            .default(true)
            ['describe']('Se true, usa chatStructured() com protocolo StructuredMessage'),
        timeoutMs: z
            .union([z.number(), z.null()])
            .optional()
            ['describe'](
                'Timeout por inatividade em ms para aguardar resposta de LLM-B. Use 0/null para watchdog-only (sem timeout absoluto).',
            ),
    }),
    handler: async (
        /**
         * @type {{
         *     hubSessionId: string;
         *     message: string;
         *     context?: string;
         *     intent?: string;
         *     priority?: 'low' | 'medium' | 'high' | 'critical';
         *     responseType?: string;
         *     useStructured?: boolean;
         *     timeoutMs?: number | null;
         * }}
         */
        { hubSessionId, message, context, intent, priority, responseType, useStructured, timeoutMs },
    ) => {
        try {
            const hub = requireHub();
            if (!hub) return { success: false, error: 'ConversationHub não disponível neste modo de execução.' };

            // SEC-N04 (fix): truncar message para evitar payloads gigantes
            const MAX_MSG_CHARS = Number(process.env['COPILOT_HUB_MAX_MSG_CHARS'] ?? 32_000);
            const safeMessage =
                typeof message === 'string' && message.length > MAX_MSG_CHARS
                    ? message.slice(0, MAX_MSG_CHARS) + ' […truncado]'
                    : message;

            // F6.1 (BUG-MOD-03): truncar context e intent para evitar payloads gigantes no StructuredMessage
            const safeContext =
                typeof context === 'string' && context.length > MAX_MSG_CHARS
                    ? context.slice(0, MAX_MSG_CHARS) + ' […truncado]'
                    : context;
            const safeIntent =
                typeof intent === 'string' && intent.length > MAX_MSG_CHARS
                    ? intent.slice(0, MAX_MSG_CHARS) + ' […truncado]'
                    : intent;

            const useStructuredResolved = useStructured !== false && !!(context || intent);
            const timeoutDecision = resolveHubTurnTimeout({
                defaultTimeoutMs: LLM_B_TURN_TIMEOUT_MS,
                ...(timeoutMs !== undefined ? { explicitTimeoutMs: timeoutMs } : {}),
                payloadChars: safeMessage.length + (safeContext?.length ?? 0) + (safeIntent?.length ?? 0),
                useStructured: useStructuredResolved,
                ...(priority !== undefined ? { priority } : {}),
                ...(responseType !== undefined ? { responseType } : {}),
            });

            // Se useStructured e há context/intent, enviar como StructuredMessageInput
            let payload;
            if (useStructuredResolved) {
                payload = {
                    context: safeContext ?? safeMessage,
                    intent: safeIntent ?? safeMessage,
                    priority: priority ?? 'medium',
                    responseType: responseType ?? undefined,
                };
            } else {
                payload = safeMessage;
            }

            const result = await hub.sendToLlmB(hubSessionId, payload, {
                useStructured: useStructuredResolved,
                ...(timeoutDecision.timeoutMs !== null
                    ? { timeoutMs: timeoutDecision.timeoutMs }
                    : { timeoutMs: null }),
            });

            log('INFO', `[hub_send_message] Resposta de LLM-B recebida (${result.durationMs}ms).`);

            return {
                success: true,
                turnId: result.turnId,
                hubSessionId: result.hubSessionId,
                turnNumber: result.turnNumber,
                durationMs: result.durationMs,
                timeout: {
                    valueMs: timeoutDecision.timeoutMs,
                    strategy: timeoutDecision.strategy,
                    reasons: timeoutDecision.reasons,
                },
                response: result.content,
                structured: result.structured ?? null,
            };
        } catch (err) {
            log('ERROR', `[hub_send_message] Erro: ${toError(err).message}`);
            return { success: false, error: toError(err).message };
        }
    },
});

// ─── Tool: hub_poll_user_messages ─────────────────────────────────────────────

/**
 * Tool: hub_poll_user_messages — LLM-A verifica mensagens do usuário.
 */
const hubPollUserMessagesTool = buildTool({
    name: 'hub_poll_user_messages',
    description: `Verifica e retorna mensagens pendentes injetadas pelo usuário na hub_session.
LLM-A deve chamar esta tool periodicamente para processar inputs do usuário durante conversas longas.
As mensagens são marcadas como lidas após esta chamada.`,
    parameters: z.object({
        hubSessionId: z.string()['describe']('ID da hub_session'),
    }),
    handler: async (/** @type {{ hubSessionId: string }} */ { hubSessionId }) => {
        try {
            const hub = requireHub();
            if (!hub) return { success: false, error: 'ConversationHub não disponível neste modo de execução.' };
            const messages = hub.pollUserMessages(hubSessionId);

            return {
                success: true,
                hubSessionId,
                pendingCount: messages.length,
                messages: messages.map((m) => ({
                    turnId: m.id,
                    content: m.content,
                    turnNumber: m.turn_number,
                    createdAt: m.created_at,
                })),
            };
        } catch (err) {
            log('ERROR', `[hub_poll_user_messages] Erro: ${toError(err).message}`);
            return { success: false, error: toError(err).message };
        }
    },
});

// ─── Tool: hub_read_history ───────────────────────────────────────────────────

/**
 * Tool: hub_read_history — LLM-A lê o histórico de uma hub_session.
 */
const hubReadHistoryTool = buildTool({
    name: 'hub_read_history',
    description: `Lê o histórico de turns de uma hub_session.
Útil para LLM-A retomar contexto após restart ou em sessões longas.
Retorna turns ordenados por número de turno (mais antigos primeiro).`,
    parameters: z.object({
        hubSessionId: z.string()['describe']('ID da hub_session'),
        limit: z.number().optional().default(20)['describe']('Máximo de turns a retornar (default: 20)'),
        offset: z.number().optional().default(0)['describe']('Offset para paginação'),
        after: z.number().optional()['describe']('Retornar apenas turns com id > after (para polling incremental)'),
    }),
    handler: async (
        /** @type {{ hubSessionId: string; limit?: number; offset?: number; after?: number }} */
        { hubSessionId, limit, offset, after },
    ) => {
        try {
            const hub = requireHub();
            if (!hub) return { success: false, error: 'ConversationHub não disponível neste modo de execução.' };
            const turns = hub.store.readTurns(hubSessionId, {
                limit: limit ?? 20,
                offset: offset ?? 0,
                ...(after !== undefined && { after }),
            });
            const total = hub.store.countTurns(hubSessionId);

            return {
                success: true,
                hubSessionId,
                total,
                returned: turns.length,
                turns: turns.map((t) => ({
                    id: t.id,
                    role: t.role,
                    content: t.content.slice(0, 500) + (t.content.length > 500 ? '...' : ''),
                    turnNumber: t.turn_number,
                    durationMs: t.duration_ms,
                    model: t.model,
                    createdAt: t.created_at,
                })),
            };
        } catch (err) {
            log('ERROR', `[hub_read_history] Erro: ${toError(err).message}`);
            return { success: false, error: toError(err).message };
        }
    },
});

// ─── Tool: hub_list_sessions ──────────────────────────────────────────────────

/**
 * Tool: hub_list_sessions — LLM-A lista as hub_sessions disponíveis.
 */
const hubListSessionsTool = buildTool({
    name: 'hub_list_sessions',
    description: `Lista as hub_sessions de conversa disponíveis no ConversationHub.
Útil para LLM-A identificar sessões ativas ou retomar conversas anteriores.`,
    parameters: z.object({
        limit: z.number().optional().default(10)['describe']('Máximo de sessões a retornar'),
        status: z.enum(['active', 'closed', 'error']).optional()['describe']('Filtrar por status (omitir para todas)'),
    }),
    handler: async (/** @type {{ limit?: number; status?: 'active' | 'closed' | 'error' }} */ { limit, status }) => {
        try {
            const hub = requireHub();
            if (!hub) return { success: false, error: 'ConversationHub não disponível neste modo de execução.' };
            const sessions = hub.store.listHubSessions({
                limit: limit ?? 10,
                ...(status !== undefined && { status }),
            });

            return {
                success: true,
                count: sessions.length,
                sessions: sessions.map((s) => ({
                    id: s.id,
                    title: s.title,
                    status: s.status,
                    sdkSessionId: s.sdk_session_id,
                    createdAt: s.created_at,
                    updatedAt: s.updated_at,
                })),
            };
        } catch (err) {
            log('ERROR', `[hub_list_sessions] Erro: ${toError(err).message}`);
            return { success: false, error: toError(err).message };
        }
    },
});

// ─── Exports ──────────────────────────────────────────────────────────────────

/**
 * Conjunto de tools do hub para registro no AlwaysAliveAgent.
 *
 * @type {import('#copilot/sdk/types').Tool<any>[]}
 */
export const hubTools = [
    hubCreateSessionTool,
    hubSendMessageTool,
    hubPollUserMessagesTool,
    hubReadHistoryTool,
    hubListSessionsTool,
];

export { hubCreateSessionTool, hubListSessionsTool, hubPollUserMessagesTool, hubReadHistoryTool, hubSendMessageTool };
