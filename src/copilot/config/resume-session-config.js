// @ts-check
/**
 * src/copilot/config/resume-session-config.js
 *
 * Builder dedicado para `ResumeSessionConfig` do `@github/copilot-sdk`.
 *
 * Evita vazamento de campos exclusivos de criação (`sessionId`) para fluxos de retomada e mantém uma superfície
 * explícita, alinhada ao contrato oficial do SDK.
 *
 * @module copilot/config/resume-session-config
 */

import { SessionConfigBuilder, sanitizeResumeSessionConfig } from './session-config.js';

/**
 * @typedef {import('./sdk-config-port.js').ResumeSessionConfig} ResumeSessionConfig
 *
 * @typedef {import('./sdk-config-port.js').Tool} Tool
 *
 * @typedef {import('./sdk-config-port.js').CommandDefinition} CommandDefinition
 *
 * @typedef {import('./sdk-config-port.js').SystemMessageConfig} SystemMessageConfig
 *
 * @typedef {import('./sdk-config-port.js').ProviderConfig} ProviderConfig
 *
 * @typedef {import('./sdk-config-port.js').ModelCapabilitiesOverride} ModelCapabilitiesOverride
 *
 * @typedef {import('./sdk-config-port.js').PermissionHandler} PermissionHandler
 *
 * @typedef {import('./sdk-config-port.js').ElicitationHandler} ElicitationHandler
 *
 * @typedef {import('./sdk-config-port.js').MCPServerConfig} MCPServerConfig
 *
 * @typedef {import('./sdk-config-port.js').CustomAgentConfig} CustomAgentConfig
 *
 * @typedef {import('./sdk-config-port.js').DefaultAgentConfig} DefaultAgentConfig
 *
 * @typedef {import('./sdk-config-port.js').InfiniteSessionConfig} InfiniteSessionConfig
 *
 * @typedef {import('./sdk-config-port.js').SessionEventHandler} SessionEventHandler
 *
 * @typedef {import('./sdk-config-port.js').CreateSessionFsProvider} CreateSessionFsProvider
 *
 * @typedef {import('./sdk-config-port.js').CreateSessionFsHandler} CreateSessionFsHandler
 */

export class ResumeSessionConfigBuilder {
    /** @type {SessionConfigBuilder} */
    #base = new SessionConfigBuilder();

    /** @type {boolean | undefined} */
    #suppressResumeEvent;

    /** @type {ResumeSessionConfig['openCanvases']} */
    #openCanvases;

    /** @param {string} name @returns {this} */
    clientName(name) {
        this.#base.clientName(name);
        return this;
    }

    /** @param {string} model @returns {this} */
    model(model) {
        this.#base.model(model);
        return this;
    }

    /** @param {'low' | 'medium' | 'high' | 'xhigh'} level @returns {this} */
    reasoningEffort(level) {
        this.#base.reasoningEffort(level);
        return this;
    }

    /** @param {ModelCapabilitiesOverride} overrides @returns {this} */
    modelCapabilities(overrides) {
        this.#base.modelCapabilities(overrides);
        return this;
    }

    /** @param {string} dir @returns {this} */
    configDir(dir) {
        this.#base.configDir(dir);
        return this;
    }

    /** @param {string} dir @returns {this} */
    configDirectory(dir) {
        this.#base.configDirectory(dir);
        return this;
    }

    /** @param {boolean} enabled @returns {this} */
    enableConfigDiscovery(enabled) {
        this.#base.enableConfigDiscovery(enabled);
        return this;
    }

    /** @param {Tool[]} tools @returns {this} */
    tools(tools) {
        this.#base.tools(tools);
        return this;
    }

    /** @param {CommandDefinition[]} commands @returns {this} */
    commands(commands) {
        this.#base.commands(commands);
        return this;
    }

    /** @param {SystemMessageConfig} msg @returns {this} */
    systemMessage(msg) {
        this.#base.systemMessage(msg);
        return this;
    }

    /** @param {NonNullable<ResumeSessionConfig['availableTools']>} names @returns {this} */
    availableTools(names) {
        this.#base.availableTools(names);
        return this;
    }

    /** @param {NonNullable<ResumeSessionConfig['excludedTools']>} names @returns {this} */
    excludedTools(names) {
        this.#base.excludedTools(names);
        return this;
    }

    /** @param {ProviderConfig} provider @returns {this} */
    provider(provider) {
        this.#base.provider(provider);
        return this;
    }

    /** @param {PermissionHandler} handler @returns {this} */
    onPermissionRequest(handler) {
        this.#base.onPermissionRequest(handler);
        return this;
    }

    /** @param {NonNullable<ResumeSessionConfig['onUserInputRequest']>} handler @returns {this} */
    onUserInputRequest(handler) {
        this.#base.onUserInputRequest(handler);
        return this;
    }

    /** @param {ElicitationHandler} handler @returns {this} */
    onElicitationRequest(handler) {
        this.#base.onElicitationRequest(handler);
        return this;
    }

    /** @param {NonNullable<ResumeSessionConfig['hooks']>} hooks @returns {this} */
    hooks(hooks) {
        this.#base.hooks(hooks);
        return this;
    }

    /** @param {string} dir @returns {this} */
    workingDirectory(dir) {
        this.#base.workingDirectory(dir);
        return this;
    }

    /** @param {boolean} enabled @returns {this} */
    streaming(enabled) {
        this.#base.streaming(enabled);
        return this;
    }

    /** @param {boolean} enabled @returns {this} */
    includeSubAgentStreamingEvents(enabled) {
        this.#base.includeSubAgentStreamingEvents(enabled);
        return this;
    }

    /** @param {Record<string, MCPServerConfig>} servers @returns {this} */
    mcpServers(servers) {
        this.#base.mcpServers(servers);
        return this;
    }

    /** @param {CustomAgentConfig[]} agents @returns {this} */
    customAgents(agents) {
        this.#base.customAgents(agents);
        return this;
    }

    /** @param {DefaultAgentConfig} config @returns {this} */
    defaultAgent(config) {
        this.#base.defaultAgent(config);
        return this;
    }

    /** @param {string} name @returns {this} */
    agent(name) {
        this.#base.agent(name);
        return this;
    }

    /** @param {string[]} dirs @returns {this} */
    skillDirectories(dirs) {
        this.#base.skillDirectories(dirs);
        return this;
    }

    /** @param {string[]} skills @returns {this} */
    disabledSkills(skills) {
        this.#base.disabledSkills(skills);
        return this;
    }

    /** @param {InfiniteSessionConfig} config @returns {this} */
    infiniteSessions(config) {
        this.#base.infiniteSessions(config);
        return this;
    }

    /** @param {string} token @returns {this} */
    gitHubToken(token) {
        this.#base.gitHubToken(token);
        return this;
    }

    /** @param {SessionEventHandler} handler @returns {this} */
    onEvent(handler) {
        this.#base.onEvent(handler);
        return this;
    }

    /** @param {CreateSessionFsProvider} handler @returns {this} */
    createSessionFsHandler(handler) {
        this.#base.createSessionFsHandler(handler);
        return this;
    }

    /** @param {CreateSessionFsProvider} handler @returns {this} */
    createSessionFsProvider(handler) {
        this.#base.createSessionFsProvider(handler);
        return this;
    }

    /** @param {boolean} disable @returns {this} */
    disableResume(disable) {
        return this.suppressResumeEvent(disable);
    }

    /** @param {boolean} suppress @returns {this} */
    suppressResumeEvent(suppress) {
        this.#suppressResumeEvent = suppress;
        return this;
    }

    /** @param {boolean} enabled @returns {this} */
    continuePendingWork(enabled) {
        this.#base.continuePendingWork(enabled);
        return this;
    }

    /** @param {NonNullable<ResumeSessionConfig['openCanvases']>} canvases @returns {this} */
    openCanvases(canvases) {
        this.#openCanvases = canvases;
        return this;
    }

    /**
     * @param {Partial<ResumeSessionConfig> & { disableResume?: boolean }} partial
     * @returns {this}
     */
    merge(partial) {
        const normalized = sanitizeResumeSessionConfig(partial);
        const { openCanvases, suppressResumeEvent, ...resumeConfig } = normalized;
        this.#base.merge(/** @type {any} */ (resumeConfig));
        if (suppressResumeEvent !== undefined) {
            this.#suppressResumeEvent = suppressResumeEvent;
        }
        if (openCanvases !== undefined) {
            this.#openCanvases = openCanvases;
        }
        return this;
    }

    /** @returns {ResumeSessionConfig} */
    build() {
        return sanitizeResumeSessionConfig({
            ...this.#base.build(),
            ...(this.#suppressResumeEvent !== undefined
                ? { suppressResumeEvent: this.#suppressResumeEvent }
                : {}),
            ...(this.#openCanvases !== undefined ? { openCanvases: this.#openCanvases } : {}),
        });
    }

    /** @returns {ResumeSessionConfig} */
    buildForResume() {
        return this.build();
    }
}
