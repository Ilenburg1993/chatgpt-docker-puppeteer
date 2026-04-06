// @ts-check
/**
 * src/copilot/agent/session/snapshot.js
 *
 * F41 — Session Snapshot & Restore.
 *
 * Serializa e restaura o estado completo de uma sessão do agente, incluindo contexto do dialog loop, métricas, modelo
 * ativo, fila pendente e configuração de permissões.
 *
 * @module copilot/agent/session/snapshot
 */

import { log } from '#copilot/observability/logger';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SNAPSHOT_DIR as _SNAPSHOT_DIR_ENV, MAX_SNAPSHOTS } from '../config.js';
import { readState } from '../lifecycle/state-io.js';

const ROOT = resolve(import.meta.dirname, '../../');
const SNAPSHOT_DIR = _SNAPSHOT_DIR_ENV
    ? resolve(_SNAPSHOT_DIR_ENV)
    : join(ROOT, '.github', 'hooks', 'state', 'snapshots');

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
 *     prMetrics?: { boots: number; resumesWithPR: number; resumesZeroPR: number; totalPR: number } | null;
 *     reason?: string;
 * }} opts
 * @returns {SessionSnapshotData}
 */
export function createSnapshot(opts) {
    const snapshotId = `snap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
        stateSnapshot: state ?? null,
        prMetrics: opts.prMetrics ?? null,
        reason: opts.reason ?? 'manual',
    };

    return snapshot;
}

/**
 * Salva um snapshot em disco.
 *
 * @param {SessionSnapshotData} snapshot
 * @returns {string} Caminho do arquivo salvo
 */
export function saveSnapshot(snapshot) {
    if (!existsSync(SNAPSHOT_DIR)) {
        mkdirSync(SNAPSHOT_DIR, { recursive: true });
    }

    const filename = `${snapshot.snapshotId}.json`;
    const filepath = join(SNAPSHOT_DIR, filename);

    writeFileSync(filepath, JSON.stringify(snapshot, null, 4), 'utf8');
    log('INFO', `[SessionSnapshot] Snapshot salvo: ${filepath}`);

    // F41.6: pruning — manter apenas os últimos MAX_SNAPSHOTS
    pruneSnapshots();

    return filepath;
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
 * Lista todos os snapshots disponíveis, ordenados do mais recente ao mais antigo.
 *
 * @returns {SnapshotListItem[]}
 */
export function listSnapshots() {
    if (!existsSync(SNAPSHOT_DIR)) return [];

    /** @type {SnapshotListItem[]} */
    const result = [];
    for (const f of readdirSync(SNAPSHOT_DIR)) {
        if (!f.endsWith('.json')) continue;
        const filepath = join(SNAPSHOT_DIR, f);
        try {
            const data = JSON.parse(readFileSync(filepath, 'utf8'));
            result.push({
                snapshotId: String(data.snapshotId ?? f.replace('.json', '')),
                createdAt: Number(data.createdAt ?? 0),
                sessionId: data.sessionId ?? null,
                model: String(data.model ?? 'unknown'),
                reason: data.reason,
                filepath,
            });
        } catch {
            // skip corrupt files
        }
    }
    result.sort((a, b) => b.createdAt - a.createdAt);
    return result;
}

/**
 * Carrega um snapshot por ID.
 *
 * @param {string} snapshotId
 * @returns {SessionSnapshotData | null}
 */
export function loadSnapshot(snapshotId) {
    if (!existsSync(SNAPSHOT_DIR)) return null;

    const filepath = join(SNAPSHOT_DIR, `${snapshotId}.json`);
    if (!existsSync(filepath)) {
        // Tenta busca por prefixo
        const files = readdirSync(SNAPSHOT_DIR).filter((f) => f.startsWith(snapshotId) && f.endsWith('.json'));
        if (files.length === 0) return null;
        const first = files[0];
        if (!first) return null;
        const fullPath = join(SNAPSHOT_DIR, first);
        try {
            return JSON.parse(readFileSync(fullPath, 'utf8'));
        } catch {
            return null;
        }
    }

    try {
        return JSON.parse(readFileSync(filepath, 'utf8'));
    } catch {
        return null;
    }
}

/**
 * Carrega o snapshot mais recente.
 *
 * @returns {SessionSnapshotData | null}
 */
export function loadLatestSnapshot() {
    const snapshots = listSnapshots();
    if (snapshots.length === 0) return null;
    const latest = snapshots[0];
    return latest ? loadSnapshot(latest.snapshotId) : null;
}

/**
 * F41.6: Remove snapshots antigos, mantendo apenas os últimos MAX_SNAPSHOTS.
 *
 * @param {number} [keep] - Número de snapshots a manter (default: MAX_SNAPSHOTS)
 * @returns {number} Número de snapshots removidos
 */
export function pruneSnapshots(keep = MAX_SNAPSHOTS) {
    const snapshots = listSnapshots();
    if (snapshots.length <= keep) return 0;

    const toRemove = snapshots.slice(keep);
    let removed = 0;
    for (const snap of toRemove) {
        try {
            if (snap?.filepath) {
                rmSync(snap.filepath, { force: true });
                removed++;
            }
        } catch {
            // ignore
        }
    }

    if (removed > 0) {
        log('INFO', `[SessionSnapshot] Pruning: ${removed} snapshot(s) antigo(s) removido(s).`);
    }
    return removed;
}
