// @ts-check
/**
 * src/copilot/sdk/session-lifecycle.js
 *
 * Shim de compatibilidade — re-exporta de `sdk/sdk-session-wrapper.js`.
 * FC-3: renomeado para evitar conflito de naming com `hooks/session-lifecycle.js`.
 *
 * @deprecated Importe diretamente de `#copilot/sdk/sdk-session-wrapper`
 * @module copilot/sdk/session-lifecycle
 * @see EventBus
 */

export { abortSession, setSessionModel, getSessionMessages, getSessionWorkspacePath, disposeSession, runSessionLifecycle } from './sdk-session-wrapper.js';
