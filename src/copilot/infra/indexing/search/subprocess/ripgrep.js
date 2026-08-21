// @ts-check
/** Process-local ripgrep availability probe/cache. */

import { execSearchFile } from './exec.js';

/** @type {boolean | null} */
let rgAvailable = null;

/**
 * Verifica e cacheia a disponibilidade de ripgrep no ambiente atual.
 *
 * @returns {Promise<boolean>}
 */
export async function isRipgrepAvailable() {
    if (rgAvailable !== null) return rgAvailable;
    try {
        await execSearchFile('rg', ['--version'], { timeout: 3000 });
        rgAvailable = true;
    } catch {
        rgAvailable = false;
    }
    return rgAvailable;
}

/** Test-control leaf; intentionally not exported by the search runtime barrel. */
export function resetRipgrepAvailabilityForTest() {
    rgAvailable = null;
}
