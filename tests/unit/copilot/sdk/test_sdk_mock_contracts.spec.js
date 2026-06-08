// @ts-check
/**
 * Guardrails para mocks locais do `@github/copilot-sdk` e barrels SDK.
 *
 * `SYSTEM_PROMPT_SECTIONS` segue existindo como alias compat local, mas mocks que só expõem esse nome recriam o mundo
 * SDK 0.3 e podem mascarar regressões da 1.0. Sempre que um mock exportar o alias, ele deve exportar também
 * `SYSTEM_MESSAGE_SECTIONS`.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const TEST_ROOT = join(process.cwd(), 'tests', 'unit', 'copilot');

/**
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function listJsFiles(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    const nested = await Promise.all(
        entries.map(async (entry) => {
            const abs = join(dir, entry.name);
            if (entry.isDirectory()) return listJsFiles(abs);
            if (entry.isFile() && entry.name.endsWith('.js')) return [abs];
            return [];
        }),
    );
    return nested.flat();
}

describe('sdk mock contracts', () => {
    it('mocks que exportam SYSTEM_PROMPT_SECTIONS também exportam SYSTEM_MESSAGE_SECTIONS', async () => {
        const files = await listJsFiles(TEST_ROOT);
        /** @type {string[]} */
        const violations = [];

        for (const file of files) {
            const source = await readFile(file, 'utf8');
            const hasPromptAlias = /\bSYSTEM_PROMPT_SECTIONS\b/u.test(source);
            const hasMock = /\bvi\.(?:doMock|mock)\s*\(/u.test(source);
            if (!hasPromptAlias || !hasMock) continue;
            if (!/\bSYSTEM_MESSAGE_SECTIONS\b/u.test(source)) {
                violations.push(relative(process.cwd(), file));
            }
        }

        expect(violations).toEqual([]);
    });
});
