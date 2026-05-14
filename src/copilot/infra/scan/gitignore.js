// @ts-check
/**
 * Loader de .gitignore para scanner.
 *
 * @module copilot/infra/scan/gitignore
 */

import ignore from 'ignore';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * @param {string} workspaceRoot
 */
export async function loadGitignoreMatcher(workspaceRoot) {
    const matcher = ignore();
    try {
        const content = await readFile(join(workspaceRoot, '.gitignore'), 'utf8');
        matcher.add(content);
        return matcher;
    } catch {
        return matcher;
    }
}
