// @ts-check
/**
 * src/copilot/hooks/session-lifecycle.js
 *
 * Shim de compatibilidade — re-exporta de `hooks/session-hooks.js`.
 * FC-3: renomeado para evitar conflito de naming com `sdk/session-lifecycle.js`.
 *
 * @deprecated Importe diretamente de `#copilot/hooks/session-hooks`
 * @module copilot/hooks/session-lifecycle
 * @see EventBus
 */

export { createSessionHooks } from './session-hooks.js';
