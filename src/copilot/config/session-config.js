// @ts-check
/**
 * src/copilot/config/session-config.js
 *
 * Builder tipado para `SessionConfig` do `@github/copilot-sdk`. Substitui construção manual com objetos literais,
 * garantindo type-safety em todos os 21+ campos da API.
 *
 * @module copilot/config/session-config
 * @see EventBus
 */

import { log } from '#copilot/observability/logger';
import {
    createConfiguredPermissionHandler,
    INFINITE_SESSION_DEFAULTS,
    REASONING_EFFORTS,
    validateProviderConfig,
} from './sdk-config-port.js';

/**
 * @typedef {import('./sdk-config-port.js').SessionConfig} SessionConfig
 *
 * @typedef {import('./sdk-config-port.js').ResumeSessionConfig} ResumeSessionConfig
 *
 * @typedef {import('./sdk-config-port.js').PermissionHandler} PermissionHandler
 *
 * @typedef {import('./sdk-config-port.js').Tool} Tool
 *
 * @typedef {import('./sdk-config-port.js').SystemMessageConfig} SystemMessageConfig
 *
 * @typedef {import('./sdk-config-port.js').MCPServerConfig} MCPServerConfig
 *
 * @typedef {import('./sdk-config-port.js').CustomAgentConfig} CustomAgentConfig
 *
 * @typedef {import('./sdk-config-port.js').DefaultAgentConfig} DefaultAgentConfig
 *
 * @typedef {import('./sdk-config-port.js').InfiniteSessionConfig} InfiniteSessionConfig
 *
 * @typedef {import('./sdk-config-port.js').SessionLimitsConfig} SessionLimitsConfig
 *
 * @typedef {import('./sdk-config-port.js').CommandDefinition} CommandDefinition
 *
 * @typedef {import('./sdk-config-port.js').ElicitationHandler} ElicitationHandler
 *
 * @typedef {import('./sdk-config-port.js').ModelCapabilitiesOverride} ModelCapabilitiesOverride
 *
 * @typedef {import('./sdk-config-port.js').SessionEventHandler} SessionEventHandler
 *
 * @typedef {import('./sdk-config-port.js').CreateSessionFsProvider} CreateSessionFsProvider
 *
 * @typedef {import('./sdk-config-port.js').CreateSessionFsHandler} CreateSessionFsHandler
 *
 * @typedef {'low' | 'medium' | 'high' | 'xhigh'} ReasoningEffortLevel
 *
 * @typedef {Partial<SessionConfig> & Partial<ResumeSessionConfig> & {
 *     configDir?: string;
 *     createSessionFsHandler?: CreateSessionFsProvider;
 *     disableResume?: boolean;
 *     cloud?: unknown;
 * }} CompatSessionConfig
 */

/**
 * Chaves serializáveis aceitas pelo contrato oficial de `ResumeSessionConfig`.
 *
 * @type {readonly string[]}
 */
export const RESUME_SESSION_CONFIG_KEYS = Object.freeze([
    'clientName',
    'model',
    'tools',
    'commands',
    'systemMessage',
    'availableTools',
    'excludedTools',
    'provider',
    'modelCapabilities',
    'streaming',
    'includeSubAgentStreamingEvents',
    'reasoningEffort',
    'reasoningSummary',
    'contextTier',
    'largeOutput',
    'onPermissionRequest',
    'onUserInputRequest',
    'onElicitationRequest',
    'onExitPlanModeRequest',
    'onAutoModeSwitchRequest',
    'hooks',
    'workingDirectory',
    'configDirectory',
    'enableConfigDiscovery',
    'enableSessionTelemetry',
    'skipCustomInstructions',
    'customAgentsLocalOnly',
    'coauthorEnabled',
    'manageScheduleEnabled',
    'mcpOAuthTokenStorage',
    'mcpServers',
    'customAgents',
    'defaultAgent',
    'agent',
    'skillDirectories',
    'pluginDirectories',
    'instructionDirectories',
    'disabledSkills',
    'infiniteSessions',
    'sessionLimits',
    'gitHubToken',
    'skipEmbeddingRetrieval',
    'embeddingCacheStorage',
    'organizationCustomInstructions',
    'enableOnDemandInstructionDiscovery',
    'enableFileHooks',
    'enableHostGitOperations',
    'enableSessionStore',
    'enableSkills',
    'remoteSession',
    'onEvent',
    'createSessionFsProvider',
    'suppressResumeEvent',
    'continuePendingWork',
    'openCanvases',
]);

/**
 * @param {CompatSessionConfig} config
 * @returns {ResumeSessionConfig}
 */
export function sanitizeResumeSessionConfig(config) {
    /** @type {Partial<ResumeSessionConfig>} */
    const resume = {};
    const resumeRecord = /** @type {Record<string, unknown>} */ (resume);
    const configRecord = /** @type {Record<string, unknown>} */ (config);

    for (const key of RESUME_SESSION_CONFIG_KEYS) {
        if (Object.prototype.hasOwnProperty.call(configRecord, key) && configRecord[key] !== undefined) {
            resumeRecord[key] = configRecord[key];
        }
    }

    if (config.configDir !== undefined) {
        resume.configDirectory = config.configDir;
    }
    if (config.createSessionFsHandler !== undefined) {
        resume.createSessionFsProvider = config.createSessionFsHandler;
    }
    if (config.disableResume !== undefined) {
        resume.suppressResumeEvent = config.disableResume;
    }

    if (resume.onPermissionRequest === undefined) {
        resume.onPermissionRequest = createConfiguredPermissionHandler();
    }
    if (resume.streaming === undefined) {
        resume.streaming = true;
    }

    return /** @type {ResumeSessionConfig} */ (/** @type {unknown} */ (resume));
}

/**
 * Builder fluent para `SessionConfig`. Permite construir a configuração de sessão de forma tipada e encadeada.
 *
 * @example
 *     const config = new SessionConfigBuilder()
 *         .model('gpt-4.1')
 *         .clientName('my-app')
 *         .streaming(true)
 *         .onPermissionRequest(createConfiguredPermissionHandler())
 *         .excludedTools(['powershell', 'web_fetch'])
 *         .infiniteSessions({ enabled: true, backgroundCompactionThreshold: 0.8 })
 *         .build();
 */
export class SessionConfigBuilder {
    /** @type {CompatSessionConfig} */
    #config = {};

    // ─── Identificação ────────────────────────────────────────────────────

    /**
     * @param {string} id
     * @returns {this}
     */
    sessionId(id) {
        this.#config.sessionId = id;
        return this;
    }

    /**
     * @param {string} name
     * @returns {this}
     */
    clientName(name) {
        this.#config.clientName = name;
        return this;
    }

    // ─── Modelo ───────────────────────────────────────────────────────────

    /**
     * @param {string} m
     * @returns {this}
     */
    model(m) {
        this.#config.model = m;
        return this;
    }

    /**
     * @param {ReasoningEffortLevel} level
     * @returns {this}
     */
    reasoningEffort(level) {
        const valid = /** @type {string[]} */ (Object.values(REASONING_EFFORTS));
        if (!valid.includes(level)) {
            log('WARN', `[SessionConfigBuilder] reasoningEffort '${level}' inválido. Aceitos: ${valid.join(', ')}`);
        }
        this.#config.reasoningEffort = /** @type {NonNullable<SessionConfig['reasoningEffort']>} */ (level);
        return this;
    }

    // ─── Streaming ────────────────────────────────────────────────────────

    /**
     * @param {boolean} enabled
     * @returns {this}
     */
    streaming(enabled) {
        this.#config.streaming = enabled;
        return this;
    }

    // ─── Diretórios e Paths ───────────────────────────────────────────────

    /**
     * @param {string} dir
     * @returns {this}
     */
    workingDirectory(dir) {
        this.#config.workingDirectory = dir;
        return this;
    }

    /**
     * @param {string} dir
     * @returns {this}
     */
    configDir(dir) {
        return this.configDirectory(dir);
    }

    /**
     * @param {string} dir
     * @returns {this}
     */
    configDirectory(dir) {
        this.#config.configDirectory = dir;
        return this;
    }

    // ─── Tools ────────────────────────────────────────────────────────────

    /**
     * @param {Tool[]} t
     * @returns {this}
     */
    tools(t) {
        this.#config.tools = t;
        return this;
    }

    /**
     * @param {NonNullable<SessionConfig['availableTools']>} names
     * @returns {this}
     */
    availableTools(names) {
        this.#config.availableTools = names;
        return this;
    }

    /**
     * @param {NonNullable<SessionConfig['excludedTools']>} names
     * @returns {this}
     */
    excludedTools(names) {
        this.#config.excludedTools = names;
        return this;
    }

    // ─── Skills ───────────────────────────────────────────────────────────

    /**
     * @param {string[]} dirs
     * @returns {this}
     */
    skillDirectories(dirs) {
        this.#config.skillDirectories = dirs;
        return this;
    }

    /**
     * @param {string[]} skills
     * @returns {this}
     */
    disabledSkills(skills) {
        this.#config.disabledSkills = skills;
        return this;
    }

    // ─── Agents ───────────────────────────────────────────────────────────

    /**
     * @param {string} name
     * @returns {this}
     */
    agent(name) {
        this.#config.agent = name;
        return this;
    }

    /**
     * @param {CustomAgentConfig[]} agents
     * @returns {this}
     */
    customAgents(agents) {
        this.#config.customAgents = agents;
        return this;
    }

    /**
     * @param {DefaultAgentConfig} config
     * @returns {this}
     */
    defaultAgent(config) {
        this.#config.defaultAgent = config;
        return this;
    }

    /**
     * @param {ModelCapabilitiesOverride} overrides
     * @returns {this}
     */
    modelCapabilities(overrides) {
        this.#config.modelCapabilities = overrides;
        return this;
    }

    // ─── MCP ──────────────────────────────────────────────────────────────

    /**
     * @param {Record<string, MCPServerConfig>} servers
     * @returns {this}
     */
    mcpServers(servers) {
        this.#config.mcpServers = servers;
        return this;
    }

    // ─── System Message ───────────────────────────────────────────────────

    /**
     * @param {SystemMessageConfig} msg
     * @returns {this}
     */
    systemMessage(msg) {
        this.#config.systemMessage = msg;
        return this;
    }

    /**
     * @param {CommandDefinition[]} commands
     * @returns {this}
     */
    commands(commands) {
        this.#config.commands = commands;
        return this;
    }

    // ─── Infinite Sessions ────────────────────────────────────────────────

    /**
     * @param {InfiniteSessionConfig} opts
     * @returns {this}
     */
    infiniteSessions(opts) {
        this.#config.infiniteSessions = {
            enabled: opts.enabled ?? true,
            backgroundCompactionThreshold:
                opts.backgroundCompactionThreshold ?? INFINITE_SESSION_DEFAULTS.BACKGROUND_COMPACTION_THRESHOLD,
            ...(opts.bufferExhaustionThreshold !== undefined
                ? { bufferExhaustionThreshold: opts.bufferExhaustionThreshold }
                : {}),
        };
        return this;
    }

    /**
     * Define o soft cap de AI Credits da janela contábil da sessão. Omitir mantém o comportamento do SDK sem cap
     * local; valores não positivos não são aceitos para evitar um bloqueio acidental de todas as chamadas de modelo.
     *
     * @param {SessionLimitsConfig} limits
     * @returns {this}
     */
    sessionLimits(limits) {
        const maxAiCredits = Number(limits?.maxAiCredits);
        if (!Number.isFinite(maxAiCredits) || maxAiCredits <= 0) {
            throw new TypeError('sessionLimits.maxAiCredits must be a finite number greater than zero.');
        }
        this.#config.sessionLimits = { maxAiCredits };
        return this;
    }

    // ─── Provider (BYOK) ─────────────────────────────────────────────────

    /**
     * @param {NonNullable<SessionConfig['provider']>} provider
     * @returns {this}
     */
    provider(provider) {
        this.#config.provider = validateProviderConfig(
            /** @type {import('./sdk-config-port.js').ProviderConfig} */ (/** @type {unknown} */ (provider)),
        );
        return this;
    }

    /**
     * @param {string} token
     * @returns {this}
     */
    gitHubToken(token) {
        this.#config.gitHubToken = token;
        return this;
    }

    /**
     * @param {boolean} enabled
     * @returns {this}
     */
    enableConfigDiscovery(enabled) {
        this.#config.enableConfigDiscovery = enabled;
        return this;
    }

    /**
     * @param {boolean} enabled
     * @returns {this}
     */
    includeSubAgentStreamingEvents(enabled) {
        this.#config.includeSubAgentStreamingEvents = enabled;
        return this;
    }

    // ─── Handlers / Callbacks ─────────────────────────────────────────────

    /**
     * @param {PermissionHandler} handler
     * @returns {this}
     */
    onPermissionRequest(handler) {
        this.#config.onPermissionRequest = handler;
        return this;
    }

    /**
     * @param {NonNullable<SessionConfig['onUserInputRequest']>} handler
     * @returns {this}
     */
    onUserInputRequest(handler) {
        this.#config.onUserInputRequest = handler;
        return this;
    }

    /**
     * @param {ElicitationHandler} handler
     * @returns {this}
     */
    onElicitationRequest(handler) {
        this.#config.onElicitationRequest = handler;
        return this;
    }

    /**
     * @param {SessionEventHandler} handler
     * @returns {this}
     */
    onEvent(handler) {
        this.#config.onEvent = handler;
        return this;
    }

    /**
     * @param {CreateSessionFsProvider} handler
     * @returns {this}
     */
    createSessionFsHandler(handler) {
        return this.createSessionFsProvider(handler);
    }

    /**
     * @param {CreateSessionFsProvider} handler
     * @returns {this}
     */
    createSessionFsProvider(handler) {
        this.#config.createSessionFsProvider = handler;
        return this;
    }

    /**
     * @param {NonNullable<SessionConfig['hooks']>} h
     * @returns {this}
     */
    hooks(h) {
        this.#config.hooks = h;
        return this;
    }

    // ─── Resume-only ──────────────────────────────────────────────────────

    /**
     * RF-PR-06: reconexão silenciosa sem emitir session.resume.
     *
     * @param {boolean} disable
     * @returns {this}
     */
    disableResume(disable) {
        return this.suppressResumeEvent(disable);
    }

    /**
     * @param {boolean} suppress
     * @returns {this}
     */
    suppressResumeEvent(suppress) {
        this.#config.suppressResumeEvent = suppress;
        return this;
    }

    /**
     * @param {boolean} enabled
     * @returns {this}
     */
    continuePendingWork(enabled) {
        this.#config.continuePendingWork = enabled;
        return this;
    }

    /**
     * @param {NonNullable<ResumeSessionConfig['openCanvases']>} canvases
     * @returns {this}
     */
    openCanvases(canvases) {
        this.#config.openCanvases = canvases;
        return this;
    }

    // ─── Merge ────────────────────────────────────────────────────────────

    /**
     * Aplica um `Partial<SessionConfig>` sobre a configuração corrente (spread merge).
     *
     * @param {CompatSessionConfig} partial
     * @returns {this}
     */
    merge(partial) {
        Object.assign(this.#config, partial);
        return this;
    }

    // ─── Build ────────────────────────────────────────────────────────────

    /**
     * Constrói o `SessionConfig` final. Garante `onPermissionRequest` via política configurável; o default permanece
     * `approve_all` e pode ser alterado por `AGENT_PERMISSION_MODE`.
     *
     * @returns {SessionConfig}
     */
    build() {
        if (!this.#config.onPermissionRequest) {
            const configuredMode = process.env['AGENT_PERMISSION_MODE']?.trim() || 'approve_all';
            log(
                'INFO',
                `[SessionConfigBuilder] onPermissionRequest não fornecido — usando política padrão configurável '${configuredMode}' (default efetivo: approve_all).`,
            );
            this.#config.onPermissionRequest = createConfiguredPermissionHandler();
        }
        if (this.#config.streaming === undefined) {
            this.#config.streaming = true;
        }
        const {
            cloud: _ignoredCloud,
            disableResume: _ignoredDisableResume,
            suppressResumeEvent: _ignoredSuppressResumeEvent,
            continuePendingWork: _ignoredContinuePendingWork,
            openCanvases: _ignoredOpenCanvases,
            ...sessionConfig
        } = this.#config;
        void _ignoredCloud;
        void _ignoredDisableResume;
        void _ignoredSuppressResumeEvent;
        void _ignoredContinuePendingWork;
        void _ignoredOpenCanvases;
        return /** @type {SessionConfig} */ (/** @type {unknown} */ ({ ...sessionConfig }));
    }

    /**
     * Constrói como `ResumeSessionConfig` (traduz aliases legados para campos oficiais).
     *
     * @returns {ResumeSessionConfig}
     */
    buildForResume() {
        const full = this.build();
        return sanitizeResumeSessionConfig({
            ...full,
            ...(this.#config.suppressResumeEvent !== undefined
                ? { suppressResumeEvent: this.#config.suppressResumeEvent }
                : {}),
            ...(this.#config.disableResume !== undefined ? { disableResume: this.#config.disableResume } : {}),
            ...(this.#config.continuePendingWork !== undefined
                ? { continuePendingWork: this.#config.continuePendingWork }
                : {}),
            ...(this.#config.openCanvases !== undefined ? { openCanvases: this.#config.openCanvases } : {}),
        });
    }
}
