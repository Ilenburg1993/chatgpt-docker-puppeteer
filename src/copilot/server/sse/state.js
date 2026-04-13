// @ts-check
/**
 * src/copilot/server/sse/state.js
 *
 * Re-export dos símbolos SSE de `terminal/state.js` para o módulo `server/sse/`.
 *
 * Onda 3.5 — L59.1: este proxy permite que routers de `server/routes/` importem estado SSE
 * sem acoplamento direto a `terminal/`. Na Onda 3.9, os dados reais serão movidos aqui.
 *
 * @module copilot/server/sse/state
 */

export {
    getSseClients,
    getSseCriticalClients,
    getTerminalReplayBuffer
} from '../../terminal/state.js';
