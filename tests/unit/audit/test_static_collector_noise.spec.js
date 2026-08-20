// @ts-check
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { collectStaticFindings } from '../../../scripts/audit/collectors/static.mjs';

test('static collector filters dist cycles and test-only duplication noise', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-static-noise-'));
    const jscpdOutputDir = path.join(tmpDir, 'jscpd');
    fs.mkdirSync(jscpdOutputDir, { recursive: true });

    /**
     * @param {string} stepId
     */
    async function exec(stepId) {
        if (stepId === 'static.forbidden') {
            return {
                ok: true,
                exitCode: 0,
                stdout: JSON.stringify({ ok: true, findings: [] }),
                stderr: '',
            };
        }
        if (stepId === 'static.lint' || stepId === 'static.typecheck') {
            return { ok: true, exitCode: 0, stdout: '', stderr: '' };
        }
        if (stepId === 'static.depgraph') {
            return {
                ok: true,
                exitCode: 0,
                stdout: JSON.stringify({
                    cycles: [
                        ['dashboard-ui/dist/assets/index.js', 'dashboard-ui/dist/assets/a.js'],
                        ['src/server/main.js', 'src/server/engine/lifecycle.js'],
                    ],
                }),
                stderr: '',
            };
        }
        if (stepId === 'static.jscpd') {
            const reportPath = path.join(jscpdOutputDir, 'jscpd-report.json');
            fs.writeFileSync(
                reportPath,
                JSON.stringify(
                    {
                        duplicates: [
                            {
                                firstFile: { name: 'tests/a.spec.js', start: 10 },
                                secondFile: { name: 'tests/b.spec.js', start: 12 },
                                lines: 20,
                                tokens: 120,
                            },
                            {
                                firstFile: { name: 'src/server/main.js', start: 88 },
                                secondFile: { name: 'src/main.js', start: 420 },
                                lines: 18,
                                tokens: 110,
                            },
                        ],
                    },
                    null,
                    2,
                ),
                'utf8',
            );
            return { ok: true, exitCode: 0, stdout: '', stderr: '' };
        }
        return { ok: true, exitCode: 0, stdout: '', stderr: '' };
    }

    const out = await collectStaticFindings(
        /** @type {any} */ ({
            profile: 'deep',
            changedFiles: [],
            artifactsDir: tmpDir,
            contractsMode: 'hybrid',
            exec,
            commandExistsFn: async () => false,
        }),
    );

    const depgraphFindings = out.findings.filter((item) => item.source_tool === 'dependency-graph');
    const jscpdFindings = out.findings.filter((item) => item.source_tool === 'jscpd');

    assert.equal(depgraphFindings.length, 1);
    assert.equal(/** @type {any} */ (depgraphFindings[0]).file, 'src/server/main.js');
    assert.equal(jscpdFindings.length, 1);
    assert.equal(/** @type {any} */ (jscpdFindings[0]).file, 'src/server/main.js');
});

test('static dependency graph fails closed on parser errors and never accepts exit code 2', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-static-depgraph-fail-closed-'));
    const observed = /** @type {{ depgraphAcceptExitCodes: unknown }} */ ({ depgraphAcceptExitCodes: null });

    /**
     * @param {string} stepId
     * @param {string} _command
     * @param {string[]} _args
     * @param {Record<string, any>} options
     */
    async function exec(stepId, _command, _args, options) {
        if (stepId === 'static.depgraph') {
            observed.depgraphAcceptExitCodes = options['acceptExitCodes'];
            return {
                ok: false,
                exitCode: 2,
                stdout: JSON.stringify({
                    cycles: [],
                    parseErrors: [{ file: 'src/broken.js', line: 7, message: 'Unexpected token' }],
                    unresolvedLocalImports: [{ file: 'src/importer.js', specifier: './missing.js' }],
                }),
                stderr: '',
            };
        }
        if (stepId === 'static.forbidden') {
            return { ok: true, exitCode: 0, stdout: JSON.stringify({ ok: true, findings: [] }), stderr: '' };
        }
        return { ok: true, exitCode: 0, stdout: '', stderr: '' };
    }

    const out = await collectStaticFindings(
        /** @type {any} */ ({
            profile: 'deep',
            changedFiles: [],
            artifactsDir: tmpDir,
            contractsMode: 'hybrid',
            exec,
            commandExistsFn: async () => false,
        }),
    );

    assert.deepEqual(observed.depgraphAcceptExitCodes, [0, 1]);
    const parseFinding = out.findings.find((item) => item.rule === 'dependency-graph-parse-error');
    assert.ok(parseFinding);
    assert.equal(parseFinding.file, 'src/broken.js');
    assert.equal(parseFinding.line, 7);
    const unresolvedFinding = out.findings.find((item) => item.rule === 'dependency-graph-unresolved-local-import');
    assert.ok(unresolvedFinding);
    assert.equal(unresolvedFinding.file, 'src/importer.js');
    assert.match(String(unresolvedFinding.evidence), /\.\/missing\.js/u);
    assert.equal(out.telemetry['gates']?.['depgraph_ok'], false);
    assert.ok(out.errors.some((item) => item.source === 'dependency-graph'));
});
