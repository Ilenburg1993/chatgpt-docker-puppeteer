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
 * @see EventBus
 */

import { logSwallowed } from '#copilot/core';
import { log, startSpan } from '#copilot/observability';
import { access, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { safeJsonParse } from '../../core/safe-json.js';
import { SessionSnapshotDataSchema, SnapshotListItemSchema } from '../../core/schemas.js';
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
    return startSpan(
        'copilot.snapshot.save',
        { extra: { snapshotId: snapshot.snapshotId, reason: snapshot.reason ?? 'manual' } },
        async () => {
            await mkdir(SNAPSHOT_DIR, { recursive: true });

            const filename = `${snapshot.snapshotId}.json`;
            const filepath = join(SNAPSHOT_DIR, filename);

            await writeFile(filepath, JSON.stringify(snapshot, null, 4), 'utf8');
            log('INFO', `[SessionSnapshot] Snapshot salvo (async): ${filepath}`);

            await pruneSnapshotsAsync();

            return filepath;
        },
    );
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
    try {
        await access(SNAPSHOT_DIR);
    } catch {
        return [];
    }

    /** @type {SnapshotListItem[]} */
    const result = [];
    for (const f of await readdir(SNAPSHOT_DIR)) {
        if (!f.endsWith('.json')) continue;
        const filepath = join(SNAPSHOT_DIR, f);
        try {
            const text = await readFile(filepath, 'utf8');
            const jsonResult = safeJsonParse(text, `[SessionSnapshot/listAsync/${f}]`);
            if (!jsonResult.ok) continue;
            const parsed = SnapshotListItemSchema.safeParse(jsonResult.data);
            if (!parsed.success) {
                log('WARN', `[SessionSnapshot] Snapshot inválido (${f}): schema validation failed`);
                continue;
            }
            const data = parsed.data;
            result.push({
                snapshotId: String(data.snapshotId ?? f.replace('.json', '')),
                createdAt: Number(data.createdAt ?? 0),
                sessionId: data.sessionId ?? null,
                model: String(data.model ?? 'unknown'),
                reason: data.reason,
                filepath,
            });
        } catch (/** @type {any} */ e) {
            logSwallowed(e, 'snapshot.listAsync.parseFile');
        }
    }
    result.sort((a, b) => b.createdAt - a.createdAt);
    return result;
}

/**
 * F69: Versão async de loadSnapshot.
 *
 * @param {string} snapshotId
 * @returns {Promise<SessionSnapshotData | null>}
 */
export async function loadSnapshotAsync(snapshotId) {
    return startSpan('copilot.snapshot.load', { extra: { snapshotId } }, async () => {
        try {
            await access(SNAPSHOT_DIR);
        } catch {
            return null;
        }

        const filepath = join(SNAPSHOT_DIR, `${snapshotId}.json`);
        let fileExists = true;
        try {
            await access(filepath);
        } catch {
            fileExists = false;
        }
        if (!fileExists) {
            const files = (await readdir(SNAPSHOT_DIR)).filter((f) => f.startsWith(snapshotId) && f.endsWith('.json'));
            if (files.length === 0) return null;
            const first = files[0];
            if (!first) return null;
            try {
                const text = await readFile(join(SNAPSHOT_DIR, first), 'utf8');
                const jsonResult = safeJsonParse(text, `[SessionSnapshot/loadAsync/${first}]`);
                if (!jsonResult.ok) return null;
                const parsed = SessionSnapshotDataSchema.safeParse(jsonResult.data);
                return parsed.success ? /** @type {SessionSnapshotData} */ (parsed.data) : null;
            } catch {
                return null;
            }
        }

        try {
            const text = await readFile(filepath, 'utf8');
            const jsonResult = safeJsonParse(text, `[SessionSnapshot/loadAsync/${filepath}]`);
            if (!jsonResult.ok) return null;
            const parsed = SessionSnapshotDataSchema.safeParse(jsonResult.data);
            return parsed.success ? /** @type {SessionSnapshotData} */ (parsed.data) : null;
        } catch {
            return null;
        }
    }); // startSpan copilot.snapshot.load
}

/**
 * F69: Versão async de loadLatestSnapshot.
 *
 * @returns {Promise<SessionSnapshotData | null>}
 */
export async function loadLatestSnapshotAsync() {
    const snapshots = await listSnapshotsAsync();
    if (snapshots.length === 0) return null;
    const latest = snapshots[0];
    return latest ? loadSnapshotAsync(latest.snapshotId) : null;
}

/**
 * F69: Versão async de pruneSnapshots — usa fs/promises.
 *
 * @param {number} [keep] - Número de snapshots a manter (default: MAX_SNAPSHOTS)
 * @returns {Promise<number>} Número de snapshots removidos
 */
export async function pruneSnapshotsAsync(keep = MAX_SNAPSHOTS) {
    const snapshots = await listSnapshotsAsync();
    if (snapshots.length <= keep) return 0;

    const toRemove = snapshots.slice(keep);
    let removed = 0;
    for (const snap of toRemove) {
        try {
            if (snap?.filepath) {
                await rm(snap.filepath, { force: true });
                removed++;
            }
        } catch (/** @type {any} */ e) {
            logSwallowed(e, 'snapshot.pruneAsync.rmFile');
        }
    }
    return removed;
}

// ─── IStateStore singleton (Faixa 3.2 — AC-5-03) ────────────────────────────

/**
 * Adapter sobre as funções de snapshot que implementa a interface `IStateStore`.
 *
 * @type {import('../../core/interfaces.js').IStateStore}
 */
export const snapshotStore = {
    createSnapshot: (opts) => /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (createSnapshot(opts))),
    saveSnapshot: async (snapshot) => {
        await saveSnapshotAsync(/** @type {any} */ (snapshot));
    },
    loadSnapshot: (id) => (id ? loadSnapshotAsync(id) : loadLatestSnapshotAsync()),
    listSnapshots: () => listSnapshotsAsync(),
};
