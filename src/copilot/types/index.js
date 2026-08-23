// @ts-check
/**
 * src/copilot/types/index.js
 *
 * Barrel canônico do módulo `types/` — centraliza typedefs compartilhados cross-module.
 *
 * Este módulo mantém somente contratos/event names leves; runtime capabilities usam seus owners exatos.
 *
 * Consumers usam o entrypoint canônico `#copilot/types`.
 *
 * @module copilot/types
 */

// ─── Event schemas ───────────────────────────────────────────────────────────
export { EVENT_NAMES, EVENT_NAMESPACES } from '../events/base-events.js';
