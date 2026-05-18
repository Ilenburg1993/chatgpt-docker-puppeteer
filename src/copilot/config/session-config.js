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
import { approveAll, INFINITE_SESSION_DEFAULTS, REASONING_EFFORTS, validateProviderConfig } from './sdk-config-port.js';

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
 * @typedef {import('./sdk-config-port.js').CommandDefinition} CommandDefinition
 *
 * @typedef {import('./sdk-config-port.js').ElicitationHandler} ElicitationHandler
 *
 * @typedef {import('./sdk-config-port.js').ModelCapabilitiesOverride} ModelCapabilitiesOverride
 *
 * @typedef {import('./sdk-config-port.js').SessionEventHandler} SessionEventHandler
 *
 * @typedef {import('./sdk-config-port.js').CreateSessionFsHandler} CreateSessionFsHandler
 *
 * @typedef {'low' | 'medium' | 'high' | 'xhigh'} ReasoningEffortLevel
 */

/**
 * Chaves serializáveis aceitas pelo contrato oficial de `ResumeSessionConfig`.
 *
 * @type {readonly (keyof ResumeSessionConfig)[]}
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
    'onPermissionRequest',
    'onUserInputRequest',
    'onElicitationRequest',
    'hooks',
    'workingDirectory',
    'configDir',
    'enableConfigDiscovery',
    'mcpServers',
    'customAgents',
    'defaultAgent',
    'agent',
    'skillDirectories',
    'disabledSkills',
    'infiniteSessions',
    'gitHubToken',
    'onEvent',
    'createSessionFsHandler',
]);

/**
 * @param {Partial<SessionConfig> & { disableResume?: boolean }} config
 * @returns {ResumeSessionConfig & { disableResume?: boolean }}
 */
export function sanitizeResumeSessionConfig(config) {
    /** @type {Partial<ResumeSessionConfig> & { disableResume?: boolean }} */
    const resume = {};
    const resumeRecord = /** @type {Record<string, unknown>} */ (resume);
    const configRecord = /** @type {Record<string, unknown>} */ (config);

    for (const key of RESUME_SESSION_CONFIG_KEYS) {
        if (Object.prototype.hasOwnProperty.call(config, key) && config[key] !== undefined) {
            resumeRecord[key] = configRecord[key];
        }
    }

    if (resume.onPermissionRequest === undefined) {
        resume.onPermissionRequest = approveAll;
    }
    if (resume.streaming === undefined) {
        resume.streaming = true;
    }
    if (config.disableResume !== undefined) {
        resume.disableResume = config.disableResume;
    }

    return /** @type {ResumeSessionConfig & { disableResume?: boolean }} */ (/** @type {unknown} */ (resume));
}

/**
 * Builder fluent para `SessionConfig`. Permite construir a configuração de sessão de forma tipada e encadeada.
 *
 * @example
 *     const config = new SessionConfigBuilder()
 *         .model('gpt-4.1')
 *         .clientName('my-app')
 *         .streaming(true)
 *         .onPermissionRequest(approveAll)
 *         .excludedTools(['powershell', 'web_fetch'])
 *         .infiniteSessions({ enabled: true, backgroundCompactionThreshold: 0.8 })
 *         .build();
 */
export class SessionConfigBuilder {
    /** @type {Partial<SessionConfig> & { disableResume?: boolean }} */
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
        this.#config.configDir = dir;
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
     * @param {string[]} names
     * @returns {this}
     */
    availableTools(names) {
        this.#config.availableTools = names;
        return this;
    }

    /**
     * @param {string[]} names
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
     * @param {CreateSessionFsHandler} handler
     * @returns {this}
     */
    createSessionFsHandler(handler) {
        this.#config.createSessionFsHandler = handler;
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
        this.#config.disableResume = disable;
        return this;
    }

    // ─── Merge ────────────────────────────────────────────────────────────

    /**
     * Aplica um `Partial<SessionConfig>` sobre a configuração corrente (spread merge).
     *
     * @param {Partial<SessionConfig>} partial
     * @returns {this}
     */
    merge(partial) {
        Object.assign(this.#config, partial);
        return this;
    }

    // ─── Build ────────────────────────────────────────────────────────────

    /**
     * Constrói o `SessionConfig` final. Garante que `onPermissionRequest` está presente (fallback: `approveAll`).
     *
     * @returns {SessionConfig}
     */
    build() {
        if (!this.#config.onPermissionRequest) {
            log('WARN', '[SessionConfigBuilder] onPermissionRequest não fornecido — usando approveAll como fallback');
            this.#config.onPermissionRequest = approveAll;
        }
        if (this.#config.streaming === undefined) {
            this.#config.streaming = true;
        }
        const { disableResume: _ignoredDisableResume, ...sessionConfig } = this.#config;
        void _ignoredDisableResume;
        return /** @type {SessionConfig} */ (/** @type {unknown} */ ({ ...sessionConfig }));
    }

    /**
     * Constrói como `ResumeSessionConfig` (inclui `disableResume`).
     *
     * @returns {ResumeSessionConfig & { disableResume?: boolean }}
     */
    buildForResume() {
        const full = this.build();
        return sanitizeResumeSessionConfig({
            ...full,
            ...(this.#config.disableResume !== undefined ? { disableResume: this.#config.disableResume } : {}),
        });
    }
}
