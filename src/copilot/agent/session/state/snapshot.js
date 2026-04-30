// @ts-check
/**
 * src/copilot/agent/session/state/snapshot.js
 *
 * F41 — Session Snapshot & Restore.
 *
 * Serializa e restaura o estado completo de uma sessão do agente, incluindo contexto do dialog loop, métricas, modelo
 * ativo, fila pendente e configuração de permissões.
 *
 * @module copilot/agent/session/snapshot
 * @see EventBus
 */

import { readState } from '../../lifecycle/state/state-io.js';
import {
    listSnapshotFilesAsync,
    loadLatestSnapshotFileAsync,
    loadSnapshotFileAsync,
    normalizeSnapshotRecord,
    pruneSnapshotFilesAsync,
    saveSnapshotFileAsync,
} from './snapshot-store.js';

/**
 * @typedef {Object} SessionSnapshotData
 * @property {string} snapshotId - Identificador único do snapshot
 * @property {number} createdAt - Timestamp de criação (ms)
 * @property {string | null} sessionId - ID da sessão SDK
 * @property {string} model - Modelo ativo
 * @property {string} status - Status do agente no momento do snapshot
 * @property {number} sendCount - Total de mensagens enviadas
 * @property {boolean} dialogLoopActive - Se o dialog loop estava ativo
 * @property {boolean} dialogPaused - Se o dialog loop estava pausado
 * @property {string | null} pendingQuestion - Pergunta pendente (se houver)
 * @property {import('../../types.js').PendingQuestionMeta | null} [pendingQuestionMeta] - Metadados semânticos da
 *   pergunta pendente
 * @property {import('../../types.js').PendingQuestionShadow | null} [pendingQuestionShadow] - Shadow persistida do
 *   `ask_user`, quando houver
 * @property {Record<string, unknown> | null} stateSnapshot - Estado completo do state-io
 * @property {{ boots: number; resumesWithPR: number; resumesZeroPR: number; totalPR: number } | null} prMetrics
 * @property {string} [reason] - Motivo do snapshot (manual, auto-save, handoff)
 */

/**
 * Cria um snapshot do estado atual do agente.
 *
 * @param {{
 *     sessionId: string | null;
 *     model: string;
 *     status: string;
 *     sendCount: number;
 *     dialogLoopActive: boolean;
 *     dialogPaused: boolean;
 *     pendingQuestion: string | null;
 *     pendingQuestionMeta?: import('../../types.js').PendingQuestionMeta | null;
 *     pendingQuestionShadow?: import('../../types.js').PendingQuestionShadow | null;
 *     prMetrics?: { boots: number; resumesWithPR: number; resumesZeroPR: number; totalPR: number } | null;
 *     reason?: string;
 * }} opts
 * @returns {SessionSnapshotData}
 */
export function createSnapshot(opts) {
    const snapshotId = `snap-${Date.now()}-${globalThis.crypto.randomUUID().slice(-8)}`;
    const state = readState();

    /** @type {SessionSnapshotData} */
    const snapshot = {
        snapshotId,
        createdAt: Date.now(),
        sessionId: opts.sessionId,
        model: opts.model,
        status: opts.status,
        sendCount: opts.sendCount,
        dialogLoopActive: opts.dialogLoopActive,
        dialogPaused: opts.dialogPaused,
        pendingQuestion: opts.pendingQuestion,
        pendingQuestionMeta: opts.pendingQuestionMeta ?? null,
        pendingQuestionShadow: opts.pendingQuestionShadow ?? null,
        stateSnapshot: state ?? null,
        prMetrics: opts.prMetrics ?? null,
        reason: opts.reason ?? 'manual',
    };

    return snapshot;
}

/**
 * F69: Versão async de saveSnapshot — usa fs/promises.
 *
 * @param {SessionSnapshotData} snapshot
 * @returns {Promise<string>} Caminho do arquivo salvo
 */
export async function saveSnapshotAsync(snapshot) {
    return saveSnapshotFileAsync(snapshot);
}

/**
 * @typedef {Object} SnapshotListItem
 * @property {string} snapshotId
 * @property {number} createdAt
 * @property {string | null} sessionId
 * @property {string} model
 * @property {string} [reason]
 * @property {string} filepath
 */

/**
 * F69: Versão async de listSnapshots — usa fs/promises.
 *
 * @returns {Promise<SnapshotListItem[]>}
 */
export async function listSnapshotsAsync() {
    return listSnapshotFilesAsync();
}

/**
 * F69: Versão async de loadSnapshot.
 *
 * @param {string} snapshotId
 * @returns {Promise<SessionSnapshotData | null>}
 */
export async function loadSnapshotAsync(snapshotId) {
    return loadSnapshotFileAsync(snapshotId);
}

/**
 * F69: Versão async de loadLatestSnapshot.
 *
 * @returns {Promise<SessionSnapshotData | null>}
 */
export async function loadLatestSnapshotAsync() {
    return loadLatestSnapshotFileAsync();
}

/**
 * F69: Versão async de pruneSnapshots — usa fs/promises.
 *
 * @param {number} [keep] - Número de snapshots a manter (default definido pelo snapshot-store)
 * @returns {Promise<number>} Número de snapshots removidos
 */
export async function pruneSnapshotsAsync(keep) {
    return pruneSnapshotFilesAsync(keep);
}

/**
 * Converte o snapshot tipado interno em um record genérico compatível com `IStateStore`.
 *
 * @param {SessionSnapshotData} snapshot
 * @returns {Record<string, unknown>}
 */
function toSnapshotRecord(snapshot) {
    return { ...snapshot };
}

/**
 * Normaliza um payload externo para o schema canônico de snapshot.
 *
 * @param {Record<string, unknown>} snapshot
 * @returns {SessionSnapshotData}
 * @throws {TypeError} Quando o payload não satisfaz o schema esperado.
 */
function fromSnapshotRecord(snapshot) {
    return normalizeSnapshotRecord(snapshot);
}

// ─── IStateStore singleton (Faixa 3.2 — AC-5-03) ────────────────────────────

/**
 * Adapter sobre as funções de snapshot que implementa a interface `IStateStore`.
 *
 * @type {import('../../../core/interfaces.js').IStateStore}
 */
export const snapshotStore = {
    createSnapshot: (opts) => toSnapshotRecord(createSnapshot(opts)),
    saveSnapshot: async (snapshot) => {
        await saveSnapshotAsync(fromSnapshotRecord(snapshot));
    },
    loadSnapshot: (id) => (id ? loadSnapshotAsync(id) : loadLatestSnapshotAsync()),
    listSnapshots: () => listSnapshotsAsync(),
};
