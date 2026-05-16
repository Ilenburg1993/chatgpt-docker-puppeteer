// @ts-check
/**
 * src/copilot/lib/session.js
 *
 * Lib pura para operacoes de sessao Copilot SDK. Abstrai createSession/resumeSession/listSessions/deleteSession com:
 *
 * - suporte a cliUrl (PM2 - conecta em processo CLI ja existente)
 * - configuracao de infiniteSessions
 * - injecao de systemMessage configuravel
 * - persistencia de estado (delegada ao session-manager.js)
 *
 * @module copilot/lib/session
 * @see EventBus
 * @see module:copilot/session-initializer
 * @see module:copilot/lib/sdk-client
 * @see module:copilot/config/session-config
 */

import { CopilotClient } from '@github/copilot-sdk';
import { toError } from '#copilot/core/error-handlers';
import { DEFAULT_MODEL, INFINITE_SESSION_DEFAULTS, REASONING_EFFORTS } from '../constants.js';
import { getSdkErrorFingerprint, getSdkRecoveryPolicy, toSdkOperationError } from '../errors.js';
import { log } from '../logger.js';
import { emitSdkOperationMetric } from '../telemetry/operation-metrics.js';
import { setSessionAutoModelResolver } from './model-resolution-port.js';
import { approveAll } from './permissions.js';

export { setSessionAutoModelResolver };
/**
 * @typedef {import('@github/copilot-sdk').CopilotSession} CopilotSession
 *
 * @typedef {import('@github/copilot-sdk').SessionConfig} SessionConfig
 *
 * @typedef {import('@github/copilot-sdk').PermissionHandler} PermissionHandler
 *
 * @typedef {import('@github/copilot-sdk').Tool[]} ToolList
 *
 * @typedef {'low' | 'medium' | 'high' | 'xhigh'} ReasoningEffortLevel
 */

/**
 * Resolve `model: "auto"` sem depender estaticamente do pacote de models.
 *
 * Mantido como utilitário explícito para fluxos que precisam de um modelo concreto. A criação/retomada canônica de
 * sessão preserva `model: "auto"` para que o próprio SDK possa aplicar a política nativa de roteamento/quota.
 *
 * @param {string} model
 * @param {string} [fallback='auto'] Default is `'auto'`
 * @returns {Promise<string>}
 */
export async function resolveSessionCreateModel(model, fallback = DEFAULT_MODEL) {
    void fallback;
    if (model !== 'auto') return model;
    return 'auto';
}

/**
 * @typedef {Object} InfiniteSessionOptions
 * @property {boolean} [enabled] - Habilitar InfiniteSession
 * @property {number} [backgroundCompactionThreshold] - Fator 0..1 para compactacao em background
 * @property {number} [bufferExhaustionThreshold] - Fator 0..1 para exaustao de buffer
 */

/**
 * @typedef {Object} SystemMessageSection
 * @property {'append' | 'prepend' | 'override'} action - Acao sobre a secao
 * @property {string} content - Conteudo da secao
 */

/**
 * @typedef {Object} SessionCreateOptions
 * @property {string} [sessionId] - ID customizado da sessão
 * @property {string} [model] - Modelo LLM (ex: 'gpt-4.1', 'claude-sonnet-4-5')
 * @property {string} [clientName] - Identificador do client no User-Agent do SDK
 * @property {ReasoningEffortLevel} [reasoningEffort] - Esforco de reasoning (modelos compatíveis)
 * @property {PermissionHandler} [onPermissionRequest] - Handler de permissoes (default: approveAll)
 * @property {SessionConfig['onUserInputRequest']} [onUserInputRequest] - Handler de input interativo do usuario
 * @property {SessionConfig['onElicitationRequest']} [onElicitationRequest] - Handler de elicitation/form UI do SDK
 * @property {SessionConfig['hooks']} [hooks] - SessionHooks: onPreToolUse, onPostToolUse, onSessionStart, etc.
 * @property {ToolList} [tools] - Custom Tools a registrar na sessao
 * @property {SessionConfig['commands']} [commands] - Slash commands registrados na sessão
 * @property {InfiniteSessionOptions} [infiniteSessions] - Configuracao de InfiniteSession
 * @property {boolean | object} [systemMessage] - false para desabilitar, objeto para customizar
 * @property {string} [systemMessageContent] - Conteudo a injetar em guidelines.append
 * @property {string} [workingDirectory] - Diretorio de trabalho da sessao
 * @property {SessionConfig['modelCapabilities']} [modelCapabilities] - Overrides granulares de capabilities do modelo
 * @property {boolean} [enableConfigDiscovery] - Descobrir MCP/skills/configs a partir do workingDirectory
 * @property {boolean} [includeSubAgentStreamingEvents] - Incluir deltas de streaming de subagentes
 * @property {Record<string, import('@github/copilot-sdk').MCPServerConfig>} [mcpServers] - MCP servers para a sessao
 * @property {import('@github/copilot-sdk').CustomAgentConfig[]} [customAgents] - Agentes customizados
 * @property {SessionConfig['defaultAgent']} [defaultAgent] - Configuração do agente default da sessão
 * @property {boolean} [streaming] - Habilitar streaming (default: true)
 * @property {string[]} [availableTools] - Lista de tools permitidas (overrides excludedTools)
 * @property {string[]} [excludedTools] - Lista de tools desabilitadas
 * @property {SessionConfig['provider']} [provider] - Provider/BYOK por sessão
 * @property {string} [configDir] - Diretorio de configuracao do SDK
 * @property {SessionConfig['onEvent']} [onEvent] - Handler de eventos genéricos do SDK
 * @property {string} [agent] - Agente customizado a selecionar na sessao
 * @property {string[]} [skillDirectories] - Diretórios de skills customizadas
 * @property {string[]} [disabledSkills] - Skills a desabilitar
 * @property {string} [gitHubToken] - Token GitHub por sessão (multitenancy/session-level auth)
 * @property {SessionConfig['createSessionFsHandler']} [createSessionFsHandler] - Factory de SessionFs por sessão
 */

/**
 * @typedef {Object} SessionResumeOptions
 * @property {string} [clientName] - Identificador do client no User-Agent do SDK
 * @property {string} [model] - Modelo alvo da sessão retomada, quando suportado
 * @property {ReasoningEffortLevel} [reasoningEffort] - Esforço de reasoning para a sessão retomada
 * @property {PermissionHandler} [onPermissionRequest]
 * @property {SessionConfig['onUserInputRequest']} [onUserInputRequest]
 * @property {SessionConfig['onElicitationRequest']} [onElicitationRequest]
 * @property {SessionConfig['hooks']} [hooks]
 * @property {ToolList} [tools]
 * @property {SessionConfig['commands']} [commands]
 * @property {InfiniteSessionOptions} [infiniteSessions] - Configuração de InfiniteSession
 * @property {boolean | object} [systemMessage]
 * @property {string} [systemMessageContent]
 * @property {string} [workingDirectory] - Diretório de trabalho da sessão
 * @property {SessionConfig['modelCapabilities']} [modelCapabilities] - Overrides granulares de capabilities do modelo
 * @property {boolean} [enableConfigDiscovery] - Descobrir MCP/skills/configs a partir do workingDirectory
 * @property {boolean} [includeSubAgentStreamingEvents] - Incluir deltas de streaming de subagentes
 * @property {Record<string, import('@github/copilot-sdk').MCPServerConfig>} [mcpServers] - MCP servers da sessão
 * @property {import('@github/copilot-sdk').CustomAgentConfig[]} [customAgents] - Agentes customizados
 * @property {SessionConfig['defaultAgent']} [defaultAgent] - Configuração do agente default da sessão
 * @property {boolean} [streaming]
 * @property {string[]} [availableTools] - Lista de tools permitidas
 * @property {string[]} [excludedTools] - Lista de tools desabilitadas
 * @property {SessionConfig['provider']} [provider] - Provider/BYOK da sessão retomada
 * @property {string} [configDir] - Diretorio de configuracao
 * @property {SessionConfig['onEvent']} [onEvent] - Handler de eventos genéricos
 * @property {string} [agent] - Agente customizado a selecionar
 * @property {string[]} [skillDirectories] - Diretórios de skills
 * @property {string[]} [disabledSkills] - Skills a desabilitar
 * @property {string} [gitHubToken] - Token GitHub por sessão
 * @property {SessionConfig['createSessionFsHandler']} [createSessionFsHandler] - Factory de SessionFs por sessão
 * @property {boolean} [disableResume] - RF-PR-06: se true, reconecta sem emitir session.resume (reconexão silenciosa)
 */

/**
 * @typedef {Object} SessionResult
 * @property {CopilotSession} session - Sessao criada ou retomada
 * @property {boolean} isResumed - true se foi retomada, false se criada
 * @property {string} sessionId - ID da sessao
 * @property {string | undefined} [model] - Modelo efetivamente aplicado à sessão
 * @property {ReasoningEffortLevel | undefined} [reasoningEffort] - Reasoning effort efetivamente aplicado
 */

/**
 * @param {unknown} client
 * @param {string} caller
 * @returns {asserts client is import('@github/copilot-sdk').CopilotClient}
 */
function assertClient(client, caller) {
    if (!client || typeof client !== 'object') {
        throw new TypeError(`[lib/session/${caller}] client inválido ou não fornecido.`);
    }
}

/**
 * @param {unknown} session
 * @param {string} caller
 * @returns {asserts session is CopilotSession}
 */
function assertSession(session, caller) {
    if (!session || typeof session !== 'object' || !('sessionId' in session)) {
        throw new TypeError(`[lib/session/${caller}] sessão inválida ou não fornecida.`);
    }
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
async function wait(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {import('@github/copilot-sdk').CopilotClient} client
 * @param {string} operation
 * @returns {Promise<void>}
 */
async function reconnectClientBestEffort(client, operation) {
    if (typeof client.start !== 'function') return;
    try {
        await client.start();
        log('INFO', `[lib/session] ${operation}: reconnect best-effort concluído via client.start().`);
    } catch (error) {
        log('WARN', `[lib/session] ${operation}: reconnect best-effort falhou: ${toError(error).message}`);
    }
}

/**
 * Padrões de mensagem SDK que indicam que a sessão simplesmente não existe mais no backend (expirou ou o CLI foi
 * reiniciado), tornando a falha de resume um comportamento esperado. Cobrir variações de inglês e português usadas
 * pelo SDK e CLI Copilot.
 */
const EXPECTED_RESUME_MISS_PATTERNS = [
    'session not found',
    'sessao nao encontrada',
    'sessão não encontrada',
    'session expired',
    'session invalid',
    'invalid session',
    'unknown session',
    'session does not exist',
    'no session with id',
    'no such session',
    'session is not active',
];

/**
 * Sessões persistidas podem expirar no backend do SDK entre boots. Nesse caso `resumeOrCreate()` vai criar uma nova
 * sessão logo em seguida; a falha continua sendo métrica de lifecycle, mas não deve aparecer como erro fatal na UX.
 *
 * Cobre: mensagens explícitas de "não encontrado", HTTP 404/410 e variações de expiração/invalidação de sessão.
 *
 * @param {'session.create' | 'session.resume'} operation
 * @param {unknown} error
 * @returns {boolean}
 */
function isExpectedResumeMiss(operation, error) {
    if (operation !== 'session.resume') return false;
    const fp = getSdkErrorFingerprint(error);
    // HTTP 404 (not found) e 410 (gone) são sempre misses esperados em resume
    if (fp.status === 404 || fp.status === 410) return true;
    const haystack = `${fp.code} ${fp.errorType} ${fp.message}`.toLowerCase();
    return EXPECTED_RESUME_MISS_PATTERNS.some((pattern) => haystack.includes(pattern));
}

/**
 * @template T
 * @param {{
 *     client: import('@github/copilot-sdk').CopilotClient;
 *     operation: 'session.create' | 'session.resume';
 *     successAttributes?: Record<string, unknown>;
 *     run: () => Promise<T>;
 * }} params
 * @returns {Promise<T>}
 */
async function runSessionLifecycleOperation(params) {
    const startedAt = Date.now();
    emitSdkOperationMetric({
        operation: params.operation,
        status: 'started',
        ...(params.successAttributes ? { attributes: params.successAttributes } : {}),
    });

    const maxAttempts = 2;
    /** @type {unknown} */
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const result = await params.run();
            emitSdkOperationMetric({
                operation: params.operation,
                status: 'succeeded',
                durationMs: Date.now() - startedAt,
                attributes: {
                    ...(params.successAttributes ?? {}),
                    attempt,
                },
            });
            return result;
        } catch (error) {
            lastError = error;
            const policy = getSdkRecoveryPolicy(error, 'session');
            const shouldRetry = policy.retryable && attempt < maxAttempts;
            const expectedResumeMiss = isExpectedResumeMiss(params.operation, error);

            log(
                shouldRetry || expectedResumeMiss ? 'WARN' : 'ERROR',
                `[lib/session] ${params.operation} falhou (attempt=${attempt}/${maxAttempts}, kind=${policy.kind}, retryable=${policy.retryable}, reconnect=${policy.allowReconnect}): ${toError(error).message}`,
            );

            if (shouldRetry) {
                if (policy.allowReconnect) {
                    await reconnectClientBestEffort(params.client, params.operation);
                }
                await wait(policy.backoffMs);
                continue;
            }

            const finalError = toSdkOperationError(params.operation, error);
            emitSdkOperationMetric({
                operation: params.operation,
                status: 'failed',
                durationMs: Date.now() - startedAt,
                attributes: {
                    ...(params.successAttributes ?? {}),
                    attempt,
                    retryable: policy.retryable,
                    allowReconnect: policy.allowReconnect,
                    errorKind: finalError.kind,
                },
            });
            throw finalError;
        }
    }

    const finalError = toSdkOperationError(params.operation, lastError);
    emitSdkOperationMetric({
        operation: params.operation,
        status: 'failed',
        durationMs: Date.now() - startedAt,
        attributes: {
            ...(params.successAttributes ?? {}),
            errorKind: finalError.kind,
        },
    });
    throw finalError;
}

// ─── Helpers internos ─────────────────────────────────────────────────────────

/**
 * Constroi o objeto systemMessage para injecao via SDK.
 *
 * @param {boolean | object | undefined} systemMessageOpt
 * @param {string | undefined} content
 * @returns {object | undefined}
 */
function buildSystemMessageConfig(systemMessageOpt, content) {
    if (systemMessageOpt === false) return undefined;
    if (systemMessageOpt && typeof systemMessageOpt === 'object') return systemMessageOpt;
    if (!content) return undefined;

    // SDK-03 (update): SDK 0.2.0 suporta mode:'customize' com sections e content.
    // Usando mode:'customize' com content equivale ao antigo mode:'append', mas permite
    // future section-level overrides sem quebrar compatibilidade.
    return {
        mode: 'customize',
        content,
    };
}

/**
 * Constroi o objeto InfiniteSession defaults + opcoes do usuario.
 *
 * @param {InfiniteSessionOptions | undefined} opts
 * @returns {object}
 */
function buildInfiniteSessionConfig(opts) {
    return {
        enabled: opts?.enabled ?? true,
        backgroundCompactionThreshold:
            opts?.backgroundCompactionThreshold ?? INFINITE_SESSION_DEFAULTS.BACKGROUND_COMPACTION_THRESHOLD,
        ...(opts?.bufferExhaustionThreshold !== undefined
            ? { bufferExhaustionThreshold: opts.bufferExhaustionThreshold }
            : {}),
    };
}

/**
 * Reasoning effort default aplicado quando `gpt-5-mini` for solicitado explicitamente.
 *
 * @returns {ReasoningEffortLevel}
 */
function getDefaultGpt5MiniReasoningEffort() {
    const configured = process.env['COPILOT_GPT5_MINI_REASONING_EFFORT'];
    const valid = /** @type {ReasoningEffortLevel[]} */ (Object.values(REASONING_EFFORTS));
    if (configured && valid.includes(/** @type {ReasoningEffortLevel} */ (configured))) {
        return /** @type {ReasoningEffortLevel} */ (configured);
    }
    if (configured) {
        log('WARN', `[lib/session] COPILOT_GPT5_MINI_REASONING_EFFORT='${configured}' inválido; usando high.`);
    }
    return REASONING_EFFORTS.HIGH;
}

/**
 * Monta o SessionConfig para createSession/resumeSession, usando objeto tipado com chaves condicionais.
 *
 * @param {SessionCreateOptions | SessionResumeOptions} opts
 * @param {'create' | 'resume'} mode
 * @returns {import('@github/copilot-sdk').SessionConfig
 *     | (import('@github/copilot-sdk').SessionConfig & { disableResume?: boolean })}
 */
function buildSessionConfig(opts, mode) {
    if (!opts.onPermissionRequest) {
        log('WARN', '[lib/session] onPermissionRequest não fornecido — usando approveAll como fallback');
    }

    /** @type {Partial<import('@github/copilot-sdk').SessionConfig> & { disableResume?: boolean }} */
    const cfg = {
        streaming: opts.streaming ?? true,
        onPermissionRequest: opts.onPermissionRequest ?? approveAll,
    };

    if (mode === 'create') {
        const co = /** @type {SessionCreateOptions} */ (opts);
        if (co.sessionId !== undefined) cfg.sessionId = co.sessionId;
        if (co.model !== undefined) cfg.model = co.model;
        if (co.clientName !== undefined) cfg.clientName = co.clientName;
        if (co.reasoningEffort !== undefined) {
            const valid = /** @type {string[]} */ (Object.values(REASONING_EFFORTS));
            if (!valid.includes(co.reasoningEffort)) {
                log(
                    'WARN',
                    `[lib/session] reasoningEffort '${co.reasoningEffort}' inválido. Valores aceitos: ${valid.join(', ')}`,
                );
            }
            cfg.reasoningEffort = /** @type {ReasoningEffortLevel} */ (co.reasoningEffort);
        }
        if (co.modelCapabilities !== undefined) cfg.modelCapabilities = co.modelCapabilities;
        if (co.enableConfigDiscovery !== undefined) cfg.enableConfigDiscovery = co.enableConfigDiscovery;
        if (co.workingDirectory !== undefined) cfg.workingDirectory = co.workingDirectory;
        if (co.includeSubAgentStreamingEvents !== undefined) {
            cfg.includeSubAgentStreamingEvents = co.includeSubAgentStreamingEvents;
        }
        if (co.mcpServers !== undefined) cfg.mcpServers = co.mcpServers;
        if (co.customAgents !== undefined) cfg.customAgents = co.customAgents;
        if (co.defaultAgent !== undefined) cfg.defaultAgent = co.defaultAgent;
        if (co.availableTools !== undefined) cfg.availableTools = co.availableTools;
        if (co.excludedTools !== undefined) cfg.excludedTools = co.excludedTools;
        if (co.provider !== undefined) cfg.provider = co.provider;
        if (co.configDir !== undefined) cfg.configDir = co.configDir;
        if (co.onEvent !== undefined) cfg.onEvent = co.onEvent;
        if (co.agent !== undefined) cfg.agent = co.agent;
        if (co.skillDirectories !== undefined) cfg.skillDirectories = co.skillDirectories;
        if (co.disabledSkills !== undefined) cfg.disabledSkills = co.disabledSkills;
        if (co.gitHubToken !== undefined) cfg.gitHubToken = co.gitHubToken;
        if (co.createSessionFsHandler !== undefined) cfg.createSessionFsHandler = co.createSessionFsHandler;
        // BUG-HIGH-06 (fix): só aplicar infiniteSessions quando explicitamente fornecido
        // Evita habilitar compaction automática em sessões que não solicitaram (ex: routes/sessions.js)
        if (co.infiniteSessions !== undefined) {
            cfg.infiniteSessions = buildInfiniteSessionConfig(co.infiniteSessions);
        }
    }

    if (opts.onUserInputRequest !== undefined) cfg.onUserInputRequest = opts.onUserInputRequest;
    if (opts.onElicitationRequest !== undefined) cfg.onElicitationRequest = opts.onElicitationRequest;

    // RF-PR-01: compor hooks — onErrorOccurred com retry automático está em buildErrorOccurredHandler() (hooks.js)
    // e é o default de createHooks(). Preservamos hooks do usuário sem sobrescrever.
    if (opts.hooks !== undefined) {
        cfg.hooks = /** @type {NonNullable<SessionConfig['hooks']>} */ ({ ...opts.hooks });
    }

    if (opts.tools !== undefined) cfg.tools = opts.tools;
    if (opts.commands !== undefined) cfg.commands = opts.commands;

    // RF-PR-06: disableResume — reconexão silenciosa sem emitir session.resume
    if (mode === 'resume') {
        const ro = /** @type {SessionResumeOptions} */ (opts);
        if (ro.clientName !== undefined) cfg.clientName = ro.clientName;
        if (ro.model !== undefined) cfg.model = ro.model;
        if (ro.reasoningEffort !== undefined) {
            const valid = /** @type {string[]} */ (Object.values(REASONING_EFFORTS));
            if (!valid.includes(ro.reasoningEffort)) {
                log(
                    'WARN',
                    `[lib/session] reasoningEffort '${ro.reasoningEffort}' inválido. Valores aceitos: ${valid.join(', ')}`,
                );
            }
            cfg.reasoningEffort = /** @type {ReasoningEffortLevel} */ (ro.reasoningEffort);
        }
        if (ro.modelCapabilities !== undefined) cfg.modelCapabilities = ro.modelCapabilities;
        if (ro.enableConfigDiscovery !== undefined) cfg.enableConfigDiscovery = ro.enableConfigDiscovery;
        if (ro.workingDirectory !== undefined) cfg.workingDirectory = ro.workingDirectory;
        if (ro.includeSubAgentStreamingEvents !== undefined) {
            cfg.includeSubAgentStreamingEvents = ro.includeSubAgentStreamingEvents;
        }
        if (ro.mcpServers !== undefined) cfg.mcpServers = ro.mcpServers;
        if (ro.customAgents !== undefined) cfg.customAgents = ro.customAgents;
        if (ro.defaultAgent !== undefined) cfg.defaultAgent = ro.defaultAgent;
        if (ro.availableTools !== undefined) cfg.availableTools = ro.availableTools;
        if (ro.excludedTools !== undefined) cfg.excludedTools = ro.excludedTools;
        if (ro.provider !== undefined) cfg.provider = ro.provider;
        if (ro.configDir !== undefined) cfg.configDir = ro.configDir;
        if (ro.onEvent !== undefined) cfg.onEvent = ro.onEvent;
        if (ro.agent !== undefined) cfg.agent = ro.agent;
        if (ro.skillDirectories !== undefined) cfg.skillDirectories = ro.skillDirectories;
        if (ro.disabledSkills !== undefined) cfg.disabledSkills = ro.disabledSkills;
        if (ro.infiniteSessions !== undefined) {
            cfg.infiniteSessions = buildInfiniteSessionConfig(ro.infiniteSessions);
        }
        if (ro.gitHubToken !== undefined) cfg.gitHubToken = ro.gitHubToken;
        if (ro.createSessionFsHandler !== undefined) cfg.createSessionFsHandler = ro.createSessionFsHandler;
        if (ro.disableResume !== undefined) cfg.disableResume = ro.disableResume;
    }

    const systemMsg = buildSystemMessageConfig(opts.systemMessage, opts.systemMessageContent);
    if (systemMsg !== undefined)
        cfg.systemMessage = /** @type {import('@github/copilot-sdk').SystemMessageConfig} */ (systemMsg);

    return /** @type {import('@github/copilot-sdk').SessionConfig} */ (cfg);
}

/**
 * Normaliza model/reasoningEffort para `resumeSession`.
 *
 * Regra arquitetural: `model='auto'` deve chegar ao SDK. Ele é um alvo nativo do Copilot, não só placeholder local; sem
 * isso, sessões retomadas ficam presas em um modelo concreto antigo e não conseguem obedecer a mensagens de quota como
 * “switch to auto model”. Reasoning effort é omitido nesse caso porque o modelo efetivo será decidido pelo SDK.
 *
 * @param {SessionResumeOptions} options
 * @returns {{ model?: string | undefined; reasoningEffort?: ReasoningEffortLevel | undefined }}
 */
function normalizeResumeModelSelection(options) {
    const selectedModel = options.model;
    if (selectedModel === 'auto') {
        if (options.reasoningEffort !== undefined) {
            log(
                'INFO',
                '[lib/session] resumeSession: preservando model="auto" nativo e omitindo reasoningEffort até que haja modelo concreto.',
            );
        } else {
            log('INFO', '[lib/session] resumeSession: preservando model="auto" nativo na retomada.');
        }
        return { model: 'auto' };
    }

    if (selectedModel === undefined && options.reasoningEffort !== undefined) {
        log(
            'INFO',
            '[lib/session] resumeSession: reasoningEffort omitido porque nenhuma troca explícita de modelo foi solicitada.',
        );
        return {};
    }

    return {
        ...(selectedModel !== undefined ? { model: selectedModel } : {}),
        ...(options.reasoningEffort !== undefined ? { reasoningEffort: options.reasoningEffort } : {}),
    };
}

// ─── API publica ──────────────────────────────────────────────────────────────

/**
 * Cria uma nova sessao com o cliente SDK.
 *
 * @example
 *     const { session } = await createSession(client, { model: 'auto' });
 *
 * @param {import('@github/copilot-sdk').CopilotClient} client - CopilotClient instanciado
 * @param {SessionCreateOptions} [opts] - Opcoes de configuracao
 * @returns {Promise<SessionResult>}
 * @throws {Error} Se o SDK falhar ao criar sessão
 */
export async function createSession(client, opts) {
    assertClient(client, 'createSession');
    const options = opts ?? {};
    const model = options.model ?? DEFAULT_MODEL;
    let reasoningEffort = options.reasoningEffort;

    if (model === 'auto') {
        log('INFO', '[session] Preservando model="auto" nativo do SDK.');
        if (reasoningEffort !== undefined) {
            log('INFO', '[session] reasoningEffort omitido porque model="auto" será resolvido pelo SDK.');
            reasoningEffort = undefined;
        }
    }

    // Compatibilidade: quando gpt-5-mini for solicitado explicitamente, aplica reasoning default configurável por env.
    if (!reasoningEffort && model === 'gpt-5-mini') {
        reasoningEffort = getDefaultGpt5MiniReasoningEffort();
    }

    /** @type {SessionCreateOptions} */
    const createOptions = { ...options, model };
    if (reasoningEffort !== undefined) {
        createOptions.reasoningEffort = reasoningEffort;
    } else if ('reasoningEffort' in createOptions) {
        delete createOptions.reasoningEffort;
    }
    const config = buildSessionConfig(createOptions, 'create');

    log('INFO', `[lib/session] Criando nova sessao: model='${model}'`);
    const session = await runSessionLifecycleOperation({
        client,
        operation: 'session.create',
        successAttributes: {
            model,
            reasoningEffort: reasoningEffort ?? null,
        },
        run: async () => client.createSession(config),
    });
    log('INFO', `[lib/session] Sessao criada: ${session.sessionId}`);
    return {
        session,
        isResumed: false,
        sessionId: session.sessionId,
        model,
        ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
    };
}

/**
 * Retoma uma sessao existente pelo ID.
 *
 * @example
 *     const { session } = await resumeSession(client, 'abc-123');
 *
 * @param {import('@github/copilot-sdk').CopilotClient} client - CopilotClient instanciado
 * @param {string} sessionId - ID da sessao a retomar
 * @param {SessionResumeOptions} [opts] - Opcoes de configuracao compatíveis com resume
 * @returns {Promise<SessionResult>}
 * @throws {Error} Se a sessao nao existir ou estiver expirada
 */
export async function resumeSession(client, sessionId, opts) {
    assertClient(client, 'resumeSession');
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
        throw new TypeError('[lib/session/resumeSession] sessionId deve ser string não-vazia.');
    }
    const options = opts ?? {};
    const normalizedSelection = normalizeResumeModelSelection(options);
    /** @type {SessionResumeOptions} */
    const sanitizedOptions = {
        ...options,
        ...(normalizedSelection.model !== undefined ? { model: normalizedSelection.model } : {}),
        ...(normalizedSelection.reasoningEffort !== undefined
            ? { reasoningEffort: normalizedSelection.reasoningEffort }
            : {}),
    };
    if (normalizedSelection.model === undefined && 'model' in sanitizedOptions) {
        delete sanitizedOptions.model;
    }
    if (normalizedSelection.reasoningEffort === undefined && 'reasoningEffort' in sanitizedOptions) {
        delete sanitizedOptions.reasoningEffort;
    }
    const config = buildSessionConfig(sanitizedOptions, 'resume');

    log('INFO', `[lib/session] Retomando sessao: ${sessionId}`);
    const session = await runSessionLifecycleOperation({
        client,
        operation: 'session.resume',
        successAttributes: {
            sessionId,
            model: normalizedSelection.model ?? null,
            reasoningEffort: normalizedSelection.reasoningEffort ?? null,
            disableResume: Boolean(/** @type {{ disableResume?: boolean }} */ (config).disableResume),
        },
        run: async () => client.resumeSession(sessionId, config),
    });
    log('INFO', `[lib/session] Sessao retomada: ${session.sessionId}`);
    return {
        session,
        isResumed: true,
        sessionId: session.sessionId,
        ...(normalizedSelection.model !== undefined ? { model: normalizedSelection.model } : {}),
        ...(normalizedSelection.reasoningEffort !== undefined
            ? { reasoningEffort: normalizedSelection.reasoningEffort }
            : {}),
    };
}

/**
 * Tenta retomar uma sessao; se falhar, cria uma nova. Padrao usado pelo session-manager para persistencia entre
 * reinicializacoes.
 *
 * @param {import('@github/copilot-sdk').CopilotClient} client - CopilotClient instanciado
 * @param {string | null | undefined} existingSessionId - ID da sessao persistida (ou null)
 * @param {SessionCreateOptions} [opts] - Opcoes usadas tanto para resume quanto para create
 * @returns {Promise<SessionResult>}
 */
export async function resumeOrCreate(client, existingSessionId, opts) {
    if (existingSessionId) {
        try {
            const result = await resumeSession(client, existingSessionId, opts);
            return result;
        } catch (e) {
            const isMiss = isExpectedResumeMiss('session.resume', e);
            log(
                'WARN',
                `[lib/session] Falha ao retomar '${existingSessionId}': ${toError(e).message}. Criando nova sessao.${isMiss ? ' (miss esperado — CLI reiniciado ou sessao expirada)' : ''}`,
            );
        }
    }
    return createSession(client, opts);
}

/**
 * Lista todas as sessoes ativas no cliente.
 *
 * @param {import('@github/copilot-sdk').CopilotClient} client - CopilotClient instanciado
 * @param {object} [filter] - Filtro opcional
 * @returns {Promise<import('@github/copilot-sdk').SessionMetadata[]>}
 * @throws {Error} Se a comunicação com o SDK falhar
 */
export async function listSessions(client, filter) {
    assertClient(client, 'listSessions');
    try {
        return await client.listSessions(filter);
    } catch (error) {
        throw toSdkOperationError('session.list', error);
    }
}

/**
 * Remove uma sessao pelo ID.
 *
 * @param {import('@github/copilot-sdk').CopilotClient} client - CopilotClient instanciado
 * @param {string} sessionId - ID da sessao a remover
 * @returns {Promise<void>}
 * @throws {Error} Se a comunicação com o SDK falhar
 */
export async function deleteSession(client, sessionId) {
    assertClient(client, 'deleteSession');
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
        throw new TypeError('[lib/session/deleteSession] sessionId deve ser string não-vazia.');
    }
    try {
        await client.deleteSession(sessionId);
    } catch (error) {
        throw toSdkOperationError('session.delete', error);
    }
    log('INFO', `[lib/session] Sessao removida: ${sessionId}`);
}

/**
 * Desconecta uma sessao ativa (sem remover do servidor).
 *
 * @param {CopilotSession} session - Sessao a desconectar
 * @returns {Promise<void>}
 * @throws {Error} Se a sessão já estiver desconectada ou comunicação falhar
 */
export async function disconnectSession(session) {
    assertSession(session, 'disconnectSession');
    log('INFO', `[lib/session] Desconectando sessao: ${session.sessionId}`);
    try {
        await session.disconnect();
    } catch (error) {
        throw toSdkOperationError('session.disconnect', error);
    }
    log('INFO', `[lib/session] Sessao desconectada: ${session.sessionId}`);
}

/**
 * Cria um CopilotClient conectado a um processo CLI externo (modo PM2 / cliUrl). Nao inicia um novo processo — conecta
 * no URL fornecido.
 *
 * @example
 *     // PM2 roda o CLI em background; aqui nos conectamos sem iniciar novo processo.
 *     const client = createClientFromCliUrl('http://localhost:3100');
 *
 * @param {string} cliUrl - URL do processo CLI ja em execucao (ex: 'http://localhost:3100')
 * @returns {CopilotClient}
 */
export function createClientFromCliUrl(cliUrl) {
    if (typeof cliUrl !== 'string' || cliUrl.length === 0) {
        throw new TypeError('[lib/session/createClientFromCliUrl] cliUrl deve ser string não-vazia.');
    }
    log('INFO', `[lib/session] Conectando ao CLI externo: ${cliUrl}`);
    return new CopilotClient({ cliUrl });
}

/** @internal Expõe funções internas para testes unitários. */
export const __test__ = { isExpectedResumeMiss, EXPECTED_RESUME_MISS_PATTERNS };
