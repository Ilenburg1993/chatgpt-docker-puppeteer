// @ts-check

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'vitest';

import {
    buildPublicSurfaceCostReport,
    createStaticImportClosureAnalyzer,
} from '#copilot/infra/public/diagnostic/governance';
import {
    buildTransitiveImportPurityReport,
    inspectModuleImportPurity,
} from '../../../../scripts/analysis/lib/import-purity.mjs';
import {
    loadMcpPublicApiCostConfiguration,
    packageMcpPublicAliases,
    validateMcpPublicApiManifestBijection,
} from '../../../../scripts/analysis/lib/mcp-public-api-cost-config.mjs';

/** @type {string[]} */
const temporaryRoots = [];

function makeRoot() {
    const root = mkdtempSync(path.join(tmpdir(), 'mcp-public-cost-'));
    temporaryRoots.push(root);
    return root;
}

afterEach(() => {
    while (temporaryRoots.length > 0) rmSync(temporaryRoots.pop(), { recursive: true, force: true });
});

describe('MCP public API cost governance', () => {
    it('keeps the manifest in exact bijection with package public aliases', async () => {
        const configuration = await loadMcpPublicApiCostConfiguration();
        const packageAliases = packageMcpPublicAliases(configuration.packageJson);
        assert.equal(configuration.manifest.length, 76);
        assert.equal(packageAliases.length, 76);
        assert.deepEqual(validateMcpPublicApiManifestBijection(packageAliases, configuration.manifest), []);
    });

    it('measures only static local edges while retaining external package cost', () => {
        const root = makeRoot();
        writeFileSync(
            path.join(root, 'entry.js'),
            "import './dep.js'; import { x } from '#fixture/x'; import { z } from 'zod'; void z; void x; void import('./lazy.js');\n",
        );
        writeFileSync(path.join(root, 'dep.js'), 'export const dep = 1;\n');
        writeFileSync(path.join(root, 'alias.js'), 'export const x = 2;\n');
        writeFileSync(path.join(root, 'lazy.js'), 'export const lazy = 3;\n');
        const analyzer = createStaticImportClosureAnalyzer({
            repoRoot: root,
            packageImports: { '#fixture/x': './alias.js' },
        });
        const closure = analyzer.build('./entry.js');
        assert.equal(closure.moduleCount, 3);
        assert.deepEqual(closure.files, ['alias.js', 'dep.js', 'entry.js']);
        assert.deepEqual(closure.externalPackages, ['zod']);
        assert.deepEqual(closure.unresolved, []);
    });

    it('separates generic mechanics from domain-owned baseline and tier policy', () => {
        const report = buildPublicSurfaceCostReport({
            manifest: [{ alias: '#fixture/public', target: './entry.js', costTier: 'micro' }],
            baseline: [
                {
                    alias: '#fixture/public',
                    moduleCount: 2,
                    maxModuleCount: 3,
                    sourceBytes: 100,
                    maxSourceBytes: 150,
                    externalPackages: ['zod'],
                },
            ],
            tierLimits: { micro: { maxModules: 3, maxSourceBytes: 150 } },
            buildClosure: () => ({
                moduleCount: 4,
                sourceBytes: 151,
                files: [],
                externalPackages: ['zod', 'new-package'],
                unresolved: [{ importer: 'entry.js', specifier: './missing.js' }],
            }),
        });
        assert.equal(report.success, false);
        assert.deepEqual(report.violations[0]?.violations, [
            'module-count:4>3',
            'source-bytes:151>150',
            'new-external-package:new-package',
            'tier-module-limit:4>3',
            'tier-source-limit:151>150',
            'unresolved-static-imports:1',
        ]);
    });

    it('detects only high-confidence import-time effects and keeps pure initialization clean', () => {
        const root = makeRoot();
        const pureFile = path.join(root, 'pure.js');
        const impureFile = path.join(root, 'impure.js');
        writeFileSync(pureFile, 'export const value = Object.freeze({ ok: true });\n');
        writeFileSync(
            impureFile,
            [
                "import './registration.js';",
                "import { writeFileSync as persist } from 'node:fs';",
                "process.env.MCP_IMPORT_PURITY_TEST = '1';",
                'setTimeout(() => {}, 1);',
                "const result = persist('/tmp/never-run-by-parser', 'x');",
                'void result;',
            ].join('\n'),
        );
        assert.deepEqual(inspectModuleImportPurity(pureFile), []);
        const kinds = inspectModuleImportPurity(impureFile).map((entry) => entry.kind);
        assert.ok(kinds.includes('side-effect-only-import'));
        assert.ok(kinds.includes('top-level-expression'));
        assert.ok(kinds.includes('process-env-mutation'));
        assert.ok(kinds.includes('effectful-global-call:setTimeout'));
        assert.ok(kinds.includes('effectful-node-call:persist'));
    });

    it('maps one transitive finding back to every public alias that reaches the module', () => {
        const root = makeRoot();
        const shared = path.join(root, 'shared.js');
        writeFileSync(shared, 'setInterval(() => {}, 1000);\n');
        const report = buildTransitiveImportPurityReport({
            manifest: [
                { alias: '#fixture/a', target: './a.js' },
                { alias: '#fixture/b', target: './b.js' },
            ],
            buildClosure: () => ({ files: [shared] }),
        });
        assert.equal(report.success, false);
        assert.equal(report.findingCount, 2);
        const globalFinding = report.findings.find((entry) => entry.kind === 'effectful-global-call:setInterval');
        assert.deepEqual(globalFinding?.aliases, ['#fixture/a', '#fixture/b']);
    });
});
