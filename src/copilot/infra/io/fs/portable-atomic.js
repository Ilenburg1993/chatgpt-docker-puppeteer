// @ts-check
/**
 * Atomic writer for trusted, explicitly configured paths that may live outside the workspace.
 *
 * Unlike `writeFileAtomic`, this function deliberately skips workspace path policy. It still serializes by normalized
 * resource key and uses a same-directory temp file followed by rename.
 *
 * @module copilot/infra/io/fs/portable-atomic
 */

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { withIoResourceLock } from '../../io-locks.js';
import { writeAtomicFileUnlocked } from './write-atomic.js';

/**
 * @param {string} filePath
 * @param {string | Buffer | Uint8Array | ArrayBuffer | SharedArrayBuffer | DataView} content
 * @param {{ mode?: number; riskClass?: import('#copilot/core/io-contracts').IoRiskClass }} [options]
 * @returns {Promise<void>}
 */
export async function writeFileAtomicPortable(filePath, content, options = {}) {
    await withIoResourceLock(
        filePath,
        async () => {
            await mkdir(path.dirname(filePath), { recursive: true });
            await writeAtomicFileUnlocked(filePath, content, options);
        },
        {
            operation: 'trusted-write',
            target: filePath,
            riskClass: options.riskClass ?? 'medium',
        },
    );
}
