// @ts-check
/**
 * @module copilot/agent/runtime/dialog-runtime-state
 * @file Seams de governança do estado persistido do dialog loop.
 */

import { persistStateWithPolicy, readState, readStateAsync } from '../lifecycle/state/index.js';

/**
 * Lê o bootstrap persistido do dialog loop para inicialização síncrona do runtime.
 *
 * @returns {{ dialogPaused: boolean; usageMetrics: Record<string, unknown> | null; prMetrics: Record<string, unknown> | null }}
 */
export function readAgentRuntimeDialogBootstrapState() {
    const persistedState = readState();
    const rawUsageMetrics = persistedState?.usageMetrics;
    const rawPrMetrics = persistedState?.prMetrics;
    const usageMetrics =
        rawUsageMetrics && typeof rawUsageMetrics === 'object'
            ? rawUsageMetrics
            : rawPrMetrics && typeof rawPrMetrics === 'object'
              ? rawPrMetrics
              : null;
    return {
        dialogPaused: Boolean(persistedState?.dialogPaused),
        usageMetrics,
        // Alias somente para callers antigos; novos consumers devem preferir usageMetrics.
        prMetrics: usageMetrics,
    };
}

/**
 * Lê de forma assíncrona o estado persistido mínimo do dialog loop.
 *
 * @returns {Promise<{ dialogPaused: boolean; dialogLoopActive: boolean }>}
 */
export async function readAgentRuntimeDialogPersistedState() {
    const state = await readStateAsync();
    return {
        dialogPaused: Boolean(state?.dialogPaused),
        dialogLoopActive: Boolean(state?.dialogLoopActive),
    };
}

/**
 * Persiste fragmento parcial do estado do dialog loop usando policy canônica do agent.
 *
 * @param {Record<string, unknown>} partial
 * @param {string} label
 * @returns {Promise<
 *     import('../error/index.js').AgentPolicyResult<import('../lifecycle/state/index.js').AliveAgentState>
 * >}
 */
export async function persistAgentRuntimeDialogState(partial, label) {
    return persistStateWithPolicy(partial, { label });
}

/**
 * Persiste o marcador canônico de turno pendente do dialog loop.
 *
 * @param {{ message: string; ts: number }} input
 * @returns {Promise<
 *     import('../error/index.js').AgentPolicyResult<import('../lifecycle/state/index.js').AliveAgentState>
 * >}
 */
export async function persistAgentRuntimePendingTurnState(input) {
    return persistStateWithPolicy(
        {
            pendingTurnMessage: input.message,
            pendingTurnTs: input.ts,
            pendingTurnAdditionalModelCallObserved: false,
            // Compatibilidade de leitura com snapshots antigos; não representa billing atual.
            pendingTurnConsumedPR: false,
        },
        { label: 'dialog.turn.pending' },
    );
}

/**
 * Decide se o boot do runtime deve agendar tentativa de recovery do dialog loop a partir do estado persistido.
 *
 * Regra atual: só agenda recovery quando o snapshot indica que o dialog loop estava ativo e não estava pausado.
 *
 * @returns {Promise<boolean>}
 */
export async function shouldScheduleAgentRuntimeDialogBootRecovery() {
    const savedState = await readStateAsync();
    return Boolean(savedState?.dialogLoopActive && !savedState?.dialogPaused);
}

/**
 * Persiste a intenção canônica de `dialogPaused=true` antes do boot recovery do dialog loop.
 *
 * @returns {Promise<
 *     import('../error/index.js').AgentPolicyResult<import('../lifecycle/state/index.js').AliveAgentState>
 * >}
 */
export async function markAgentRuntimeDialogPausedForRecovery() {
    return persistStateWithPolicy({ dialogPaused: true }, { label: 'dialog.boot_recovery.pause' });
}
