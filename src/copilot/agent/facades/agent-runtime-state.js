// @ts-check
/**
 * @module copilot/agent/facades/agent-runtime-state
 * @file Façade semântica para fallback de estado persistido do runtime vivo.
 */

import { persistStateWithPolicy, readState, readStateAsync } from '../lifecycle/state-io.js';
import {
    markAgentRuntimeDialogPausedForRecovery as markAgentRuntimeDialogPausedForRecoveryImpl,
    persistAgentRuntimeDialogState as persistAgentRuntimeDialogStateImpl,
    persistAgentRuntimePendingTurnState as persistAgentRuntimePendingTurnStateImpl,
    readAgentRuntimeDialogBootstrapState as readAgentRuntimeDialogBootstrapStateImpl,
    readAgentRuntimeDialogPersistedState as readAgentRuntimeDialogPersistedStateImpl,
    shouldScheduleAgentRuntimeDialogBootRecovery as shouldScheduleAgentRuntimeDialogBootRecoveryImpl,
} from '../runtime/dialog-runtime-state.js';
import {
    clearAgentRuntimePendingQuestionShadow as clearAgentRuntimePendingQuestionShadowImpl,
    persistAgentRuntimePendingQuestionState as persistAgentRuntimePendingQuestionStateImpl,
    shouldReapAgentRuntimePendingQuestionShadow as shouldReapAgentRuntimePendingQuestionShadowImpl,
} from '../runtime/pending-question-state.js';
import {
    readAgentRuntimeSessionId as readAgentRuntimeSessionIdImpl,
    restoreAgentRuntimePersistentBootState as restoreAgentRuntimePersistentBootStateImpl,
} from '../runtime/session-bootstrap-state.js';
import {
    persistAgentRuntimeGracefulShutdownState as persistAgentRuntimeGracefulShutdownStateImpl,
    persistAgentRuntimePrConsumptionSnapshot as persistAgentRuntimePrConsumptionSnapshotImpl,
    resetAgentRuntimeGracefulShutdownFlag as resetAgentRuntimeGracefulShutdownFlagImpl,
    saveAgentRuntimeShutdownSnapshot as saveAgentRuntimeShutdownSnapshotImpl,
} from '../runtime/shutdown-snapshot-state.js';

/**
 * Lê o snapshot persistido bruto do runtime de forma síncrona (cache-first).
 *
 * Uso recomendado: pontos de domínio que precisam apenas de leitura e não devem importar `lifecycle/state-io.js`
 * diretamente.
 *
 * @returns {import('../lifecycle/state-io.js').AliveAgentState | null}
 */
export function readAgentRuntimePersistedStateSync() {
    return readState();
}

/**
 * Lê o snapshot persistido bruto do runtime de forma assíncrona.
 *
 * @returns {Promise<import('../lifecycle/state-io.js').AliveAgentState | null>}
 */
export function readAgentRuntimePersistedStateAsync() {
    return readStateAsync();
}

/**
 * Persiste dados parciais do runtime usando a policy canônica do agent.
 *
 * Wrapper intencional para evitar imports diretos de `persistStateWithPolicy` em camadas de domínio.
 *
 * @param {Partial<import('../lifecycle/state-io.js').AliveAgentState>} data
 * @param {{ label?: string }} [options]
 * @returns {Promise<
 *     import('../error-policy.js').AgentPolicyResult<import('../lifecycle/state-io.js').AliveAgentState>
 * >}
 */
export function persistAgentRuntimeStatePartial(data, options = {}) {
    return persistStateWithPolicy(data, { label: options.label ?? 'state.persist.partial' });
}

/**
 * @typedef {{
 *     question: string;
 *     allowFreeform: boolean;
 *     askedAt: number;
 *     kind: import('../types.js').PendingQuestionKind;
 *     protocolControlled: boolean;
 *     choices?: string[];
 * }} AgentRuntimePendingQuestionSnapshot
 *
 *
 * @typedef {{
 *     getSessionSnapshot?: (() => import('#copilot/sdk/types').CopilotSession | null) | undefined;
 *     hasPendingQuestion?: (() => boolean) | undefined;
 *     hasPendingQuestionShadow: () => boolean;
 *     isPendingQuestionShadowExpired?: (() => boolean) | undefined;
 *     clearPendingQuestionShadow: () => void;
 *     setPendingQuestionShadow?: ((shadow: import('../types.js').PendingQuestionShadow) => void) | undefined;
 *     setSendCount?: ((count: number) => void) | undefined;
 *     getPendingQuestionSnapshot?: (() => AgentRuntimePendingQuestionSnapshot | null) | undefined;
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
 * Decide se a shadow persistida de `ask_user` deve ser removida no reap contínuo.
 *
 * Regra: só remove quando não existe pergunta viva, existe shadow e ela já expirou.
 *
 * @param {AgentRuntimeStateContext} ctx
 * @returns {boolean}
 */
export function shouldReapAgentRuntimePendingQuestionShadow(ctx) {
    return shouldReapAgentRuntimePendingQuestionShadowImpl(ctx);
}

/**
 * Lê o sessionId atual do runtime usando a sessão viva e, como fallback controlado, o snapshot persistido.
 *
 * Delegado para: `runtime/session-bootstrap-state.js`
 *
 * @param {AgentRuntimeStateContext} ctx
 * @returns {string | null}
 */
export function readAgentRuntimeSessionId(ctx) {
    return readAgentRuntimeSessionIdImpl(ctx);
}

/**
 * Lê o bootstrap persistido do dialog loop para inicialização síncrona do runtime.
 *
 * @returns {{ dialogPaused: boolean; prMetrics: Record<string, unknown> | null }}
 */
export function readAgentRuntimeDialogBootstrapState() {
    return readAgentRuntimeDialogBootstrapStateImpl();
}

/**
 * Lê de forma assíncrona o estado persistido mínimo do dialog loop.
 *
 * @returns {Promise<{ dialogPaused: boolean; dialogLoopActive: boolean }>}
 */
export async function readAgentRuntimeDialogPersistedState() {
    return readAgentRuntimeDialogPersistedStateImpl();
}

/**
 * Persiste fragmento parcial do estado do dialog loop usando policy canônica do agent.
 *
 * @param {Record<string, unknown>} partial
 * @param {string} label
 * @returns {Promise<
 *     import('../error-policy.js').AgentPolicyResult<import('../lifecycle/state-io.js').AliveAgentState>
 * >}
 */
export async function persistAgentRuntimeDialogState(partial, label) {
    return persistAgentRuntimeDialogStateImpl(partial, label);
}

/**
 * Persiste o marcador canônico de turno pendente do dialog loop.
 *
 * @param {{ message: string; ts: number }} input
 * @returns {Promise<
 *     import('../error-policy.js').AgentPolicyResult<import('../lifecycle/state-io.js').AliveAgentState>
 * >}
 */
export async function persistAgentRuntimePendingTurnState(input) {
    return persistAgentRuntimePendingTurnStateImpl(input);
}

/**
 * Persiste a pergunta pendente canônica produzida por `ask_user`.
 *
 * @param {{
 *     question: string;
 *     meta: import('../types.js').PendingQuestionMeta;
 *     askedAt: number;
 * }} input
 * @param {{ label?: string }} [options]
 * @returns {Promise<
 *     import('../error-policy.js').AgentPolicyResult<import('../lifecycle/state-io.js').AliveAgentState>
 * >}
 */
export async function persistAgentRuntimePendingQuestionState(input, options = {}) {
    return persistAgentRuntimePendingQuestionStateImpl(input, options);
}

/**
 * Limpa a shadow persistida de `ask_user` restaurada no runtime e agenda a persistência canônica.
 *
 * @param {AgentRuntimeStateContext} ctx
 * @param {{ label?: string; description?: string }} [options]
 * @returns {boolean}
 */
export function clearAgentRuntimePendingQuestionShadow(ctx, options = {}) {
    return clearAgentRuntimePendingQuestionShadowImpl(ctx, options);
}

/**
 * Decide se o boot do runtime deve agendar tentativa de recovery do dialog loop a partir do estado persistido.
 *
 * Regra atual: só agenda recovery quando o snapshot indica que o dialog loop estava ativo e não estava pausado.
 *
 * @returns {Promise<boolean>}
 */
export async function shouldScheduleAgentRuntimeDialogBootRecovery() {
    return shouldScheduleAgentRuntimeDialogBootRecoveryImpl();
}

/**
 * Persiste a intenção canônica de `dialogPaused=true` antes do boot recovery do dialog loop.
 *
 * @returns {Promise<
 *     import('../error-policy.js').AgentPolicyResult<import('../lifecycle/state-io.js').AliveAgentState>
 * >}
 */
export async function markAgentRuntimeDialogPausedForRecovery() {
    return markAgentRuntimeDialogPausedForRecoveryImpl();
}

/**
 * Reseta a flag persistida de shutdown gracioso no começo do boot do runtime.
 *
 * @returns {Promise<
 *     import('../error-policy.js').AgentPolicyResult<import('../lifecycle/state-io.js').AliveAgentState>
 * >}
 */
export async function resetAgentRuntimeGracefulShutdownFlag() {
    return resetAgentRuntimeGracefulShutdownFlagImpl();
}

/**
 * Persiste o último snapshot de consumo PR do runtime.
 *
 * @param {{ model?: string; cost?: number; quotaSnapshots?: Record<string, unknown>; ts: number }} info
 * @returns {Promise<
 *     import('../error-policy.js').AgentPolicyResult<import('../lifecycle/state-io.js').AliveAgentState>
 * >}
 */
export async function persistAgentRuntimePrConsumptionSnapshot(info) {
    return persistAgentRuntimePrConsumptionSnapshotImpl(info);
}

/**
 * Restaura do state persistido o contador de envios e a shadow de pergunta pendente.
 *
 * Delegado para: `runtime/session-bootstrap-state.js`
 *
 * @param {AgentRuntimeStateContext} ctx
 * @returns {Promise<AgentRuntimePersistentBootStateResult>}
 */
export async function restoreAgentRuntimePersistentBootState(ctx) {
    return restoreAgentRuntimePersistentBootStateImpl(ctx);
}

/**
 * Salva snapshot operacional do runtime antes do shutdown.
 *
 * @param {AgentRuntimeStateContext} ctx
 * @param {{
 *     sessionId?: string | null;
 *     dialogLoopActive: boolean;
 *     dialogPrMetrics?: { boots: number; resumesWithPR: number; resumesZeroPR: number; totalPR: number } | null;
 *     reason?: string;
 * }} options
 * @returns {Promise<string>}
 */
export async function saveAgentRuntimeShutdownSnapshot(ctx, options) {
    return saveAgentRuntimeShutdownSnapshotImpl(ctx, options);
}

/**
 * Persiste o state mínimo de shutdown gracioso para o próximo boot.
 *
 * @param {AgentRuntimeStateContext} ctx
 * @param {{ dialogLoopActive: boolean }} options
 * @returns {Promise<
 *     import('../error-policy.js').AgentPolicyResult<import('../lifecycle/state-io.js').AliveAgentState>
 * >}
 */
export async function persistAgentRuntimeGracefulShutdownState(ctx, options) {
    return persistAgentRuntimeGracefulShutdownStateImpl(ctx, options);
}
