// @ts-check
/**
 * src/copilot/types/index.js
 *
 * Barrel canônico do módulo `types/` — centraliza typedefs compartilhados cross-module.
 *
 * Este módulo é **L0** (sem dependências internas além de `core/`). Qualquer módulo do sistema pode
 * importar tipos daqui sem violar a hierarquia de camadas.
 *
 * Consumers: `import('#copilot/types')` ou `import('#copilot/types/events')`.
 *
 * @module copilot/types
 */

// ─── DI Tokens (re-export canônico de core/di-tokens) ────────────────────────
export {
    SHUTDOWN_LOGGER,
    DB_LOGGER,
    SDK_LOGGER,
    TOOLS_BUILDER,
    AUDIT_LOGGER,
    AUDIT_BUS,
    BRIDGE_AGENT,
    FALLBACK_AGENT,
    HUB,
    PERMISSION_AGENT,
    SESSION_RPC,
    NERV_BRIDGE_AGENT,
} from '../core/di-tokens.js';

// ─── DI Container utilities ──────────────────────────────────────────────────
export { createContainer, createToken } from '../core/di.js';
export { container } from '../core/di-container.js';

// ─── Event schemas ───────────────────────────────────────────────────────────
export {
    EVENT_NAMES,
    EVENT_NAMESPACES,
} from './events.js';
