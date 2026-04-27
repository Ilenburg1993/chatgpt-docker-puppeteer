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

import { log } from '#copilot/observability';
import { INFINITE_SESSION_DEFAULTS, REASONING_EFFORTS, approveAll } from './sdk-config-port.js';

/**
 * @typedef {import('#copilot/sdk/types').SessionConfig} SessionConfig
 *
 * @typedef {import('#copilot/sdk/types').ResumeSessionConfig} ResumeSessionConfig
 *
 * @typedef {import('#copilot/sdk/types').PermissionHandler} PermissionHandler
 *
 * @typedef {import('#copilot/sdk/types').Tool} Tool
 *
 * @typedef {import('#copilot/sdk/types').SystemMessageConfig} SystemMessageConfig
 *
 * @typedef {import('#copilot/sdk/types').MCPServerConfig} MCPServerConfig
 *
 * @typedef {import('#copilot/sdk/types').CustomAgentConfig} CustomAgentConfig
 *
 * @typedef {import('#copilot/sdk/types').DefaultAgentConfig} DefaultAgentConfig
 *
 * @typedef {import('#copilot/sdk/types').InfiniteSessionConfig} InfiniteSessionConfig
 *
 * @typedef {import('#copilot/sdk/types').CommandDefinition} CommandDefinition
 *
 * @typedef {import('#copilot/sdk/types').ElicitationHandler} ElicitationHandler
 *
 * @typedef {import('#copilot/sdk/types').ModelCapabilitiesOverride} ModelCapabilitiesOverride
 *
 * @typedef {import('#copilot/sdk/types').SessionEventHandler} SessionEventHandler
 *
 * @typedef {'low' | 'medium' | 'high' | 'xhigh'} ReasoningEffortLevel
 */

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
        this.#config.provider = provider;
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
        return /** @type {SessionConfig} */ (/** @type {unknown} */ ({ ...this.#config }));
    }

    /**
     * Constrói como `ResumeSessionConfig` (inclui `disableResume`).
     *
     * @returns {ResumeSessionConfig & { disableResume?: boolean }}
     */
    buildForResume() {
        const full = this.build();
        const resume = /** @type {ResumeSessionConfig & { disableResume?: boolean }} */ (/** @type {unknown} */ (full));
        if (this.#config.disableResume !== undefined) {
            resume.disableResume = this.#config.disableResume;
        }
        return resume;
    }
}
