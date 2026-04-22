// @ts-check
/**
 * @module copilot/agent/session/ownership
 * @file SSOT operacional do vínculo entre sessão SDK ativa e hub session conversacional.
 */

import { withAgentErrorPolicy } from '../error-policy.js';
import { log } from '../ports/observability-port.js';

/**
 * @param {string} label
 * @param {Error} error
 * @param {'retry' | 'fatal' | 'ignore'} disposition
 */
function logOwnershipPolicyError(label, error, disposition) {
    const level = disposition === 'fatal' ? 'ERROR' : 'WARN';
    log(level, `[SessionOwnership] ${label}: ${error.message}`);
}

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
 * Variante protegida por policy canônica para sincronizar ownership sem deixar falha lateral interromper o runtime.
 *
 * @param {string | null} sdkSessionId
 * @param {{
 *     getHubSessionId: () => string | null;
 *     setSharedSdkSessionId: (id: string | null) => void;
 *     conversationStore?: { updateSdkSession?: (hubSessionId: string, sdkSessionId: string) => void } | null;
 * }} deps
 * @param {{ label?: string }} [opts]
 * @returns {Promise<import('../error-policy.js').AgentPolicyResult<ReturnType<typeof syncActiveSessionOwnership>>>}
 */
export async function syncActiveSessionOwnershipWithPolicy(sdkSessionId, deps, opts = {}) {
    const label = opts.label ?? 'session.ownership.sync';
    return withAgentErrorPolicy(() => syncActiveSessionOwnership(sdkSessionId, deps), {
        label,
        phase: 'session',
        ...(sdkSessionId !== null ? { sessionId: sdkSessionId } : {}),
        onError: (error, disposition) => logOwnershipPolicyError(label, error, disposition),
    });
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

/**
 * Variante protegida por policy canônica para limpar ownership ativo sem transformar cleanup lateral em falha fatal do
 * shutdown.
 *
 * @param {{ setSharedSdkSessionId: (id: string | null) => void; getHubSessionId: () => string | null }} deps
 * @param {{ label?: string }} [opts]
 * @returns {Promise<
 *     import('../error-policy.js').AgentPolicyResult<ReturnType<typeof clearActiveSdkSessionOwnership>>
 * >}
 */
export async function clearActiveSdkSessionOwnershipWithPolicy(deps, opts = {}) {
    const label = opts.label ?? 'session.ownership.clear';
    return withAgentErrorPolicy(() => clearActiveSdkSessionOwnership(deps), {
        label,
        phase: 'session',
        onError: (error, disposition) => logOwnershipPolicyError(label, error, disposition),
    });
}
