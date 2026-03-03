// @ts-check
import { runCommand } from './exec.mjs';

/**
 * Returns changed files from git working tree and index.
 * @returns {Promise<string[]>}
 */
export async function getChangedFiles() {
    const result = await runCommand('git', ['diff', '--name-only', '--diff-filter=ACMRTUXB']);
    if (!result.ok) {
        return [];
    }

    return result.stdout
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);
}
