// @ts-check
/**
 * src/copilot/server/middleware/rate-limiter-state.js
 *
 * Re-export do módulo de bridge para reset de rate limiters.
 *
 * Onda 3.5 — L59.2: este proxy permite que middleware de `server/` registre e invoque o reset de rate limiters sem
 * acoplamento direto a `terminal/`. Na Onda 3.9, a implementação real será movida aqui.
 *
 * @module copilot/server/middleware/rate-limiter-state
 */

export { clearRateLimiters, registerClearRateLimiters } from '../../presentation/realtime.js';
