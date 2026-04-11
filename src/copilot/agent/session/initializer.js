// @ts-check
/**
 * src/copilot/agent/session/initializer.js
 *
 * Inicializador de sessão persistente para o Always-Alive Agent. Preserva o sessionId em disco e retoma sessões após
 * reinicializações (PM2/reboot).
 *
 * I/O de estado persistido delegado a `lifecycle/state-io.js`. Logging de auditoria delegado a
 * `infra/tool-audit-logger.js`.
 *
 * @module copilot/agent/session/initializer
 * @see module:copilot/lib/session
 * @see module:copilot/agent/lifecycle/state-io
 * @see module:copilot/config/session-config
 */

import { buildAuditingPermissionHandler } from '#copilot/audit';
import { DEFAULT_EXCLUDED_TOOLS, buildCustomAgentsConfig, buildHookContextAppendMessage } from '#copilot/config';
import { log } from '#copilot/observability';
import { getToolsConfig, loadToolsConfigAsync, pickDefined, resumeOrCreate } from '#copilot/sdk';
import { SESSION_MAX_AGE_MS, WORKING_DIRECTORY } from '../config.js';
import { readStateAsync as _readStateAsync, writeStateAsync as _writeStateAsync } from '../lifecycle/state-io.js';
import { buildHookSystemContextSafe } from './hook-context.js';

// Re-exports para backward compatibility
export { buildHookSystemContext, buildHookSystemContextSafe, SessionJsonSchema } from './hook-context.js';

/**
 * @typedef {import('#copilot/sdk/types').CopilotClient} CopilotClient
 *
 * @typedef {import('#copilot/sdk/types').CopilotSession} CopilotSession
 */

// F51: Carrega configuração de tools persistida (async).
await loadToolsConfigAsync();

/**
 * Threshold dinâmico de compaction — configurável em runtime via PUT /config/infinite-session.
 *
 * **Singleton de módulo**: este valor é compartilhado por todas as chamadas a `initOrResumeSession()` no mesmo
 * processo. Em um cenário futuro multi-agent, cada instância deveria receber o threshold via opções em vez de depender
 * desta variável de módulo. Por enquanto, o design singleton é intencional — há apenas um agente por processo Node.
 *
 * @type {number}
 */
let _backgroundCompactionThreshold = 0.75;

/**
 * Atualiza o threshold de compaction. Aplicado na próxima sessão criada/retomada.
 *
 * @param {number} threshold - Valor entre 0.1 e 1.0
 * @returns {void}
 */
export function setBackgroundCompactionThreshold(threshold) {
    if (typeof threshold === 'number' && threshold >= 0.1 && threshold <= 1.0) {
        _backgroundCompactionThreshold = threshold;
    }
}

/**
 * F8.2: Valida se um sessionId persistido é elegível para tentativa de resumo.
 *
 * Retorna null (força criação de nova sessão) quando:
 *
 * - `sessionId` for falsy, não-string ou falhar no padrão UUID/opaque
 * - `lastActivityMs` for mais antigo que `SESSION_MAX_AGE_MS` (padrão: 24h) indicando que a sessão pode ter expirado no
 *   servidor do SDK
 *
 * @param {string | null | undefined} sessionId - ID da sessão persistida
 * @param {number | null | undefined} lastActivityMs - Epoch ms da última atividade conhecida
 * @returns {string | null} sessionId validado ou null para forçar nova sessão
 */
function _validateSessionForResume(sessionId, lastActivityMs) {
    if (!sessionId || typeof sessionId !== 'string') return null;
    // Aceita UUIDs (xxxxxxxx-xxxx-...) e IDs opacos alfanuméricos usados pelo SDK
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(sessionId)) {
        log('WARN', '[session-initializer] sessionId inválido — forçando nova sessão.');
        return null;
    }
    const maxAgeMs = SESSION_MAX_AGE_MS;
    if (lastActivityMs && Date.now() - lastActivityMs > maxAgeMs) {
        log(
            'WARN',
            `[session-initializer] Sessão ${sessionId.slice(0, 12)}... expirou (${Math.round((Date.now() - lastActivityMs) / 3_600_000)}h inativa) — forçando nova.`,
        );
        return null;
    }
    return sessionId;
}

/**
 * Inicializa ou retoma uma sessão Copilot SDK de forma persistente.
 *
 * Fluxo:
 *
 * 1. Lê o sessionId em disco.
 * 2. Se existir → tenta `resumeSession()`.
 * 3. Se não existir ou der erro → cria nova sessão e persiste o ID.
 *
 * Sempre injeta o contexto do hook system (session-briefing.md + session.json) como `systemMessage.sections.guidelines`
 * para que o agente SDK herde o protocolo operacional da sessão principal do VS Code Copilot.
 *
 * @param {CopilotClient} client - Instância do CopilotClient
 * @param {object} sessionOptions - Opções para createSession/resumeSession
 * @param {string} [sessionOptions.model] - Modelo a usar (default: 'gpt-4.1')
 * @param {'low' | 'medium' | 'high' | 'xhigh'} [sessionOptions.reasoningEffort] - Esforço de raciocínio para o3/o4-mini
 * @param {import('#copilot/sdk/types').PermissionHandler} [sessionOptions.onPermissionRequest]
 * @param {Function} [sessionOptions.onUserInputRequest]
 * @param {object} [sessionOptions.hooks]
 * @param {import('#copilot/sdk/types').Tool[]} [sessionOptions.tools] - Custom Tools a registrar na sessão
 * @param {boolean} [sessionOptions.injectHookContext] - Injetar contexto do hook system (default: true)
 * @param {Record<string, unknown>} [sessionOptions.mcpServers] - Configurações de servidores MCP nativos
 * @returns {Promise<{ session: CopilotSession; isResumed: boolean }>}
 * @throws {Error} Se a criação/retomada da sessão SDK falhar ou a escrita de estado falhar
 */
export async function initOrResumeSession(client, sessionOptions) {
    const state = await _readStateAsync();
    const model = sessionOptions.model ?? 'gpt-4.1';
    const injectContext = sessionOptions.injectHookContext !== false;

    /** @type {import('#copilot/sdk/types').SystemMessageConfig | undefined} */
    const systemMessage = injectContext ? buildHookContextAppendMessage(await buildHookSystemContextSafe()) : undefined;

    /** @type {Record<string, unknown>} */
    const opts = {
        model,
        streaming: true,
        // Threshold dinâmico lido da variável de módulo (configurável via setBackgroundCompactionThreshold).
        infiniteSessions: { enabled: true, backgroundCompactionThreshold: _backgroundCompactionThreshold },
        // Diretório de trabalho para o SDK contextualizar ferramentas de busca.
        workingDirectory: WORKING_DIRECTORY,
        // Diretórios de skills para o SDK carregar.
        skillDirectories: ['.github/skills'],
        // AH.1: ferramentas excluídas por padrão + denylist configurável em runtime
        excludedTools: [...DEFAULT_EXCLUDED_TOOLS, ...getToolsConfig().denylist],
        // AH.2: allowlist em runtime — quando definida, tem precedência sobre excludedTools
        ...(getToolsConfig().allowlist !== null ? { availableTools: getToolsConfig().allowlist } : {}),
        ...pickDefined({
            reasoningEffort: sessionOptions.reasoningEffort,
            onUserInputRequest: sessionOptions.onUserInputRequest,
            hooks: sessionOptions.hooks,
            tools: sessionOptions.tools,
            mcpServers: sessionOptions.mcpServers,
            systemMessage,
        }),
        // AH.6: wrapper de permissão com audit logging de ferramentas de alto risco
        onPermissionRequest: buildAuditingPermissionHandler(sessionOptions.onPermissionRequest),
        // L1: sub-agentes customizados especializados (task, explore, diagnostic)
        customAgents: buildCustomAgentsConfig(),
    };

    // F43.2 (GAP-SD-03): verificar se a sessão deve ser rotacionada antes de tentar retomada
    let savedSessionId = _validateSessionForResume(state?.sessionId, state?.resumedAt ?? state?.startedAt);
    if (savedSessionId) {
        const { shouldRotateSession } = await import('./rotation.js');
        /** @type {import('./rotation.js').RotationContext} */
        const rotationCtx = {};
        if (state?.startedAt) {
            rotationCtx.sessionAgeMs = Date.now() - state.startedAt;
        }
        const decision = shouldRotateSession(rotationCtx);
        if (decision.shouldRotate) {
            log('INFO', `[PersistentSession] F43.2: Rotacionando sessão — ${decision.reason}`);
            const { defaultMetrics } = await import('#copilot/observability');
            defaultMetrics.recordSessionRotation();
            savedSessionId = null;
        }
    }
    const result = await resumeOrCreate(client, savedSessionId, opts);

    // SYNC-SM-01 (fix): usar writeStateAsync nas chamadas dentro de funções async para não bloquear o event loop
    if (result.isResumed) {
        await _writeStateAsync({
            resumedAt: Date.now(),
            resumeCount: (state?.resumeCount ?? 0) + 1,
        });
        log('INFO', `[PersistentSession] Sessão retomada com sucesso (retomada #${(state?.resumeCount ?? 0) + 1}).`);
    } else {
        await _writeStateAsync({
            sessionId: result.sessionId,
            startedAt: Date.now(),
            resumedAt: Date.now(),
            resumeCount: 0,
            sendCount: 0,
            model,
            pendingQuestion: null,
        });
        log('INFO', `[PersistentSession] Nova sessão criada: ${result.sessionId}`);
    }

    return { session: result.session, isResumed: result.isResumed };
}
