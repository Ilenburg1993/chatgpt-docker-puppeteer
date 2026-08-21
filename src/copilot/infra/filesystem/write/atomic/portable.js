// @ts-check
/**
 * Atomic writer for trusted, explicitly configured paths that may live outside the workspace.
 *
 * Unlike `writeFileAtomic`, this function deliberately skips workspace path policy. It still serializes by normalized
 * resource key and uses a same-directory temp file followed by rename.
 *
 * @module copilot/infra/filesystem/write/atomic/portable
 */

import { withIoResourceLock } from '#copilot/infra/internal/concurrency/locks';
import { mkdirPathUnlocked } from '#copilot/infra/internal/filesystem/transaction';
import path from 'node:path';
import { writeAtomicFileUnlocked } from './unlocked.js';

/**
 * @param {string} filePath
 * @param {string | Buffer | Uint8Array | ArrayBuffer | SharedArrayBuffer | DataView} content
 * @param {{
 *     mode?: number;
 *     durability?: import('#copilot/infra/internal/platform/node/filesystem').IoDurabilityMode;
 *     riskClass?: import('#copilot/core/io-contracts').IoRiskClass;
 * }} [options]
 * @returns {Promise<void>}
 */
export async function writeFileAtomicPortable(filePath, content, options = {}) {
    await withIoResourceLock(
        filePath,
        async () => {
            await mkdirPathUnlocked(path.dirname(filePath), {
                recursive: true,
                ...(options.durability === undefined ? {} : { durability: options.durability }),
            });
            await writeAtomicFileUnlocked(filePath, content, options);
        },
        {
            operation: 'trusted-write',
            target: filePath,
            riskClass: options.riskClass ?? 'medium',
        },
    );
}
