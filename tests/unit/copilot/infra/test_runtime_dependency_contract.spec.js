// @ts-check
/**
 * Packaging contract for runtime dependencies used by src/copilot I/O foundations.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'vitest';

/** @returns {Promise<Record<string, any>>} */
async function readJson(path) {
    return JSON.parse(await readFile(path, 'utf8'));
}

describe('copilot runtime dependency contract', () => {
    it('keeps runtime glob dependencies production-reachable and removes the orphan xxhash package', async () => {
        const [packageJson, packageLock] = await Promise.all([
            readJson('package.json'),
            readJson('package-lock.json'),
        ]);
        const dependencies = packageJson.dependencies ?? {};
        const devDependencies = packageJson.devDependencies ?? {};
        const rootLock = packageLock.packages?.[''] ?? {};
        const lockPackages = packageLock.packages ?? {};

        assert.equal(dependencies.minimatch, '^10.2.5');
        assert.equal(devDependencies.minimatch, undefined);
        assert.equal(dependencies['xxhash-wasm'], undefined);

        assert.equal(rootLock.dependencies?.minimatch, '^10.2.5');
        assert.equal(rootLock.devDependencies?.minimatch, undefined);
        assert.equal(rootLock.dependencies?.['xxhash-wasm'], undefined);
        assert.equal(lockPackages['node_modules/xxhash-wasm'], undefined);

        for (const packageName of ['minimatch', 'brace-expansion', 'balanced-match']) {
            const entry = lockPackages[`node_modules/${packageName}`];
            assert.ok(entry, `${packageName} must remain in the production lock graph`);
            assert.notEqual(entry.dev, true, `${packageName} must not be dev-only`);
        }

        assert.equal(dependencies['p-limit'], '^7.3.0');
        assert.equal(dependencies.ignore, '^7.0.5');
    });
});
