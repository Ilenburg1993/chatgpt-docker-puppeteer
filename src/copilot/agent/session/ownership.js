// @ts-check
/**
 * @module copilot/agent/session/ownership
 * @file SSOT operacional do vínculo entre sessão SDK ativa e hub session conversacional.
 */

/**
 * Sincroniza o sessionId SDK ativo com o estado compartilhado e, quando houver hub ativo, persiste o vínculo no
 * `ConversationStore`.
 *
 * @param {string | null} sdkSessionId
 * @param {{
 *     getHubSessionId: () => string | null;
 *     setSharedSdkSessionId: (id: string | null) => void;
 *     conversationStore?: { updateSdkSession?: (hubSessionId: string, sdkSessionId: string) => void } | null;
 * }} deps
 * @returns {{ hubSessionId: string | null; sdkSessionId: string | null; persistedToStore: boolean }}
 */
export function syncActiveSessionOwnership(sdkSessionId, deps) {
    deps.setSharedSdkSessionId(sdkSessionId);
    const hubSessionId = deps.getHubSessionId();

    let persistedToStore = false;
    if (hubSessionId && sdkSessionId && deps.conversationStore?.updateSdkSession) {
        deps.conversationStore.updateSdkSession(hubSessionId, sdkSessionId);
        persistedToStore = true;
    }

    return { hubSessionId, sdkSessionId, persistedToStore };
}

/**
 * Limpa apenas o vínculo de sessão SDK ativa, preservando o hub conversacional corrente.
 *
 * @param {{ setSharedSdkSessionId: (id: string | null) => void; getHubSessionId: () => string | null }} deps
 * @returns {{ hubSessionId: string | null; sdkSessionId: null }}
 */
export function clearActiveSdkSessionOwnership(deps) {
    deps.setSharedSdkSessionId(null);
    return {
        hubSessionId: deps.getHubSessionId(),
        sdkSessionId: null,
    };
}
