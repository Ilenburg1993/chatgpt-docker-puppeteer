// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { collectQualityFindings } from '../../../scripts/audit/collectors/quality.mjs';

test('quality collector records warning when lint fails without parseable JSON', async () => {
    /** @type {any[]} */ const calls = [];

    const result = await collectQualityFindings(
        /** @type {any} */ ({
            profile: 'quick',
            changedFiles: ['package.json'],
            qualityMode: 'smart',
            qualityJsdoc: false,
            qualityCache: false,
            qualityParallelism: 'serial',
            exec: async (/** @type {any} */ stepId) => {
                calls.push(stepId);
                switch (stepId) {
                    case 'quality.lint':
                        return { ok: false, exitCode: 2, stdout: 'not-json lint output', stderr: 'eslint crashed' };
                    case 'quality.typecheck_node':
                    case 'quality.typecheck_browser':
                    case 'quality.prettier_check':
                    case 'quality.ts_ignore_scan':
                        return { ok: true, exitCode: 0, stdout: '', stderr: '' };
                    default:
                        return { ok: true, exitCode: 0, stdout: '', stderr: '' };
                }
            },
        }),
    );

    assert.ok(calls.includes('quality.lint'));
    assert.equal(result.telemetry.strategy, 'full');
    assert.equal(result.telemetry.gates.lint_ok, false);
    assert.equal(result.findings.filter((/** @type {any} */ f) => f.source_tool === 'quality:eslint').length, 0);
    assert.ok(result.warnings.some((/** @type {any} */ w) => w.source === 'quality:lint' && /eslint/i.test(w.message)));
});
