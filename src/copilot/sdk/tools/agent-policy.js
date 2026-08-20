// @ts-check
/**
 * src/copilot/sdk/tools/agent-policy.js
 *
 * Política de ferramentas sensível ao agente para agentes customizados SDK.
 *
 * A carga útil dos hooks do SDK nem sempre identifica o agente customizado ativo. Quando identifica, esta política
 * aplica a lista de permissão por agente derivada de `customAgents[].tools`. Quando não identifica, ela ainda aplica
 * listas globais de permissão/negação e deixa a filtragem local do agente para a própria declaração de ferramentas do
 * SDK. O SDK mantém a policy genérica e recebe normalizadores de nomes por injeção. Aliases de produto vivem em
 * `#copilot/config`, não nesta camada.
 *
 * @module copilot/sdk/tools/agent-policy
 */

/**
 * @typedef {object} AgentToolPolicyDecision
 * @property {boolean} allowed
 * @property {string} reason
 * @property {string | null} canonicalTool
 * @property {string | null} agentName
 */

/**
 * @typedef {object} PolicyAgent
 * @property {string} name
 * @property {string[] | null | undefined} [tools]
 *
 * @typedef {(toolName: string) => string | null} ResolveToolNameFn
 *
 * @typedef {(toolNames: string[]) => { canonical: string[] }} NormalizeAgentToolListFn
 */

/** @type {ResolveToolNameFn} */
function defaultResolveToolName(toolName) {
    return typeof toolName === 'string' && toolName.length > 0 ? toolName : null;
}

/** @type {NormalizeAgentToolListFn} */
function defaultNormalizeAgentToolList(toolNames) {
    return { canonical: normalizeKnownTools(toolNames, defaultResolveToolName) };
}

export class AgentToolPolicy {
    /** @type {ResolveToolNameFn} */
    #resolveToolName;

    /** @type {NormalizeAgentToolListFn} */
    #normalizeAgentToolList;

    /**
     * @param {PolicyAgent[]} customAgents
     * @param {{ denylist?: string[]; allowlist?: string[] | null }} globalToolsConfig
     * @param {Iterable<string>} [availableTools]
     * @param {{
     *     resolveToolName?: ResolveToolNameFn;
     *     normalizeAgentToolList?: NormalizeAgentToolListFn;
     * }} [normalizers]
     */
    constructor(customAgents, globalToolsConfig = {}, availableTools = [], normalizers = {}) {
        this.#resolveToolName = normalizers.resolveToolName ?? defaultResolveToolName;
        this.#normalizeAgentToolList = normalizers.normalizeAgentToolList ?? defaultNormalizeAgentToolList;

        this.globalDenylist = new Set(normalizeKnownTools(globalToolsConfig.denylist ?? [], this.#resolveToolName));
        this.globalAllowlist =
            globalToolsConfig.allowlist === null || globalToolsConfig.allowlist === undefined
                ? null
                : new Set(normalizeKnownTools(globalToolsConfig.allowlist, this.#resolveToolName));
        this.availableTools = new Set(availableTools);
        /** @type {Map<string, Set<string> | '*'>} */
        this.agentAllowlists = new Map();

        for (const agent of customAgents || []) {
            if (!agent?.name) continue;
            if (!Array.isArray(agent.tools) || agent.tools.includes('*')) {
                this.agentAllowlists.set(agent.name, '*');
                continue;
            }
            this.agentAllowlists.set(agent.name, new Set(this.#normalizeAgentToolList(agent.tools).canonical));
        }
    }

    /**
     * @param {string | null | undefined} agentName
     * @param {string} toolName
     * @returns {AgentToolPolicyDecision}
     */
    decide(agentName, toolName) {
        const canonical = this.#resolveToolName(toolName) ?? toolName;
        if (!canonical) {
            return { allowed: false, reason: 'unresolved', canonicalTool: null, agentName: agentName ?? null };
        }
        const agentAllowlist = agentName ? this.agentAllowlists.get(agentName) : null;
        if (agentName === 'agent-full' && agentAllowlist === '*') {
            return { allowed: true, reason: 'maestro-full-access', canonicalTool: canonical, agentName };
        }
        if (this.globalDenylist.has(canonical)) {
            return {
                allowed: false,
                reason: 'global-denylist',
                canonicalTool: canonical,
                agentName: agentName ?? null,
            };
        }
        if (this.globalAllowlist !== null && !this.globalAllowlist.has(canonical)) {
            return {
                allowed: false,
                reason: 'global-allowlist',
                canonicalTool: canonical,
                agentName: agentName ?? null,
            };
        }
        if (!agentName) {
            return { allowed: true, reason: 'no-agent-context', canonicalTool: canonical, agentName: null };
        }

        if (!agentAllowlist) {
            return { allowed: false, reason: 'unknown-agent', canonicalTool: canonical, agentName };
        }
        if (agentAllowlist === '*') {
            return { allowed: true, reason: 'agent-wildcard', canonicalTool: canonical, agentName };
        }
        const allowed = agentAllowlist.has(canonical);
        return {
            allowed,
            reason: allowed ? 'agent-allowlist' : 'not-in-agent-allowlist',
            canonicalTool: canonical,
            agentName,
        };
    }

    /**
     * @param {string | null | undefined} agentName
     * @param {string} toolName
     * @returns {boolean}
     */
    isToolAllowedForAgent(agentName, toolName) {
        return this.decide(agentName, toolName).allowed;
    }

    /**
     * @param {string} agentName
     * @returns {string[]}
     */
    getAllowedToolsForAgent(agentName) {
        const allowlist = this.agentAllowlists.get(agentName);
        if (!allowlist) return [];
        const tools = allowlist === '*' ? Array.from(this.availableTools) : Array.from(allowlist);
        if (agentName === 'agent-full' && allowlist === '*') {
            return tools.sort();
        }
        return tools
            .filter((tool) => !this.globalDenylist.has(tool))
            .filter((tool) => this.globalAllowlist === null || this.globalAllowlist.has(tool))
            .sort();
    }
}

/**
 * @param {string[]} tools
 * @param {ResolveToolNameFn} resolveToolName
 * @returns {string[]}
 */
function normalizeKnownTools(tools, resolveToolName) {
    return tools.map((tool) => resolveToolName(tool) ?? tool).filter(Boolean);
}
