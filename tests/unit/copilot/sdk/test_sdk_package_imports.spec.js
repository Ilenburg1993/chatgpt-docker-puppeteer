// @ts-check

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../../../', import.meta.url).pathname.replace(/\/$/, '');

/**
 * @returns {Record<string, string>}
 */
function readPackageImports() {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    return /** @type {Record<string, string>} */ (pkg.imports ?? {});
}

/**
 * @param {string} target
 * @returns {string}
 */
function resolveImportTargetProbe(target) {
    const normalized = target.replace(/^\.\//, '');
    if (!normalized.includes('*')) return join(ROOT, normalized);

    const beforeStar = normalized.slice(0, normalized.indexOf('*'));
    return join(ROOT, dirname(beforeStar));
}

describe('sdk/package imports — aliases internos apontam para destinos existentes', () => {
    it('não mantém aliases quebrados em package.json#imports', () => {
        const imports = readPackageImports();
        const broken = [];

        for (const [alias, target] of Object.entries(imports)) {
            if (!alias.startsWith('#copilot/')) continue;
            const probe = resolveImportTargetProbe(target);
            if (!existsSync(probe)) broken.push(`${alias} -> ${target}`);
        }

        expect(broken, `Aliases quebrados:\n${broken.join('\n')}`).toHaveLength(0);
    });
});
