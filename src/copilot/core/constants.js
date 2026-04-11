// @ts-check
/**
 * src/copilot/core/constants.js
 *
 * Constantes puras da camada core. Este módulo NÃO deve importar de camadas superiores (config, hooks etc.). Constantes
 * derivadas de variáveis de ambiente pertencem a `config/env.js` — consumidores que precisem delas devem importar de
 * `#copilot/config` ou `#copilot/config/env`.
 *
 * @module copilot/core/constants
 */

export { AGENT_EVENTS, DIALOG_LOOP_EVENTS, PR_CONSUMING_EVENTS } from './events.js';
/** @typedef {import('./events.js').AgentEventName} AgentEventName */
