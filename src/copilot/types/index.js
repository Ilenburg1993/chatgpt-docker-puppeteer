// @ts-check
/**
 * src/copilot/types/index.js
 *
 * Barrel canônico do módulo `types/` — centraliza typedefs compartilhados cross-module.
 *
 * Este módulo é **L0** (sem dependências internas além de `core/`). Qualquer módulo do sistema pode importar tipos
 * daqui sem violar a hierarquia de camadas.
 *
 * Consumers: `import('#copilot/types')` ou `import('#copilot/types/events')`.
 *
 * @module copilot/types
 */

// ─── DI Tokens — importados dos módulos de origem (Faixa 3.4, D2-12) ─────────
export { AUDIT_BUS, AUDIT_LOGGER } from '#copilot/audit';
export { BRIDGE_AGENT, FALLBACK_AGENT, NERV_BRIDGE_AGENT, PERMISSION_AGENT } from '#copilot/bridges';
export { HUB, SESSION_RPC } from '#copilot/conversation-hub';
export { DB_LOGGER, EVENT_BUS, SHUTDOWN_LOGGER } from '#copilot/core';
export { SDK_LOGGER, TOOLS_BUILDER } from '#copilot/sdk';

// ─── DI Container utilities ──────────────────────────────────────────────────
export { container } from '../core/di-container.js';
export { createContainer, createToken } from '../core/di.js';

// ─── Event Bus ───────────────────────────────────────────────────────────────
export { EventBus, createEventBus } from '../core/event-bus.js';

// ─── Event schemas ───────────────────────────────────────────────────────────
export { EVENT_NAMES, EVENT_NAMESPACES } from '../events/legacy-events.js';
