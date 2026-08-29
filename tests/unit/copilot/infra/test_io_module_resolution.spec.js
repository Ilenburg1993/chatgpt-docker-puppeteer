// @ts-check

import {
    buildLocalModuleCandidatePaths,
    createLocalModuleResolver,
    isLocalModuleSource,
} from '#copilot/infra/public/indexing/module-resolution';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'vitest';

describe('canonical local module resolution', () => {
    it('resolves relative, exact and wildcard package imports from one immutable package snapshot', async () => {
        const root = await mkdtemp(join(tmpdir(), 'copilot-module-resolution-'));
        try {
            await writeFile(
                join(root, 'package.json'),
                JSON.stringify({
                    type: 'module',
                    imports: {
                        '#app/exact': './src/exact.js',
                        '#app/*': './src/*.js',
                    },
                }),
                'utf8',
            );
            const resolver = await createLocalModuleResolver({ workspaceRoot: root });
            const importer = join(root, 'src', 'consumer.js');

            const relative = resolver.resolve(importer, './dep.js');
            assert.equal(relative.local, true);
            assert.equal(relative.resolved, true);
            assert.equal(relative.strategy, 'relative');
            assert.ok(relative.candidates.includes(join(root, 'src', 'dep.js')));
            assert.ok(relative.candidates.includes(join(root, 'src', 'dep.ts')));

            const exact = resolver.resolve(importer, '#app/exact');
            assert.equal(exact.strategy, 'package-import-exact');
            assert.equal(exact.basePath, join(root, 'src', 'exact.js'));

            const wildcard = resolver.resolve(importer, '#app/feature');
            assert.equal(wildcard.strategy, 'package-import-wildcard');
            assert.equal(wildcard.basePath, join(root, 'src', 'feature.js'));
            assert.equal(typeof resolver.packageImportsHash, 'string');

            const external = resolver.resolve(importer, 'zod');
            assert.deepEqual(external, {
                source: 'zod',
                local: false,
                resolved: false,
                strategy: 'external-package',
                basePath: null,
                candidates: [],
            });
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it('keeps local-source classification and candidate generation centralized', () => {
        assert.equal(isLocalModuleSource('./local.js'), true);
        assert.equal(isLocalModuleSource('#copilot/sdk'), true);
        assert.equal(isLocalModuleSource('node:path'), false);
        assert.deepEqual(buildLocalModuleCandidatePaths('/tmp/example.js'), ['/tmp/example.js', '/tmp/example.ts']);
        assert.ok(buildLocalModuleCandidatePaths('/tmp/example').includes('/tmp/example/index.js'));
    });
});
