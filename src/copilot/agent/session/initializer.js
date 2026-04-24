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
 * @see EventBus
 * @see module:copilot/lib/session
 * @see module:copilot/agent/lifecycle/state-io
 * @see module:copilot/config/session-config
 */

import { buildAuditingPermissionHandler } from '#copilot/audit';
import { WORKSPACE_ROOT, readBootSkillConfig } from '#copilot/boot';
import { buildCustomAgentsConfig } from '#copilot/config';
import { toError } from '#copilot/core';
import { DEFAULT_MODEL, createSession, loadToolsConfigAsync, pickDefined, resumeOrCreate } from '#copilot/sdk';
import { SESSION_MAX_AGE_MS } from '../../config/agent.js';
import { buildSystemMessage } from '../../config/system-prompt/index.js';
import {
    persistStateWithPolicy as _persistStateWithPolicy,
    readStateAsync as _readStateAsync,
} from '../lifecycle/state-io.js';
import { defaultMetrics, log } from '../ports/observability-port.js';
import { buildHookSystemContextSafe } from './hook-context.js';

// Re-exports para backward compatibility
export { SessionJsonSchema, buildHookSystemContext, buildHookSystemContextSafe } from './hook-context.js';

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

const RESUMED_SESSION_HEALTH_TIMEOUT_MS = 5_000;

/**
 * Verifica se uma sessao retomada responde a uma chamada leve antes de declarar sucesso.
 *
 * @param {CopilotSession} session
 * @returns {Promise<boolean>}
 */
async function _validateResumedSession(session) {
    if (typeof session.getMessages !== 'function') return true;
    try {
        await Promise.race([
            session.getMessages(),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('resume-health-timeout')), RESUMED_SESSION_HEALTH_TIMEOUT_MS),
            ),
        ]);
        return true;
    } catch (e) {
        log('WARN', `[PersistentSession] Sessão retomada falhou no health-check: ${toError(e).message}`);
        return false;
    }
}

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
 * @param {string} [sessionOptions.model] - Modelo a usar (default: 'gpt-5-mini')
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
    const model = sessionOptions.model ?? DEFAULT_MODEL;
    const injectContext = sessionOptions.injectHookContext !== false;
    const bootSkills = readBootSkillConfig();

    /** @type {import('#copilot/sdk/types').SystemMessageConfig | undefined} */
    const systemMessage = injectContext
        ? buildSystemMessage({ extraContext: await buildHookSystemContextSafe() })
        : buildSystemMessage();

    /** @type {Record<string, unknown>} */
    const opts = {
        model,
        streaming: true,
        // Threshold dinâmico lido da variável de módulo (configurável via setBackgroundCompactionThreshold).
        infiniteSessions: { enabled: true, backgroundCompactionThreshold: _backgroundCompactionThreshold },
        // Diretório de trabalho para o SDK contextualizar ferramentas de busca.
        workingDirectory: WORKSPACE_ROOT,
        // Diretórios de skills para o SDK carregar.
        skillDirectories: bootSkills.skillDirectories,
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
            defaultMetrics.recordSessionRotation();
            savedSessionId = null;
        }
    }
    let result = await resumeOrCreate(client, savedSessionId, opts);
    if (result.isResumed && !(await _validateResumedSession(result.session))) {
        log('WARN', '[PersistentSession] Sessão retomada não passou no health-check — criando nova sessão.');
        result = await createSession(client, opts);
    }

    // SYNC-SM-01 (fix): usar writeStateAsync nas chamadas dentro de funções async para não bloquear o event loop
    if (result.isResumed) {
        const persistedResume = await _persistStateWithPolicy(
            {
                resumedAt: Date.now(),
                resumeCount: (state?.resumeCount ?? 0) + 1,
            },
            { label: 'session.initializer.resume' },
        );
        if (!persistedResume.ok) {
            throw persistedResume.error;
        }
        log('INFO', `[PersistentSession] Sessão retomada com sucesso (retomada #${(state?.resumeCount ?? 0) + 1}).`);
    } else {
        const persistedNewSession = await _persistStateWithPolicy(
            {
                sessionId: result.sessionId,
                startedAt: Date.now(),
                resumedAt: Date.now(),
                resumeCount: 0,
                sendCount: 0,
                model,
                pendingQuestion: null,
                pendingQuestionMeta: null,
            },
            { label: 'session.initializer.create' },
        );
        if (!persistedNewSession.ok) {
            throw persistedNewSession.error;
        }
        log('INFO', `[PersistentSession] Nova sessão criada: ${result.sessionId}`);
    }

    return { session: result.session, isResumed: result.isResumed };
}
