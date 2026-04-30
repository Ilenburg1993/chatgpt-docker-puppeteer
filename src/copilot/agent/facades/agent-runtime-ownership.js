// @ts-check
/**
 * @module copilot/agent/facades/agent-runtime-ownership
 * @file Facade canônica do vínculo entre sessão SDK ativa e hub session.
 *
 *   Esta camada concentra as operações de ownership do runtime para que bordas compartilhadas não importem helpers
 *   diretamente do subsistema `session/state/ownership.js` através do barrel bruto do agent.
 */

import { clearActiveSdkSessionOwnership, syncActiveSessionOwnership } from '../session/state/ownership.js';

/**
 * @param {string | null} sdkSessionId
 * @param {{
 *     getHubSessionId: () => string | null;
 *     setSharedSdkSessionId: (id: string | null) => void;
 *     conversationStore?: { updateSdkSession?: (hubSessionId: string, sdkSessionId: string) => void } | null;
 * }} deps
 * @returns {{ hubSessionId: string | null; sdkSessionId: string | null; persistedToStore: boolean }}
 */
export function syncRuntimeSdkSessionOwnership(sdkSessionId, deps) {
    return syncActiveSessionOwnership(sdkSessionId, deps);
}

/**
 * @param {{ setSharedSdkSessionId: (id: string | null) => void; getHubSessionId: () => string | null }} deps
 * @returns {{ hubSessionId: string | null; sdkSessionId: null }}
 */
export function clearRuntimeSdkSessionOwnership(deps) {
    return clearActiveSdkSessionOwnership(deps);
}
