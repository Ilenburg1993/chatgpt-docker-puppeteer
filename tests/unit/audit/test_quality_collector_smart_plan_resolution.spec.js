// @ts-check
import assert from 'node:assert/strict';

import { collectQualityFindings } from '../../../scripts/audit/collectors/quality.mjs';

test('quality collector smart plan resolves docs-only run with selective execution and telemetry', async () => {
    /** @type {string[]} */
    const calledSteps = [];

    const result = await collectQualityFindings(
        /** @type {any} */ ({
            profile: 'quick',
            changedFiles: ['README.md'],
            qualityMode: 'smart',
            qualityJsdoc: false,
            exec: async (/** @type {any} */ stepId) => {
                calledSteps.push(stepId);
                return { ok: true, exitCode: 0, stdout: '', stderr: '' };
            },
        }),
    );

    assert.deepEqual(result.errors, []);
    assert.equal(result.telemetry.strategy, 'changed-only');
    assert.equal(result.telemetry.risk, 'low');
    assert.ok(result.telemetry.reasons.includes('docs-only changes detected'));
    assert.equal(result.telemetry.gates.lint_ok, null);
    assert.equal(result.telemetry.gates.typecheck_node_ok, null);
    assert.equal(result.telemetry.gates.typecheck_browser_ok, null);
    assert.equal(result.telemetry.gates.prettier_ok, true);
    assert.equal(result.telemetry.gates.jsdoc_delta_ok, null);
    assert.equal(result.telemetry.gates.ts_ignore_ok, true);
    assert.ok(result.telemetry.steps_skipped.some((/** @type {any} */ item) => item.step === 'quality.lint'));
    assert.ok(calledSteps.includes('quality.prettier_check'));
    assert.ok(calledSteps.includes('quality.ts_ignore_scan'));
});
