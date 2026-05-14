// @ts-check
/**
 * src/copilot/sdk/agent/index.js — Barrel de `sdk/agent/`
 *
 * Ponto de entrada único para módulos de agente do SDK. Consumidores externos DEVEM importar via `#copilot/sdk/agents`,
 * nunca via caminhos relativos profundos (`../../sdk/agent/agents.js`).
 *
 * @module copilot/sdk/agent
 */

export {
    READ_ONLY_TOOLS,
    buildAgentList,
    createAgent,
    createAnalystAgent,
    createFullAccessAgent,
    createReadOnlyAgent,
    deselectAgent,
    filterInferableAgents,
    getCurrentAgent,
    isValidAgentName,
    listAgents,
    reloadAgents,
    selectAgent,
} from './agents.js';
