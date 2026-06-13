// @ts-check
/**
 * @module copilot/agent/session/snapshot-store
 * @file Persistência física e validação de snapshots de sessão.
 */

import { resolveHooksStateDir } from '#copilot/boot';
import { access, readdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { SNAPSHOT_DIR as _SNAPSHOT_DIR_ENV, MAX_SNAPSHOTS } from '#copilot/config/agent';
import { safeJsonParse } from '#copilot/core';
import { SessionSnapshotDataSchema, SnapshotIdSchema, SnapshotListItemSchema } from '#copilot/core';
import { writeFileAtomicPortable } from '#copilot/infra/public/io';
import { logSwallowed } from '../../ports/core-runtime-port.js';
import { log } from '../../ports/logging/index.js';
import { startSpan } from '../../ports/tracing-port.js';

const SNAPSHOT_DIR = _SNAPSHOT_DIR_ENV ? resolve(_SNAPSHOT_DIR_ENV) : resolve(resolveHooksStateDir(), 'snapshots');

/**
 * @param {unknown} snapshotId
 * @returns {string | null}
 */
function normalizeSnapshotId(snapshotId) {
    const parsed = SnapshotIdSchema.safeParse(snapshotId);
    return parsed.success ? parsed.data : null;
}

/**
 * @typedef {import('./snapshot.js').SessionSnapshotData} SessionSnapshotData
 *
 * @typedef {Object} SnapshotListItem
 * @property {string} snapshotId
 * @property {number} createdAt
 * @property {string | null} sessionId
 * @property {string} model
 * @property {string} [reason]
 * @property {string} filepath
 */

/**
 * @param {Record<string, unknown>} snapshot
 * @returns {SessionSnapshotData}
 * @throws {TypeError}
 */
export function normalizeSnapshotRecord(snapshot) {
    const parsed = SessionSnapshotDataSchema.safeParse(snapshot);
    if (!parsed.success) {
        throw new TypeError('Snapshot payload inválido para IStateStore.saveSnapshot');
    }
    return /** @type {SessionSnapshotData} */ (parsed.data);
}

/**
 * @param {SessionSnapshotData} snapshot
 * @returns {Promise<string>}
 */
export async function saveSnapshotFileAsync(snapshot) {
    return startSpan(
        'copilot.snapshot.save',
        { extra: { snapshotId: snapshot.snapshotId, reason: snapshot.reason ?? 'manual' } },
        async () => {
            const snapshotId = normalizeSnapshotId(snapshot.snapshotId);
            if (!snapshotId) throw new TypeError('Snapshot ID inválido para persistência.');
            const filename = `${snapshotId}.json`;
            const filepath = join(SNAPSHOT_DIR, filename);

            await writeFileAtomicPortable(filepath, JSON.stringify(snapshot, null, 4), { mode: 0o600 });
            log('INFO', `[SessionSnapshot] Snapshot salvo (async): ${filepath}`);

            await pruneSnapshotFilesAsync();

            return filepath;
        },
    );
}

/**
 * @returns {Promise<SnapshotListItem[]>}
 */
export async function listSnapshotFilesAsync() {
    try {
        await access(SNAPSHOT_DIR);
    } catch {
        return [];
    }

    /** @type {SnapshotListItem[]} */
    const result = [];
    for (const f of await readdir(SNAPSHOT_DIR)) {
        if (!f.endsWith('.json')) continue;
        const fileSnapshotId = normalizeSnapshotId(f.slice(0, -'.json'.length));
        if (!fileSnapshotId) continue;
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
            if (data.snapshotId !== fileSnapshotId) {
                log('WARN', `[SessionSnapshot] Snapshot inválido (${f}): snapshotId diverge do filename`);
                continue;
            }
            result.push({
                snapshotId: fileSnapshotId,
                createdAt: Number(data.createdAt ?? 0),
                sessionId: data.sessionId ?? null,
                model: String(data.model ?? 'unknown'),
                filepath,
                ...(data.reason ? { reason: data.reason } : {}),
            });
        } catch (e) {
            logSwallowed(e, 'snapshot.listAsync.parseFile');
        }
    }
    result.sort((a, b) => b.createdAt - a.createdAt);
    return result;
}

/**
 * @param {string} snapshotId
 * @returns {Promise<SessionSnapshotData | null>}
 */
export async function loadSnapshotFileAsync(snapshotId) {
    return startSpan('copilot.snapshot.load', { extra: { snapshotId } }, async () => {
        const normalizedSnapshotId = normalizeSnapshotId(snapshotId);
        if (!normalizedSnapshotId) return null;
        try {
            await access(SNAPSHOT_DIR);
        } catch {
            return null;
        }

        const filepath = join(SNAPSHOT_DIR, `${normalizedSnapshotId}.json`);

        try {
            const text = await readFile(filepath, 'utf8');
            const jsonResult = safeJsonParse(text, `[SessionSnapshot/loadAsync/${filepath}]`);
            if (!jsonResult.ok) return null;
            const parsed = SessionSnapshotDataSchema.safeParse(jsonResult.data);
            if (!parsed.success || parsed.data.snapshotId !== normalizedSnapshotId) return null;
            return /** @type {SessionSnapshotData} */ (parsed.data);
        } catch {
            return null;
        }
    });
}

/**
 * @returns {Promise<SessionSnapshotData | null>}
 */
export async function loadLatestSnapshotFileAsync() {
    const snapshots = await listSnapshotFilesAsync();
    if (snapshots.length === 0) return null;
    const latest = snapshots[0];
    return latest ? loadSnapshotFileAsync(latest.snapshotId) : null;
}

/**
 * @param {number} [keep]
 * @returns {Promise<number>}
 */
export async function pruneSnapshotFilesAsync(keep = MAX_SNAPSHOTS) {
    const snapshots = await listSnapshotFilesAsync();
    if (snapshots.length <= keep) return 0;

    const toRemove = snapshots.slice(keep);
    let removed = 0;
    for (const snap of toRemove) {
        try {
            if (snap?.filepath) {
                await rm(snap.filepath, { force: true });
                removed++;
            }
        } catch (e) {
            logSwallowed(e, 'snapshot.pruneAsync.rmFile');
        }
    }
    return removed;
}
