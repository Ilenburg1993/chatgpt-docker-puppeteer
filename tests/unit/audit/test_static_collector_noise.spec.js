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
        if (stepId === 'static.madge') {
            return {
                ok: true,
                exitCode: 0,
                stdout: [
                    '(node:1) warning',
                    JSON.stringify([
                        ['dashboard-ui/dist/assets/index.js', 'dashboard-ui/dist/assets/a.js'],
                        ['src/server/main.js', 'src/server/engine/lifecycle.js'],
                    ]),
                ].join('\n'),
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

    const madgeFindings = out.findings.filter((item) => item.source_tool === 'madge');
    const jscpdFindings = out.findings.filter((item) => item.source_tool === 'jscpd');

    assert.equal(madgeFindings.length, 1);
    assert.equal(/** @type {any} */ (madgeFindings[0]).file, 'src/server/main.js');
    assert.equal(jscpdFindings.length, 1);
    assert.equal(/** @type {any} */ (jscpdFindings[0]).file, 'src/server/main.js');
});
