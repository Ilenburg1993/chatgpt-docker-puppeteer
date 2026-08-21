// @ts-check
/** Read-only rollback sidecar inventory projection. */

import { positiveIntegerOr } from '#copilot/infra/internal/platform';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { SIDECAR_FILE_PATTERN } from './format.js';
import { getIoRollbackPolicy, getRollbackSidecarDirectory } from './policy.js';
import { readVerifiedRollbackSidecar } from './storage.js';

/** @param {unknown} error */
function isMissingDirectoryError(error) {
    const code = /** @type {{ code?: unknown }} */ (error)?.code;
    return code === 'ENOENT' || code === 'ENOTDIR';
}

/**
 * Lista apenas metadados derivados de nomes válidos; nunca retorna conteúdo nem path absoluto.
 *
 * @param {{ directory?: string; nowMs?: number; maxEntries?: number; verifyContent?: boolean }} [options]
 */
export async function listRollbackSidecars(options = {}) {
    const directory = path.resolve(options.directory ?? getRollbackSidecarDirectory());
    const nowMs = Math.trunc(options.nowMs ?? Date.now());
    const maxEntries = positiveIntegerOr(options.maxEntries, 100);
    const directoryEntries = await fs.readdir(directory, { withFileTypes: true }).catch((error) => {
        if (isMissingDirectoryError(error)) return [];
        throw error;
    });
    const candidates = directoryEntries
        .filter((entry) => entry.isFile() && SIDECAR_FILE_PATTERN.test(entry.name))
        .sort((left, right) => left.name.localeCompare(right.name));
    const entries = candidates.slice(0, maxEntries);
    const sidecars = [];
    for (const entry of entries) {
        const match = SIDECAR_FILE_PATTERN.exec(entry.name);
        if (!match) continue;
        const candidate = path.join(directory, entry.name);
        const stats = await fs.lstat(candidate);
        const descriptor = {
            version: /** @type {const} */ (1),
            path: candidate,
            contentHash: String(match[2]),
            bytes: stats.size,
            createdAtMs: Math.trunc(stats.birthtimeMs || stats.ctimeMs),
            expiresAtMs: Number(match[1]),
        };
        let contentVerified = null;
        if (options.verifyContent) {
            contentVerified = await readVerifiedRollbackSidecar(descriptor, {
                directory,
                nowMs,
                allowExpired: true,
            })
                .then(() => true)
                .catch(() => false);
        }
        sidecars.push({
            id: entry.name,
            contentHash: descriptor.contentHash,
            bytes: descriptor.bytes,
            createdAtMs: descriptor.createdAtMs,
            expiresAtMs: descriptor.expiresAtMs,
            expired: descriptor.expiresAtMs <= nowMs,
            contentVerified,
        });
    }
    return {
        count: sidecars.length,
        limited: candidates.length > entries.length,
        policy: getIoRollbackPolicy(),
        sidecars,
    };
}
