// @ts-check
/**
 * Packaging contract for runtime dependencies used by src/copilot I/O foundations.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'vitest';

/** @param {string} filePath @returns {Promise<unknown>} */
async function readJson(filePath) {
    return JSON.parse(await readFile(filePath, 'utf8'));
}

/** @param {unknown} value @returns {Record<string, unknown>} */
function asRecord(value) {
    assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value));
    return /** @type {Record<string, unknown>} */ (value);
}

describe('copilot runtime dependency contract', () => {
    it('mantém dependências runtime de glob e fingerprint alcançáveis em produção', async () => {
        const [packageJson, packageLock] = await Promise.all([readJson('package.json'), readJson('package-lock.json')]);
        const packageRecord = asRecord(packageJson);
        const lockRecord = asRecord(packageLock);
        const dependencies = asRecord(packageRecord['dependencies']);
        const devDependencies = asRecord(packageRecord['devDependencies']);
        const lockPackages = asRecord(lockRecord['packages']);
        const rootLock = asRecord(lockPackages['']);

        assert.equal(dependencies['minimatch'], '^10.2.6');
        assert.equal(devDependencies['minimatch'], undefined);
        assert.equal(dependencies['xxhash-wasm'], '^1.1.0');

        assert.equal(asRecord(rootLock['dependencies'])['minimatch'], '^10.2.6');
        assert.equal(asRecord(rootLock['devDependencies'])['minimatch'], undefined);
        assert.equal(asRecord(rootLock['dependencies'])['xxhash-wasm'], '^1.1.0');
        assert.ok(lockPackages['node_modules/xxhash-wasm']);

        for (const packageName of ['minimatch', 'brace-expansion', 'balanced-match']) {
            const entry = lockPackages[`node_modules/${packageName}`];
            assert.ok(entry, `${packageName} must remain in the production lock graph`);
            assert.notEqual(asRecord(entry)['dev'], true, `${packageName} must not be dev-only`);
        }

        assert.equal(dependencies['p-limit'], '^7.3.1');
        assert.equal(dependencies['ignore'], '^7.0.6');
    });
});
