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
import {
    MAESTRO_AGENT_NAME,
    buildCustomAgentsConfig,
    redactProviderConfig,
    resolveConfiguredByokSessionOverrides,
} from '#copilot/config';
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
 * @param {unknown} error
 * @returns {boolean}
 */
function isConfigDiscoveryToolCollisionError(error) {
    const message = toError(error).message;
    return /tool names must be unique|already registered|duplicate tool|collisions?/i.test(message);
}

/**
 * Executa criação/retomada com fallback explícito para `enableConfigDiscovery=false` quando a descoberta automática
 * injeta extensões/tools com colisão de nomes. O SDK documenta que nomes de tools precisam ser únicos em todas as
 * extensões carregadas; portanto, recuperação segura significa preservar nossa superfície explícita e desligar apenas a
 * descoberta implícita.
 *
 * @param {CopilotClient} client
 * @param {string | null} savedSessionId
 * @param {Record<string, unknown>} opts
 * @returns {Promise<Awaited<ReturnType<typeof resumeOrCreateAgentSdkSession>>>}
 */
async function resumeOrCreateWithConfigDiscoveryGuard(client, savedSessionId, opts) {
    try {
        return await resumeOrCreateAgentSdkSession(client, savedSessionId, opts);
    } catch (error) {
        if (opts['enableConfigDiscovery'] !== true || !isConfigDiscoveryToolCollisionError(error)) {
            throw error;
        }
        log(
            'WARN',
            `[PersistentSession] enableConfigDiscovery causou colisão de tools (${toError(error).message}). ` +
                'Retentando sessão com descoberta automática desligada e mantendo mcpServers/skillDirectories explícitos.',
        );
        return resumeOrCreateAgentSdkSession(client, savedSessionId, {
            ...opts,
            enableConfigDiscovery: false,
        });
    }
}

/**
 * @param {CopilotClient} client
 * @param {Record<string, unknown>} opts
 * @returns {Promise<Awaited<ReturnType<typeof createAgentSdkSessionByClient>>>}
 */
async function createWithConfigDiscoveryGuard(client, opts) {
    try {
        return await createAgentSdkSessionByClient(client, opts);
    } catch (error) {
        if (opts['enableConfigDiscovery'] !== true || !isConfigDiscoveryToolCollisionError(error)) {
            throw error;
        }
        log(
            'WARN',
            `[PersistentSession] createSession falhou com enableConfigDiscovery (${toError(error).message}). ` +
                'Retentando criação com descoberta automática desligada.',
        );
        return createAgentSdkSessionByClient(client, {
            ...opts,
            enableConfigDiscovery: false,
        });
    }
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
 * @typedef {{
 *     enabled: true;
 *     profile: string | null;
 *     preset: string | null;
 *     providerType: string | null;
 *     baseUrl: string | null;
 *     model: string;
 * }} ByokSessionBinding
 */

/**
 * @param {ReturnType<typeof resolveConfiguredByokSessionOverrides>} byok
 * @param {string} model
 * @returns {ByokSessionBinding | null}
 */
function buildByokSessionBinding(byok, model) {
    if (!byok.enabled) return null;
    return {
        enabled: true,
        profile: byok.summary.profile ?? null,
        preset: byok.summary.preset ?? null,
        providerType: byok.summary.providerType ?? null,
        baseUrl: byok.summary.baseUrl ?? null,
        model,
    };
}

/**
 * @param {unknown} value
 * @returns {ByokSessionBinding | null}
 */
function readPersistedByokSessionBinding(value) {
    if (!value || typeof value !== 'object' || Reflect.get(value, 'enabled') !== true) return null;
    const model = Reflect.get(value, 'model');
    if (typeof model !== 'string' || model.trim().length === 0) return null;
    /** @param {'profile' | 'preset' | 'providerType' | 'baseUrl'} key */
    const readOptionalString = (key) => {
        const field = Reflect.get(value, key);
        return typeof field === 'string' && field.trim().length > 0 ? field.trim() : null;
    };
    return {
        enabled: true,
        profile: readOptionalString('profile'),
        preset: readOptionalString('preset'),
        providerType: readOptionalString('providerType'),
        baseUrl: readOptionalString('baseUrl'),
        model: model.trim(),
    };
}

/**
 * @param {ReturnType<typeof buildByokSessionBinding>} current
 * @param {ReturnType<typeof readPersistedByokSessionBinding>} persisted
 * @returns {string | null}
 */
function compareByokSessionBindings(current, persisted) {
    if (!current) return persisted ? 'sessao persistida nasceu em BYOK e o boot atual voltou ao SDK Copilot' : null;
    if (!persisted) return 'sessao persistida nao traz binding BYOK seguro para o provider atual';
    if (current.profile !== persisted.profile) return buildByokBindingMismatch('profile', current.profile, persisted.profile);
    if (current.preset !== persisted.preset) return buildByokBindingMismatch('preset', current.preset, persisted.preset);
    if (current.providerType !== persisted.providerType) {
        return buildByokBindingMismatch('providerType', current.providerType, persisted.providerType);
    }
    if (current.baseUrl !== persisted.baseUrl) return buildByokBindingMismatch('baseUrl', current.baseUrl, persisted.baseUrl);
    if (current.model !== persisted.model) return buildByokBindingMismatch('model', current.model, persisted.model);
    return null;
}

/**
 * @param {string} field
 * @param {string | null} current
 * @param {string | null} persisted
 * @returns {string}
 */
function buildByokBindingMismatch(field, current, persisted) {
    return `binding BYOK ${field}='${persisted ?? '-'}' difere do boot atual '${current ?? '-'}'`;
}

/**
 * @param {import('../../lifecycle/state/index.js').AliveAgentState | null} state
 * @param {ReturnType<typeof resolveConfiguredByokSessionOverrides>} byok
 * @param {string} model
 * @returns {{ ok: true } | { ok: false; reason: string }}
 */
function validatePersistedSessionForProviderResume(state, byok, model) {
    const bindingMismatch = compareByokSessionBindings(
        buildByokSessionBinding(byok, model),
        readPersistedByokSessionBinding(state ? Reflect.get(state, 'byokSessionBinding') : null),
    );
    if (bindingMismatch) return { ok: false, reason: bindingMismatch };
    if (!byok.enabled) return { ok: true };
    if (state?.model && state.model !== model) {
        return { ok: false, reason: `modelo persistido '${state.model}' difere do BYOK ativo '${model}'` };
    }
    if (
        byok.supportsReasoning === false &&
        (state?.reasoningEffort === 'low' ||
            state?.reasoningEffort === 'medium' ||
            state?.reasoningEffort === 'high' ||
            state?.reasoningEffort === 'xhigh')
    ) {
        return {
            ok: false,
            reason: `sessao persistida traz reasoningEffort='${state.reasoningEffort}' incompatível com o contrato BYOK atual`,
        };
    }
    return { ok: true };
}

/**
 * @param {import('../../lifecycle/state/index.js').AliveAgentState | null} state
 * @returns {{ mode: 'new' } | { mode: 'resume'; sessionId: string } | null}
 */
function readNextSdkSessionBootSelection(state) {
    const raw = state && typeof state === 'object' ? Reflect.get(state, 'nextSdkSessionBoot') : null;
    if (!raw || typeof raw !== 'object') return null;
    const mode = Reflect.get(raw, 'mode');
    if (mode === 'new') return { mode };
    const sessionId = Reflect.get(raw, 'sessionId');
    return mode === 'resume' && typeof sessionId === 'string' && sessionId.trim()
        ? { mode, sessionId: sessionId.trim() }
        : null;
}

/**
 * @param {'auto' | 'new' | 'resume'} requestedMode
 * @param {string | null} resumeCandidateSessionId
 * @param {string} reason
 * @param {Awaited<ReturnType<typeof resumeOrCreateWithConfigDiscoveryGuard>>} result
 * @returns {{
 *     outcome: 'created' | 'resumed';
 *     requestedMode: 'auto' | 'new' | 'resume';
 *     selectedSessionId: string;
 *     resumeCandidateSessionId: string | null;
 *     reason: string;
 *     decidedAt: number;
 * }}
 */
function buildSdkSessionBootDecision(requestedMode, resumeCandidateSessionId, reason, result) {
    const resumeFallbackReason =
        resumeCandidateSessionId && !result.isResumed ? `${reason}: sdk-resume-fallback-created-new-session` : reason;
    return {
        outcome: result.isResumed ? 'resumed' : 'created',
        requestedMode,
        selectedSessionId: result.session.sessionId,
        resumeCandidateSessionId,
        reason: resumeFallbackReason,
        decidedAt: Date.now(),
    };
}

/**
 * @param {unknown} value
 * @returns {Record<string, Record<string, unknown>>}
 */
function readSdkSessionLocalMetadataMap(value) {
    if (!value || typeof value !== 'object') return {};
    /** @type {Record<string, Record<string, unknown>>} */
    const out = {};
    for (const [sessionId, metadata] of Object.entries(/** @type {Record<string, unknown>} */ (value))) {
        if (!/^[a-zA-Z0-9_-]{8,128}$/u.test(sessionId)) continue;
        if (!metadata || typeof metadata !== 'object') continue;
        out[sessionId] = { .../** @type {Record<string, unknown>} */ (metadata) };
    }
    return out;
}

/**
 * @param {import('../../lifecycle/state/index.js').AliveAgentState | null} state
 * @param {string} sessionId
 * @param {{
 *     model: string;
 *     reasoningEffort: 'low' | 'medium' | 'high' | 'xhigh' | undefined;
 *     byokSessionBinding: ByokSessionBinding | null;
 *     bootDecision: ReturnType<typeof buildSdkSessionBootDecision>;
 * }} input
 * @returns {Record<string, Record<string, unknown>>}
 */
function buildSdkSessionLocalMetadataMap(state, sessionId, input) {
    const map = readSdkSessionLocalMetadataMap(state ? Reflect.get(state, 'sdkSessionLocalMetadata') : null);
    map[sessionId] = {
        sessionId,
        updatedAt: Date.now(),
        model: input.model,
        reasoningEffort: input.reasoningEffort ?? null,
        provider: input.byokSessionBinding
            ? {
                  kind: 'byok',
                  profile: input.byokSessionBinding.profile,
                  preset: input.byokSessionBinding.preset,
                  providerType: input.byokSessionBinding.providerType,
                  model: input.byokSessionBinding.model,
              }
            : {
                  kind: 'github-copilot',
                  model: input.model,
              },
        boundary: {
            outcome: input.bootDecision.outcome,
            requestedMode: input.bootDecision.requestedMode,
            reason: input.bootDecision.reason,
            resumeCandidateSessionId: input.bootDecision.resumeCandidateSessionId,
            decidedAt: input.bootDecision.decidedAt,
        },
    };
    return Object.fromEntries(
        Object.entries(map)
            .sort(([, a], [, b]) => Number(b['updatedAt'] ?? 0) - Number(a['updatedAt'] ?? 0))
            .slice(0, 50),
    );
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
    const requestedModel = sessionOptions.model ?? AGENT_SDK_DEFAULT_MODEL;
    const byok = resolveConfiguredByokSessionOverrides(process.env, requestedModel);
    const model = byok.enabled && byok.model ? byok.model : requestedModel;
    const sdkReasoningEffort =
        byok.enabled && byok.supportsReasoning === false ? undefined : sessionOptions.reasoningEffort;
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
    if (byok.enabled) {
        log(
            'INFO',
            `[PersistentSession] BYOK ativo: preset=${byok.summary.preset} provider=${byok.summary.providerType} model=${model} baseUrl=${byok.summary.baseUrl} auth=${byok.summary.auth.bearerTokenConfigured ? 'bearer' : byok.summary.auth.apiKeyConfigured ? 'apiKey' : 'none'} providerConfig=${JSON.stringify(redactProviderConfig(byok.provider ?? null))}`,
        );
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
            reasoningEffort: sdkReasoningEffort,
            provider: byok.provider,
            modelCapabilities: byok.modelCapabilities,
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
    /** @type {'auto' | 'new' | 'resume'} */
    let requestedSdkSessionBootMode = 'auto';
    let sdkSessionBootReason = savedSessionId ? 'auto-resume-persisted-session' : 'auto-create-without-resume-candidate';
    const nextSdkSessionBoot = readNextSdkSessionBootSelection(state);
    if (nextSdkSessionBoot?.mode === 'new') {
        log('INFO', '[PersistentSession] Diretiva do operador: criar nova sessão SDK neste boot.');
        requestedSdkSessionBootMode = 'new';
        sdkSessionBootReason = 'operator-next-boot-new-session';
        savedSessionId = null;
    } else if (nextSdkSessionBoot?.mode === 'resume') {
        requestedSdkSessionBootMode = 'resume';
        const explicitSessionId = _validateSessionForResume(nextSdkSessionBoot.sessionId, Date.now());
        if (explicitSessionId) {
            log('INFO', `[PersistentSession] Diretiva do operador: retomar sessão SDK '${explicitSessionId}'.`);
            sdkSessionBootReason = 'operator-next-boot-resume-session';
            savedSessionId = explicitSessionId;
        } else {
            log('WARN', '[PersistentSession] Diretiva de retomada traz sessionId inválido; mantendo seleção persistida.');
            sdkSessionBootReason = 'operator-next-boot-resume-invalid-session-id';
        }
    }
    const providerResumeDecision = validatePersistedSessionForProviderResume(state, byok, model);
    if (savedSessionId && !providerResumeDecision.ok && !nextSdkSessionBoot) {
        log(
            'INFO',
            `[PersistentSession] Binding do provider exige nova sessão SDK — ${providerResumeDecision.reason}.`,
        );
        sdkSessionBootReason = `provider-boundary: ${providerResumeDecision.reason}`;
        savedSessionId = null;
    }
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
            sdkSessionBootReason = `session-rotation: ${decision.reason}`;
            savedSessionId = null;
        }
    }
    const resumeCandidateSessionId = savedSessionId;
    let result = await resumeOrCreateWithConfigDiscoveryGuard(client, savedSessionId, opts);
    if (result.isResumed && !(await _validateResumedSession(result.session))) {
        log('WARN', '[PersistentSession] Sessão retomada não passou no health-check — criando nova sessão.');
        sdkSessionBootReason = 'resumed-session-health-check-failed';
        result = await createWithConfigDiscoveryGuard(client, opts);
    }
    const sdkSessionBootDecision = buildSdkSessionBootDecision(
        requestedSdkSessionBootMode,
        resumeCandidateSessionId,
        sdkSessionBootReason,
        result,
    );
    const byokSessionBinding = buildByokSessionBinding(byok, model);
    if (byok.enabled && byok.provider) {
        Reflect.set(result.session, '__copilotByokEnabled', true);
        Reflect.set(result.session, '__copilotByokProvider', byok.provider);
        if (byok.summary.profile) Reflect.set(result.session, '__copilotByokProfile', byok.summary.profile);
        if (byok.summary.preset) Reflect.set(result.session, '__copilotByokPreset', byok.summary.preset);
        if (byok.summary.providerType) Reflect.set(result.session, '__copilotByokProviderType', byok.summary.providerType);
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
    const persistedReasoningEffort =
        state?.reasoningEffort === 'low' ||
        state?.reasoningEffort === 'medium' ||
        state?.reasoningEffort === 'high' ||
        state?.reasoningEffort === 'xhigh'
            ? state.reasoningEffort
            : undefined;
    const effectiveReasoningEffort =
        byok.enabled && byok.supportsReasoning === false
            ? undefined
            : (result.reasoningEffort ?? sdkReasoningEffort ?? persistedReasoningEffort);
    const sdkSessionLocalMetadata = buildSdkSessionLocalMetadataMap(state, result.session.sessionId, {
        model: effectiveModel,
        reasoningEffort: effectiveReasoningEffort,
        byokSessionBinding,
        bootDecision: sdkSessionBootDecision,
    });

    // SYNC-SM-01 (fix): usar writeStateAsync nas chamadas dentro de funções async para não bloquear o event loop
    if (result.isResumed) {
        const persistedResume = await persistAgentRuntimeStatePartial(
            {
                resumedAt: Date.now(),
                resumeCount: (state?.resumeCount ?? 0) + 1,
                model: effectiveModel,
                systemPromptBinding: buildSystemPromptBindingSnapshot(systemPromptStatus, result.session.sessionId),
                reasoningEffort: effectiveReasoningEffort,
                byokSessionBinding,
                sdkSessionBootDecision,
                sdkSessionLocalMetadata,
                dialogPaused: false,
                pendingTurnMessage: null,
                pendingTurnTs: null,
                pendingTurnConsumedPR: false,
                nextSdkSessionBoot: null,
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
                reasoningEffort: effectiveReasoningEffort,
                byokSessionBinding,
                sdkSessionBootDecision,
                sdkSessionLocalMetadata,
                pendingQuestion: null,
                pendingQuestionMeta: null,
                nextSdkSessionBoot: null,
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
