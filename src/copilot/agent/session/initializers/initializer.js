// @ts-check
/**
 * src/copilot/agent/session/initializers/initializer.js
 *
 * Inicializador de sessão persistente para o agente sempre vivo. Preserva o sessionId em disco e retoma sessões após
 * reinicializações (PM2/reboot).
 *
 * Entrada/saída de estado persistido consumida via fachada `agent-runtime-state` (que delega ao `state-io`). Registro
 * de auditoria delegado a `infra/tool-audit-logger.js`.
 *
 * @module copilot/agent/session/initializer
 * @see EventBus
 * @see module:copilot/lib/session
 * @see module:copilot/agent/lifecycle/state-io
 * @see module:copilot/config/session-config
 */

import { buildAuditingPermissionHandler } from '#copilot/audit';
import { readCopilotBootConfig } from '#copilot/boot';
import { MAESTRO_AGENT_NAME, buildCustomAgentsConfig } from '#copilot/config';
import { SESSION_MAX_AGE_MS } from '#copilot/config/agent';
import { buildCanonicalLocalSurfaceExcludedTools, toError } from '#copilot/core';
import {
    buildLiveSystemMessage,
    buildSystemPromptBindingSnapshot,
    readSystemPromptStatus,
} from '../../../config/system-prompt/index.js';
import {
    AGENT_SDK_DEFAULT_MODEL,
    canReadAgentSdkSessionMessages,
    createAgentSdkSessionByClient,
    formatValidationResult,
    getAgentConfiguredSessionFsHandler,
    loadAgentSdkToolsConfigAsync,
    persistAgentRuntimeStatePartial,
    pickDefinedAgentSdkOptions,
    readAgentRuntimePersistedStateAsync,
    readAgentSdkSessionMessages,
    resumeOrCreateAgentSdkSession,
    validateAgentContracts,
} from '../../facades/index.js';
import { defaultMetrics, log } from '../../ports/index.js';
import { buildHookSystemContextSafe } from '../context/index.js';

// Re-exports para backward compatibility
export { SessionJsonSchema, buildHookSystemContext, buildHookSystemContextSafe } from '../context/index.js';

/**
 * @typedef {import('#copilot/sdk/types').CopilotClient} CopilotClient
 *
 * @typedef {import('#copilot/sdk/types').CopilotSession} CopilotSession
 */

/** @type {Promise<void> | null} */
let _toolsConfigLoadPromise = null;

/** @type {boolean} */
let _toolsConfigLoaded = false;

/**
 * Garante que a configuração persistida de ferramentas seja carregada apenas uma vez por processo.
 *
 * @returns {Promise<void>}
 */
async function ensureAgentSdkToolsConfigLoaded() {
    if (_toolsConfigLoaded) {
        return;
    }
    if (_toolsConfigLoadPromise !== null) {
        await _toolsConfigLoadPromise;
        return;
    }
    _toolsConfigLoadPromise = loadAgentSdkToolsConfigAsync();
    try {
        await _toolsConfigLoadPromise;
        _toolsConfigLoaded = true;
    } finally {
        _toolsConfigLoadPromise = null;
    }
}

/**
 * Limiar dinâmico de compactação — configurável em tempo de execução via PUT /config/infinite-session.
 *
 * **Singleton de módulo**: este valor é compartilhado por todas as chamadas a `initOrResumeSession()` no mesmo
 * processo. Em um cenário futuro multi-agent, cada instância deveria receber o threshold via opções em vez de depender
 * desta variável de módulo. Por enquanto, o design singleton é intencional — há apenas um agente por processo Node.
 *
 * @type {number}
 */
let _backgroundCompactionThreshold = 0.75;

const RESUMED_SESSION_HEALTH_TIMEOUT_MS = 5_000;

/** @type {{ errors: string[]; warnings: string[]; contractLog: Record<string, any> } | null} */
let _lastAgentContractValidation = null;

/**
 * Retorna o último resultado de validação de contratos dos agentes customizados SDK.
 *
 * @returns {{ errors: string[]; warnings: string[]; contractLog: Record<string, any> } | null}
 */
export function getLastAgentContractValidation() {
    return _lastAgentContractValidation;
}

/**
 * Verifica se uma sessao retomada responde a uma chamada leve antes de declarar sucesso.
 *
 * @param {CopilotSession} session
 * @returns {Promise<boolean>}
 */
async function _validateResumedSession(session) {
    if (!canReadAgentSdkSessionMessages(session)) return true;
    try {
        /** @type {ReturnType<typeof setTimeout> | null} */
        let timeoutHandle = null;
        try {
            await Promise.race([
                readAgentSdkSessionMessages(session),
                new Promise((_, reject) => {
                    timeoutHandle = setTimeout(
                        () => reject(new Error('resume-health-timeout')),
                        RESUMED_SESSION_HEALTH_TIMEOUT_MS,
                    );
                }),
            ]);
        } finally {
            if (timeoutHandle !== null) {
                clearTimeout(timeoutHandle);
            }
        }
        return true;
    } catch (e) {
        log('WARN', `[PersistentSession] Sessão retomada falhou no health-check: ${toError(e).message}`);
        return false;
    }
}

/**
 * Atualiza o limiar de compactação. Aplicado na próxima sessão criada/retomada.
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
 * Sempre injeta o contexto do sistema de hooks (session-briefing.md + session.json) como
 * `systemMessage.sections.guidelines` para que o agente SDK herde o protocolo operacional da sessão principal do VS
 * Code Copilot.
 *
 * @param {CopilotClient} client - Instância do CopilotClient
 * @param {object} sessionOptions - Opções para createSession/resumeSession
 * @param {string} [sessionOptions.model] - Modelo a usar (padrão: 'auto')
 * @param {'low' | 'medium' | 'high' | 'xhigh'} [sessionOptions.reasoningEffort] - Esforço de raciocínio para o3/o4-mini
 * @param {import('#copilot/sdk/types').PermissionHandler} [sessionOptions.onPermissionRequest]
 * @param {Function} [sessionOptions.onUserInputRequest]
 * @param {object} [sessionOptions.hooks]
 * @param {import('#copilot/sdk/types').Tool[]} [sessionOptions.tools] - Ferramentas customizadas a registrar na sessão
 * @param {string[]} [sessionOptions.excludedTools] - Denylist adicional de tools expostas ao modelo na sessão SDK
 * @param {boolean} [sessionOptions.injectHookContext] - Injetar contexto do sistema de hooks (padrão: true)
 * @param {Record<string, unknown>} [sessionOptions.mcpServers] - Configurações de servidores MCP nativos
 * @returns {Promise<{
 *     session: CopilotSession;
 *     isResumed: boolean;
 *     model: string;
 *     reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' | undefined;
 * }>}
 * @throws {Error} Se a criação/retomada da sessão SDK falhar ou a escrita de estado falhar
 */
export async function initOrResumeSession(client, sessionOptions) {
    await ensureAgentSdkToolsConfigLoaded();

    const state = await readAgentRuntimePersistedStateAsync();
    const model = sessionOptions.model ?? AGENT_SDK_DEFAULT_MODEL;
    const injectContext = sessionOptions.injectHookContext !== false;
    const bootConfig = readCopilotBootConfig();
    const bootSessionDefaults = bootConfig.sessionDefaults;
    const createSessionFsHandler = getAgentConfiguredSessionFsHandler();

    /** @type {import('#copilot/sdk/types').SystemMessageConfig | undefined} */
    const systemMessage = await buildLiveSystemMessage({
        ...(injectContext ? { getExtraContext: buildHookSystemContextSafe } : {}),
    });
    const systemPromptStatus = await readSystemPromptStatus();
    const customAgents = buildCustomAgentsConfig();
    const availableToolNameList = /** @type {string[]} */ (
        (Array.isArray(sessionOptions.tools) ? sessionOptions.tools : [])
            .map((tool) => (tool && typeof tool === 'object' ? /** @type {{ name?: unknown }} */ (tool).name : null))
            .filter((name) => typeof name === 'string' && name.length > 0)
    );
    const availableToolNames = new Set(availableToolNameList);
    const excludedTools = buildCanonicalLocalSurfaceExcludedTools(
        availableToolNameList,
        Array.isArray(sessionOptions.excludedTools) ? sessionOptions.excludedTools : [],
    );
    const agentContractValidation = validateAgentContracts(customAgents ?? [], availableToolNames, {
        skillDirectories: bootSessionDefaults.skillDirectories,
        disabledSkills: bootSessionDefaults.disabledSkills,
    });
    _lastAgentContractValidation = agentContractValidation;
    const validationSummary = formatValidationResult(agentContractValidation);
    if (agentContractValidation.errors.length > 0) {
        log('ERROR', validationSummary);
        throw new Error(`Validação de contrato de agente falhou: ${agentContractValidation.errors.join('; ')}`);
    }
    if (agentContractValidation.warnings.length > 0) {
        log('WARN', validationSummary);
    } else {
        log('INFO', validationSummary);
    }

    /** @type {Record<string, unknown>} */
    const opts = {
        model,
        streaming: bootSessionDefaults.streaming,
        // Limiar dinâmico lido da variável de módulo (configurável via setBackgroundCompactionThreshold).
        infiniteSessions: { enabled: true, backgroundCompactionThreshold: _backgroundCompactionThreshold },
        // Diretório de trabalho para o SDK contextualizar ferramentas de busca.
        workingDirectory: bootSessionDefaults.workingDirectory,
        // Diretórios de skills para o SDK carregar.
        skillDirectories: bootSessionDefaults.skillDirectories,
        ...pickDefinedAgentSdkOptions({
            reasoningEffort: sessionOptions.reasoningEffort,
            onUserInputRequest: sessionOptions.onUserInputRequest,
            createSessionFsHandler,
            enableConfigDiscovery: bootSessionDefaults.enableConfigDiscovery,
            includeSubAgentStreamingEvents: bootSessionDefaults.includeSubAgentStreamingEvents,
            hooks: sessionOptions.hooks,
            tools: sessionOptions.tools,
            mcpServers: sessionOptions.mcpServers,
            systemMessage,
            excludedTools,
        }),
        // AH.6: envoltório de permissão com registro de auditoria de ferramentas de alto risco
        onPermissionRequest: buildAuditingPermissionHandler(sessionOptions.onPermissionRequest),
        agent: MAESTRO_AGENT_NAME,
        // O maestro governa por `agent` + hooks de policy. `defaultAgent.excludedTools` é namespace de tools nativas
        // do SDK; nomes das nossas tools customizadas geram warnings "Unknown tool name" e não bloqueiam o default.
        // L1: sub-agentes customizados especializados, sempre comandados pelo maestro.
        customAgents,
    };

    // F43.2 (GAP-SD-03): rotação automática deixou de ser default do terminal LLM-B.
    // O princípio operacional atual é session-first: retomar a sessão anterior sempre que o SDK permitir.
    // Rotação continua disponível para fluxos explícitos via sessionOptions.allowSessionRotation.
    let savedSessionId = _validateSessionForResume(state?.sessionId, state?.resumedAt ?? state?.startedAt);
    const allowSessionRotation = Reflect.get(sessionOptions, 'allowSessionRotation') === true;
    if (savedSessionId && allowSessionRotation) {
        const { shouldRotateSession } = await import('../lifecycle/rotation.js');
        /** @type {import('../lifecycle/rotation.js').RotationContext} */
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
    let result = await resumeOrCreateAgentSdkSession(client, savedSessionId, opts);
    if (result.isResumed && !(await _validateResumedSession(result.session))) {
        log('WARN', '[PersistentSession] Sessão retomada não passou no health-check — criando nova sessão.');
        result = await createAgentSdkSessionByClient(client, opts);
    }

    const requestedNativeAutoModel = model === 'auto';
    const persistedConcreteModel =
        !requestedNativeAutoModel && typeof state?.model === 'string' && state.model !== 'auto' ? state.model : null;
    const effectiveModel = requestedNativeAutoModel
        ? 'auto'
        : typeof result.model === 'string'
          ? result.model
          : (persistedConcreteModel ?? model);
    if (
        result.isResumed &&
        requestedNativeAutoModel &&
        state?.model &&
        state.model !== 'auto' &&
        (result.model === undefined || result.model !== 'auto')
    ) {
        log(
            'INFO',
            `[PersistentSession] Retomada solicitada com model="auto" — ignorando modelo concreto persistido '${state.model}' para preservar roteamento nativo do SDK.`,
        );
    }
    const effectiveReasoningEffort =
        result.reasoningEffort ??
        sessionOptions.reasoningEffort ??
        (state?.reasoningEffort === 'low' ||
        state?.reasoningEffort === 'medium' ||
        state?.reasoningEffort === 'high' ||
        state?.reasoningEffort === 'xhigh'
            ? state.reasoningEffort
            : undefined);

    // SYNC-SM-01 (fix): usar writeStateAsync nas chamadas dentro de funções async para não bloquear o event loop
    if (result.isResumed) {
        const persistedResume = await persistAgentRuntimeStatePartial(
            {
                resumedAt: Date.now(),
                resumeCount: (state?.resumeCount ?? 0) + 1,
                model: effectiveModel,
                systemPromptBinding: buildSystemPromptBindingSnapshot(systemPromptStatus, result.session.sessionId),
                ...(effectiveReasoningEffort !== undefined ? { reasoningEffort: effectiveReasoningEffort } : {}),
                dialogPaused: false,
                pendingTurnMessage: null,
                pendingTurnTs: null,
                pendingTurnConsumedPR: false,
            },
            { label: 'session.initializer.resume' },
        );
        if (!persistedResume.ok) {
            throw persistedResume.error;
        }
        log('INFO', `[PersistentSession] Sessão retomada com sucesso (retomada #${(state?.resumeCount ?? 0) + 1}).`);
    } else {
        const persistedNewSession = await persistAgentRuntimeStatePartial(
            {
                sessionId: result.session.sessionId,
                startedAt: Date.now(),
                resumedAt: Date.now(),
                resumeCount: 0,
                sendCount: 0,
                model: effectiveModel,
                systemPromptBinding: buildSystemPromptBindingSnapshot(systemPromptStatus, result.session.sessionId),
                ...(effectiveReasoningEffort !== undefined ? { reasoningEffort: effectiveReasoningEffort } : {}),
                pendingQuestion: null,
                pendingQuestionMeta: null,
            },
            { label: 'session.initializer.create' },
        );
        if (!persistedNewSession.ok) {
            throw persistedNewSession.error;
        }
        log(
            'INFO',
            `[PersistentSession] Nova sessão criada: ${result.session.sessionId}${savedSessionId ? ` (resume miss — sessão anterior '${savedSessionId}' não existe mais no SDK; comportamento esperado após reinício do CLI)` : ' (primeiro boot ou rotação explícita)'}`,
        );
    }

    return {
        session: result.session,
        isResumed: result.isResumed,
        model: effectiveModel,
        ...(effectiveReasoningEffort !== undefined ? { reasoningEffort: effectiveReasoningEffort } : {}),
    };
}
