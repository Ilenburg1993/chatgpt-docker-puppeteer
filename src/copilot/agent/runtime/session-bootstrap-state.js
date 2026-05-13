// @ts-check
/**
 * @module copilot/agent/runtime/session-bootstrap-state
 * @file Seam de leitura de bootstrap de sessão e fallback de sessionId.
 *
 *   Responsabilidade: gerenciar lógica síncrona e assíncrona de sessão durante boot, incluindo fallback controlado (ativa
 *   → persistida) e restauração de state persistido.
 */

import { logSwallowed } from '#copilot/core';
import { createPendingQuestionShadow, isPendingQuestionShadowExpired } from '../dialog/state/index.js';
import { persistStateWithPolicy, readState, readStateAsync } from '../lifecycle/state/index.js';

/**
 * @typedef {{
 *     getSessionSnapshot?: (() => import('#copilot/sdk/types').CopilotSession | null) | undefined;
 *     hasPendingQuestion?: (() => boolean) | undefined;
 *     hasPendingQuestionShadow: () => boolean;
 *     isPendingQuestionShadowExpired?: (() => boolean) | undefined;
 *     clearPendingQuestionShadow: () => void;
 *     setPendingQuestionShadow?: ((shadow: import('../types.js').PendingQuestionShadow) => void) | undefined;
 *     setSendCount?: ((count: number) => void) | undefined;
 *     setLastPrInfo?:
 *         | ((
 *               info: {
 *                   model?: string;
 *                   configuredModel?: string;
 *                   effectiveModel?: string;
 *                   modelMismatch?: boolean;
 *                   sessionId?: string | null;
 *                   cost?: number;
 *                   quotaSnapshots?: Record<string, unknown>;
 *                   ts: number;
 *               } | null,
 *           ) => void)
 *         | undefined;
 *     getPendingQuestionSnapshot?:
 *         | (() => import('../facades/agent-runtime-state.js').AgentRuntimePendingQuestionSnapshot | null)
 *         | undefined;
 *     getModelSnapshot?: (() => string) | undefined;
 *     getRuntimeStatus?: (() => string) | undefined;
 *     getSendCountSnapshot?: (() => number) | undefined;
 *     isDialogLoopPaused?: (() => boolean) | undefined;
 *     trackBackgroundTask?:
 *         | ((task: Promise<unknown>, meta?: { label?: string; description?: string }) => Promise<void>)
 *         | undefined;
 * }} AgentRuntimeStateContext
 *
 *
 * @typedef {{
 *     sendCount: number;
 *     pendingQuestionShadowRestored: boolean;
 *     pendingQuestionShadowExpired: boolean;
 * }} AgentRuntimePersistentBootStateResult
 */

/**
 * Lê o sessionId atual do runtime usando a sessão viva e, como fallback controlado, o snapshot persistido.
 *
 * Ordem de preferência:
 *
 * 1. sessionId ativo da SDK (se disponível e válido)
 * 2. fallback: sessionId persistido (se disponível e válido)
 * 3. null
 *
 * @param {AgentRuntimeStateContext} ctx
 * @returns {string | null}
 */
export function readAgentRuntimeSessionId(ctx) {
    const activeSessionId = ctx.getSessionSnapshot?.()?.sessionId ?? null;
    if (typeof activeSessionId === 'string' && activeSessionId.length > 0) {
        return activeSessionId;
    }

    const persistedSessionId = readState()?.sessionId ?? null;
    return typeof persistedSessionId === 'string' && persistedSessionId.length > 0 ? persistedSessionId : null;
}

/**
 * Restaura do state persistido o contador de envios e a shadow de pergunta pendente.
 *
 * Procedimento:
 *
 * 1. Lê state persistido assincramente
 * 2. Restaura sendCount no contexto
 * 3. Valida se há pergunta pendente persistida
 * 4. Se houver, reconstrói shadow e valida expiração
 * 5. Se expirada, agenda limpeza assíncrona em background
 * 6. Retorna snapshot do resultado
 *
 * @param {AgentRuntimeStateContext} ctx
 * @returns {Promise<AgentRuntimePersistentBootStateResult>}
 */
export async function restoreAgentRuntimePersistentBootState(ctx) {
    const persistedState = await readStateAsync();
    const sendCount = persistedState?.sendCount ?? 0;
    ctx.setSendCount?.(sendCount);

    if (typeof persistedState?.lastPrConsumedAt === 'number') {
        ctx.setLastPrInfo?.({
            ts: persistedState.lastPrConsumedAt,
            ...(persistedState.lastPrModel ? { model: persistedState.lastPrModel } : {}),
            ...(persistedState.lastPrConfiguredModel ? { configuredModel: persistedState.lastPrConfiguredModel } : {}),
            ...(persistedState.lastPrEffectiveModel ? { effectiveModel: persistedState.lastPrEffectiveModel } : {}),
            ...(typeof persistedState.lastPrModelMismatch === 'boolean'
                ? { modelMismatch: persistedState.lastPrModelMismatch }
                : {}),
            ...(typeof persistedState.sessionId === 'string' ? { sessionId: persistedState.sessionId } : {}),
            ...(typeof persistedState.lastPrCost === 'number' ? { cost: persistedState.lastPrCost } : {}),
            ...(persistedState.lastQuotaSnapshots ? { quotaSnapshots: persistedState.lastQuotaSnapshots } : {}),
        });
    }

    if (!persistedState?.pendingQuestion || !persistedState.pendingQuestionMeta) {
        ctx.clearPendingQuestionShadow();
        return {
            sendCount,
            pendingQuestionShadowRestored: false,
            pendingQuestionShadowExpired: false,
        };
    }

    const pendingQuestionShadow = createPendingQuestionShadow(
        persistedState.pendingQuestion,
        persistedState.pendingQuestionMeta,
    );
    ctx.setPendingQuestionShadow?.(pendingQuestionShadow);

    const expired = isPendingQuestionShadowExpired(pendingQuestionShadow);
    if (expired) {
        const persistTask = persistStateWithPolicy(
            { pendingQuestion: null, pendingQuestionMeta: null },
            { label: 'state.pendingQuestionShadow.expire' },
        ).then(() => undefined);
        if (typeof ctx.trackBackgroundTask === 'function') {
            void ctx.trackBackgroundTask(persistTask, {
                label: 'state.pendingQuestionShadow.expire',
                description: 'Clear expired ask_user shadow from persisted state',
            });
        } else {
            void persistTask.catch((error) => logSwallowed(error, 'agent.runtimeState.pendingQuestionShadow.expire'));
        }
    }

    return {
        sendCount,
        pendingQuestionShadowRestored: true,
        pendingQuestionShadowExpired: expired,
    };
}
