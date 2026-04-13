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

// ─── DI Tokens (re-export canônico de core/di-tokens) ────────────────────────
export {
    AUDIT_BUS,
    AUDIT_LOGGER,
    BRIDGE_AGENT,
    DB_LOGGER,
    EVENT_BUS,
    FALLBACK_AGENT,
    HUB,
    NERV_BRIDGE_AGENT,
    PERMISSION_AGENT,
    SDK_LOGGER,
    SESSION_RPC,
    SHUTDOWN_LOGGER,
    TOOLS_BUILDER,
} from '../core/di-tokens.js';

// ─── DI Container utilities ──────────────────────────────────────────────────
export { container } from '../core/di-container.js';
export { createContainer, createToken } from '../core/di.js';

// ─── Event Bus ───────────────────────────────────────────────────────────────
export { EventBus, createEventBus } from '../core/event-bus.js';

// ─── Event schemas ───────────────────────────────────────────────────────────
export { EVENT_NAMES, EVENT_NAMESPACES } from '../events/legacy-events.js';
