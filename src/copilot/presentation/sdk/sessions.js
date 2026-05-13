// @ts-check
/**
 * @module copilot/presentation/sdk-sessions
 * @file Superfície compartilhada de ownership e projections das sessões SDK.
 *
 *   Esta camada concentra a leitura e atualização do vínculo canônico entre a sessão SDK ativa e a sessão conversacional
 *   (`hubSessionId ↔ sdkSessionId`), evitando que cada rota `server/routes/sdk/*` reinvente resolução de estado ou
 *   projete metadados diferentes.
 */

import { CONVERSATION_STORE } from '#copilot/conversation-hub';
import {
    container,
    getHubSessionId,
    getSharedSdkSessionId,
    getSharedSessionBinding,
    setSharedSdkSessionId,
} from '#copilot/core';
import {
    clearSharedSdkSessionOwnership,
    readAgentStatusSnapshot,
    readAgentStatusSnapshotForRuntime,
    syncSharedSdkSessionOwnership,
} from '../runtime/index.js';

/**
 * Obtém o ConversationStore se estiver registrado no container.
 *
 * @returns {{ updateSdkSession?: (hubSessionId: string, sdkSessionId: string) => void } | null}
 */
function getConversationStoreMaybe() {
    return container.has(CONVERSATION_STORE)
        ? /** @type {{ updateSdkSession?: (hubSessionId: string, sdkSessionId: string) => void }} */ (
              container.resolve(CONVERSATION_STORE)
          )
        : null;
}

/**
 * Retorna a projeção canônica do binding cross-layer atual.
 *
 * @returns {{ hubSessionId: string | null; sdkSessionId: string | null; isBound: boolean }}
 */
export function getSdkSessionBindingProjection() {
    const binding = getSharedSessionBinding();
    return {
        ...binding,
        isBound: Boolean(binding.hubSessionId && binding.sdkSessionId),
    };
}

/**
 * Anexa metadados de ownership canônico a qualquer payload de resposta ligado a uma sessão SDK.
 *
 * @template {object} T
 * @param {T} payload
 * @param {string | null | undefined} sessionId
 * @returns {T & {
 *     sharedBinding: { hubSessionId: string | null; sdkSessionId: string | null; isBound: boolean };
 *     isSharedSdkSession: boolean;
 *     boundHubSessionId: string | null;
 * }}
 */
export function attachSdkSessionOwnership(payload, sessionId) {
    const sharedBinding = getSdkSessionBindingProjection();
    const isSharedSdkSession = Boolean(sessionId && sharedBinding.sdkSessionId === sessionId);
    return {
        ...payload,
        sharedBinding,
        isSharedSdkSession,
        boundHubSessionId: isSharedSdkSession ? sharedBinding.hubSessionId : null,
    };
}

/**
 * Sincroniza a sessão SDK ativa via SSOT compartilhada e persiste o vínculo no store conversacional quando houver hub
 * ativo.
 *
 * @param {string | null} sdkSessionId
 * @returns {{ hubSessionId: string | null; sdkSessionId: string | null; persistedToStore: boolean }}
 */
export function rememberSdkSessionOwnership(sdkSessionId) {
    return syncSharedSdkSessionOwnership(sdkSessionId, {
        getHubSessionId,
        setSharedSdkSessionId,
        conversationStore: getConversationStoreMaybe(),
    });
}

/**
 * Limpa o binding da sessão SDK ativa somente se o `sessionId` informado ainda for o corrente.
 *
 * @param {string} sessionId
 * @returns {{ hubSessionId: string | null; sdkSessionId: string | null; isBound?: boolean }}
 */
export function forgetSdkSessionOwnership(sessionId) {
    if (getSharedSdkSessionId() !== sessionId) {
        return getSdkSessionBindingProjection();
    }
    const cleared = clearSharedSdkSessionOwnership({ getHubSessionId, setSharedSdkSessionId });
    return {
        ...cleared,
        isBound: Boolean(cleared.hubSessionId && cleared.sdkSessionId),
    };
}

/**
 * Resolve a visão canônica da sessão SDK atual para as rotas HTTP.
 *
 * `canonicalSessionId` prioriza a SSOT compartilhada; na ausência dela, cai para foreground e, por fim, para
 * lastSessionId.
 *
 * @param {{
 *     getForegroundSessionId: () => Promise<string | null | undefined>;
 *     getLastSessionId: () => Promise<string | null | undefined>;
 * }} client
 * @returns {Promise<{
 *     foregroundSessionId: string | null;
 *     lastSessionId: string | null;
 *     canonicalSessionId: string | null;
 *     sharedBinding: { hubSessionId: string | null; sdkSessionId: string | null; isBound: boolean };
 * }>}
 */
export async function resolveSdkSessionRouteMeta(client) {
    const [foregroundSessionId, lastSessionId] = await Promise.all([
        client.getForegroundSessionId(),
        client.getLastSessionId(),
    ]);
    const sharedBinding = getSdkSessionBindingProjection();
    return {
        foregroundSessionId: foregroundSessionId ?? null,
        lastSessionId: lastSessionId ?? null,
        canonicalSessionId: sharedBinding.sdkSessionId ?? foregroundSessionId ?? lastSessionId ?? null,
        sharedBinding,
    };
}

/**
 * Resolve a projeção canônica de runtime/ownership da sessão SDK para bordas de inspeção.
 *
 * @param {{
 *     sessionId?: string | null;
 * }} agent
 * @param {{
 *     getForegroundSessionId?: () => Promise<string | null | undefined>;
 *     getLastSessionId?: () => Promise<string | null | undefined>;
 * } | null} client
 * @param {string | null} connectionState
 * @returns {Promise<{
 *     connectionState: string | null;
 *     runtimeSessionId: string | null;
 *     foregroundSessionId: string | null;
 *     lastSessionId: string | null;
 *     canonicalSessionId: string | null;
 *     sharedBinding: { hubSessionId: string | null; sdkSessionId: string | null; isBound: boolean };
 *     runtimeMatchesShared: boolean;
 * }>}
 */
export async function resolveSdkRuntimeProjection(agent, client, connectionState) {
    const sharedBinding = getSdkSessionBindingProjection();
    const runtimeStatus =
        typeof (/** @type {{ getStatusSnapshot?: unknown }} */ (agent).getStatusSnapshot) === 'function'
            ? readAgentStatusSnapshot(/** @type {import('../../agent/types.js').IAlwaysAliveAgent} */ (agent))
            : /** @type {Record<string, unknown>} */ (agent);
    const runtimeSessionId = typeof runtimeStatus['sessionId'] === 'string' ? runtimeStatus['sessionId'] : null;
    let foregroundSessionId = null;
    let lastSessionId = null;

    if (client?.getForegroundSessionId && client?.getLastSessionId) {
        const meta = await resolveSdkSessionRouteMeta({
            getForegroundSessionId: client.getForegroundSessionId.bind(client),
            getLastSessionId: client.getLastSessionId.bind(client),
        });
        foregroundSessionId = meta.foregroundSessionId;
        lastSessionId = meta.lastSessionId;
    }

    return {
        connectionState,
        runtimeSessionId,
        foregroundSessionId,
        lastSessionId,
        canonicalSessionId:
            sharedBinding.sdkSessionId ?? runtimeSessionId ?? foregroundSessionId ?? lastSessionId ?? null,
        sharedBinding,
        runtimeMatchesShared: Boolean(runtimeSessionId && runtimeSessionId === sharedBinding.sdkSessionId),
    };
}

/**
 * Resolve a projeção canônica de runtime/ownership da sessão SDK a partir de `runtimeId`, sem exigir que a rota HTTP
 * receba a instância viva do agent.
 *
 * @param {string | null | undefined} runtimeId
 * @param {{
 *     getForegroundSessionId?: () => Promise<string | null | undefined>;
 *     getLastSessionId?: () => Promise<string | null | undefined>;
 * } | null} client
 * @param {string | null} connectionState
 * @returns {Promise<{
 *     connectionState: string | null;
 *     runtimeSessionId: string | null;
 *     foregroundSessionId: string | null;
 *     lastSessionId: string | null;
 *     canonicalSessionId: string | null;
 *     sharedBinding: { hubSessionId: string | null; sdkSessionId: string | null; isBound: boolean };
 *     runtimeMatchesShared: boolean;
 *     runtimeId: string;
 *     requestedRuntimeId: string | null;
 *     runtimeFound: boolean;
 *     usedDefaultRuntimeFallback: boolean;
 * }>}
 */
export async function resolveSdkRuntimeProjectionForRuntime(runtimeId, client, connectionState) {
    const sharedBinding = getSdkSessionBindingProjection();
    const runtimeStatus = readAgentStatusSnapshotForRuntime(runtimeId);
    const runtimeSessionId = typeof runtimeStatus['sessionId'] === 'string' ? runtimeStatus['sessionId'] : null;
    let foregroundSessionId = null;
    let lastSessionId = null;

    if (client?.getForegroundSessionId && client?.getLastSessionId) {
        const meta = await resolveSdkSessionRouteMeta({
            getForegroundSessionId: client.getForegroundSessionId.bind(client),
            getLastSessionId: client.getLastSessionId.bind(client),
        });
        foregroundSessionId = meta.foregroundSessionId;
        lastSessionId = meta.lastSessionId;
    }

    return {
        connectionState,
        runtimeSessionId,
        foregroundSessionId,
        lastSessionId,
        canonicalSessionId:
            sharedBinding.sdkSessionId ?? runtimeSessionId ?? foregroundSessionId ?? lastSessionId ?? null,
        sharedBinding,
        runtimeMatchesShared: Boolean(runtimeSessionId && runtimeSessionId === sharedBinding.sdkSessionId),
        runtimeId: runtimeStatus.runtimeId,
        requestedRuntimeId: runtimeStatus.requestedRuntimeId,
        runtimeFound: runtimeStatus.runtimeFound,
        usedDefaultRuntimeFallback: runtimeStatus.usedDefaultRuntimeFallback,
    };
}

/**
 * Limpa o binding compartilhado da sessão SDK ativa preservando a hub session atual.
 *
 * @returns {{ hubSessionId: string | null; sdkSessionId: string | null; isBound: boolean }}
 */
export function clearSdkRuntimeBinding() {
    const cleared = clearSharedSdkSessionOwnership({ getHubSessionId, setSharedSdkSessionId });
    return {
        ...cleared,
        isBound: Boolean(cleared.hubSessionId && cleared.sdkSessionId),
    };
}
