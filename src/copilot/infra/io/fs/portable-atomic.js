// @ts-check
/**
 * Atomic writer for trusted, explicitly configured paths that may live outside the workspace.
 *
 * Unlike `writeFileAtomic`, this function deliberately skips workspace path policy. It still serializes by normalized
 * resource key and uses a same-directory temp file followed by rename.
 *
 * @module copilot/infra/io/fs/portable-atomic
 */

import path from 'node:path';
import { withIoResourceLock } from '../../io-locks.js';
import { mkdirPathUnlocked } from './mkdir.js';
import { writeAtomicFileUnlocked } from './write-atomic.js';

/**
 * @param {string} filePath
 * @param {string | Buffer | Uint8Array | ArrayBuffer | SharedArrayBuffer | DataView} content
 * @param {{
 *     mode?: number;
 *     durability?: import('./durability.js').IoDurabilityMode;
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
