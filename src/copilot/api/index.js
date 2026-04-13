// @ts-check
/**
 * src/copilot/api/index.js
 *
 * Barrel exports do módulo de API HTTP.
 *
 * @module copilot/api
 * @deprecated Onda 4.5 — Todos os exports deste barrel possuem equivalentes canônicos em `server/`:
 *
 *   - `createSdkApiRouter` → `server/routes/sdk/index.js` (createSdkRouter, Onda 4.3)
 *   - `httpBridge` → `server/routes/copilot-api/index.js` (createCopilotApiRouter, Onda 4.2 → 4.8)
 *   - utilitários SSE → `server/sse/index.js` (canônico desde Onda 3.6) Remover na Onda 5.0.
 *
 * @see EventBus
 */

// Express routers (SDK API) — @deprecated use server/routes/sdk/index.js
export { default as createSdkApiRouter } from './express/index.js';
