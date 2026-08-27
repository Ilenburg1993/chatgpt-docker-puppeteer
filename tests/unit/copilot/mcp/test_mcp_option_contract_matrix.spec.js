// @ts-check

import { projectMcpToolOptionPolicy } from '#copilot/mcp/public/tools/catalog';
import { readMcpToolOptionContractsForTests } from '#copilot/testing/mcp/tools/option-contracts';
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

const contracts = readMcpToolOptionContractsForTests();

/** @param {Record<string, any>} rule */
function allowedModes(rule) {
    if (rule.kind === 'presence') return [rule.presentMode, rule.absentMode];
    if (rule.kind === 'enum') return [...rule.allowedModes, ...(rule.defaultMode ? [rule.defaultMode] : [])];
    if (rule.kind === 'boolean') return [rule.trueMode, rule.falseMode, rule.defaultMode];
    if (rule.kind === 'constant') return [rule.mode];
    return ['dry-run', 'apply'];
}

/** @param {Record<string, any>} rule @param {string} mode */
function selectMode(rule, mode) {
    if (rule.kind === 'presence') return mode === rule.presentMode ? { [rule.option]: [{}] } : {};
    if (rule.kind === 'enum') return { [rule.option]: mode };
    if (rule.kind === 'boolean') {
        if (mode === rule.trueMode) return { [rule.option]: true };
        if (mode === rule.falseMode) return { [rule.option]: false };
        return {};
    }
    if (rule.kind === 'dry-run-confirm') {
        return mode === 'apply' ? { dryRun: false, confirmBatch: true } : { dryRun: true };
    }
    return {};
}

/** @param {string} toolName @param {Record<string, unknown>} args */
function policy(toolName, args) {
    const projected = projectMcpToolOptionPolicy(toolName, args);
    assert.ok(projected, `${toolName} should be covered`);
    return projected;
}

describe('MCP Option Contract generated matrix', () => {
    it('keeps every mode-scoped option fail-closed and removes ignore as a current contract policy', () => {
        let modeScopedOptions = 0;
        for (const [toolName, rawContract] of Object.entries(contracts)) {
            const contract = /** @type {Record<string, any>} */ (rawContract);
            for (const [optionName, rawDescriptor] of Object.entries(
                /** @type {Record<string, any>} */ (contract.options),
            )) {
                const descriptor = /** @type {Record<string, any>} */ (rawDescriptor);
                if (!Array.isArray(descriptor.activeIn) || descriptor.activeIn.length === 0) continue;
                assert.equal(descriptor.inactivePolicy, 'reject', `${toolName}.${optionName}`);
                modeScopedOptions += 1;
            }
            for (const rule of contract.normalization ?? []) {
                if (rule.kind === 'alias-precedence') {
                    assert.equal(rule.divergencePolicy, 'reject-divergence', `${toolName} alias divergence`);
                }
            }
        }
        assert.ok(modeScopedOptions >= 40, `expected broad mode-scoped coverage, got ${modeScopedOptions}`);
    });

    it('rejects every mode-scoped option in every inactive mode without silent ignore', () => {
        let generatedCases = 0;
        for (const [toolName, rawContract] of Object.entries(contracts)) {
            const contract = /** @type {Record<string, any>} */ (rawContract);
            const modeRule = /** @type {Record<string, any>} */ (contract.mode);
            for (const [optionName, rawDescriptor] of Object.entries(
                /** @type {Record<string, any>} */ (contract.options),
            )) {
                const descriptor = /** @type {Record<string, any>} */ (rawDescriptor);
                if (!Array.isArray(descriptor.activeIn) || descriptor.activeIn.length === 0) continue;
                if (modeRule.option === optionName) continue;
                for (const mode of allowedModes(modeRule).filter(
                    (candidate) => !descriptor.activeIn.includes(candidate),
                )) {
                    const args = { ...selectMode(modeRule, mode), [optionName]: true };
                    const projected = policy(toolName, args);
                    assert.equal(projected.optionMode, mode, `${toolName}.${optionName} mode`);
                    assert.equal(projected.optionIgnoredCount, 0, `${toolName}.${optionName} must not silently ignore`);
                    assert.ok(projected.optionRejectedCount >= 1, `${toolName}.${optionName} should reject in ${mode}`);
                    generatedCases += 1;
                }
            }
        }
        assert.ok(generatedCases >= 30, `expected broad generated coverage, got ${generatedCases}`);
    });

    it('rejects every requires-bound option when its prerequisite is absent', () => {
        let generatedCases = 0;
        for (const [toolName, rawContract] of Object.entries(contracts)) {
            const contract = /** @type {Record<string, any>} */ (rawContract);
            const modeRule = /** @type {Record<string, any>} */ (contract.mode);
            for (const [optionName, rawDescriptor] of Object.entries(
                /** @type {Record<string, any>} */ (contract.options),
            )) {
                const descriptor = /** @type {Record<string, any>} */ (rawDescriptor);
                if (typeof descriptor.requires !== 'string') continue;
                const mode =
                    Array.isArray(descriptor.activeIn) && descriptor.activeIn.length > 0
                        ? descriptor.activeIn[0]
                        : allowedModes(modeRule)[0];
                const args = { ...selectMode(modeRule, mode), [optionName]: true };
                delete args[descriptor.requires];
                const projected = policy(toolName, args);
                assert.equal(projected.optionIgnoredCount, 0, `${toolName}.${optionName} must not silently ignore`);
                assert.ok(
                    projected.optionRejectedCount >= 1,
                    `${toolName}.${optionName} requires ${descriptor.requires}`,
                );
                generatedCases += 1;
            }
        }
        assert.ok(generatedCases >= 2, `expected requires coverage, got ${generatedCases}`);
    });

    it('keeps normalization/coercion projections deterministic under repeated evaluation', () => {
        const scenarios = [
            ['repo_search_text', { query: 'alpha' }],
            ['repo_search_text', { pattern: 'same', query: 'same' }],
            [
                'repo_apply_patch_batch',
                {
                    operations: [{ path: 'a', old_string: 'x', new_string: 'y', includeDiffPreview: true }],
                    resultMode: 'compact',
                },
            ],
            [
                'repo_apply_patch_batch',
                {
                    operations: [{ path: 'a', old_string: 'x', new_string: 'y', includeDiffPreview: true }],
                },
            ],
        ];
        for (const [toolName, args] of scenarios) {
            const first = policy(/** @type {string} */ (toolName), /** @type {Record<string, unknown>} */ (args));
            const second = policy(/** @type {string} */ (toolName), /** @type {Record<string, unknown>} */ (args));
            assert.deepEqual(second, first);
        }
    });

    it('covers the critical patch mode/result/post-validation combinations from the roadmap', () => {
        const dryRunConfirm = policy('repo_apply_patch_batch', {
            operations: [{}],
            dryRun: true,
            confirmBatch: true,
        });
        assert.equal(dryRunConfirm.optionMode, 'dry-run');
        assert.equal(dryRunConfirm.optionRejectedCount, 1);

        const applyExecution = policy('repo_apply_patch_batch', {
            operations: [{}],
            dryRun: false,
            confirmBatch: true,
            applyMode: 'global-preflight',
            failureMode: 'fail-fast',
            targetConcurrency: 2,
        });
        assert.equal(applyExecution.optionMode, 'apply');
        assert.equal(applyExecution.optionRejectedCount, 0);
        assert.equal(applyExecution.optionIgnoredCount, 0);

        const coercedResult = policy('repo_apply_patch_batch', {
            operations: [{ includeDiffPreview: true }],
            resultMode: 'compact',
        });
        assert.equal(coercedResult.optionCoercedCount, 1);

        const partialWithoutValidator = policy('repo_apply_patch_batch', {
            operations: [{}],
            dryRun: false,
            confirmBatch: true,
            postValidateOnPartial: true,
        });
        assert.equal(partialWithoutValidator.optionRejectedCount, 1);

        const partialWithValidator = policy('repo_apply_patch_batch', {
            operations: [{}],
            dryRun: false,
            confirmBatch: true,
            postValidate: [{ validator: 'typecheck' }],
            postValidateOnPartial: true,
        });
        assert.equal(partialWithValidator.optionRejectedCount, 0);
    });
});
