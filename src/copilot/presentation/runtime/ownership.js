// @ts-check
/**
 * @module copilot/presentation/runtime-ownership
 * @file Façade compartilhada do vínculo canônico entre sessão SDK ativa e hub session.
 *
 *   Esta camada concentra o bridge de ownership exposto por `agent/session/state/ownership.js` para que `presentation/` e
 *   as bordas não importem helpers de ownership diretamente de `#copilot/agent` em vários pontos.
 */

import { clearRuntimeSdkSessionOwnership, syncRuntimeSdkSessionOwnership } from '#copilot/agent/facades';

/**
 * @param {string | null} sdkSessionId
 * @param {{
 *     sessionBinding: { snapshot:()=>{hubSessionId:string|null;sdkSessionId:string|null}; setSdkSessionId:(id:string|null)=>unknown; clearSdkSessionId:()=>unknown };
 *     conversationStore?: { updateSdkSession?: (hubSessionId: string, sdkSessionId: string) => void } | null;
 * }} deps
 * @returns {{ hubSessionId: string | null; sdkSessionId: string | null; persistedToStore: boolean }}
 */
export function syncSharedSdkSessionOwnership(sdkSessionId, deps) {
    return syncRuntimeSdkSessionOwnership(sdkSessionId, deps);
}

/**
 * @param {{ sessionBinding:{snapshot:()=>{hubSessionId:string|null;sdkSessionId:string|null};clearSdkSessionId:()=>unknown} }} deps
 * @returns {{ hubSessionId: string | null; sdkSessionId: null }}
 */
export function clearSharedSdkSessionOwnership(deps) {
    return clearRuntimeSdkSessionOwnership(deps);
}
