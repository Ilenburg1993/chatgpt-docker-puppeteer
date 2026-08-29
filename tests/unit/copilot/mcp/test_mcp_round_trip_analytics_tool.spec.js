// @ts-check

import { getCanonicalMcpTools } from '#copilot/mcp/public/registry';
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

function roundTripAnalyticsTool() {
    const tool = getCanonicalMcpTools().find((entry) => entry.name === 'mcp_round_trip_analytics');
    assert.ok(tool);
    return tool;
}

describe('MCP round-trip analytics wire projection', () => {
    it('preserves sanitized result outcome analytics produced by the v5 capability', async () => {
        const resultOutcomes = {
            authority: 'sanitized-tool-completion-result-metadata-v5',
            completedCalls: 2,
            observedOutcomeCalls: 2,
            outcomeCoverageRate: 1,
            codedCalls: 1,
            failureCalls: 1,
            optionConfigFailures: 1,
            preconditionFailures: 0,
            domainOrUnknownFailures: 0,
            uncodedFailures: 0,
            optionErrorRate: 0.5,
            optionErrorShareOfFailures: 1,
            byState: { success: 1, 'domain-failure': 1 },
            byClass: { success: 1, 'option-config': 1 },
            byCode: { ERR_TERMINAL_EXEC_SHAPE: 1 },
            byTool: [],
            byRuntimeCohort: {},
        };
        const optionPolicies = {
            authority: 'sanitized-request-option-contract-metadata-v6',
            observedCalls: 2,
            requestedOptions: 4,
            effectiveRequestedOptions: 3,
            defaultedOptions: 6,
            normalizedEvents: 1,
            ignoredOptions: 1,
            coercedOptions: 0,
            rejectedOptions: 0,
            conflictEvents: 0,
            normalizedCalls: 1,
            ignoredCalls: 1,
            coercedCalls: 0,
            rejectedCalls: 0,
            conflictCalls: 0,
            normalizedCallRate: 0.5,
            ignoredCallRate: 0.5,
            coercionCallRate: 0,
            rejectionCallRate: 0,
            conflictCallRate: 0,
            ignoredRequestedOptionRate: 0.25,
            byContractVersion: { '1.1.0': 2 },
            byMode: { single: 1, batch: 1 },
            byTool: [],
            byRuntimeCohort: {},
        };
        const executionPolicies = {
            authority: 'sanitized-effective-execution-policy-metadata-v11',
            eligibleCalls: 3,
            observedCalls: 2,
            coverageRate: 0.6667,
            byPolicyClass: { 'direct-apply': 1, 'dry-run': 1 },
            byFailurePolicyClass: { 'fail-fast': 1, 'best-effort': 1 },
            byConcurrencyClass: { 'parallel-bounded': 1, sequential: 1 },
            byTool: [],
            byRuntimeCohort: {},
            caveat: 'test',
        };
        const recoveryRecipes = {
            authority: 'bounded-recovery-recipe-disposition-counts-from-tool-completion-metadata-v8',
            callsWithRecipe: 1,
            recipeCount: 1,
            retrySafeCount: 1,
            suggestedCount: 0,
            manualCount: 0,
            noRetryCount: 0,
            byTool: [{ tool: 'repo_apply_patch', callsWithRecipe: 1, recipeCount: 1, retrySafeCount: 1 }],
        };
        const exactSelfRepair = {
            authority: 'bounded-exact-patch-self-repair-counts-from-tool-completion-metadata-v9',
            callsWithAttempt: 1,
            attemptedCount: 1,
            succeededCount: 1,
            failedClosedCount: 0,
            successRate: 1,
            failedClosedRate: 0,
            byTool: [],
        };
        const report = {
            schemaVersion: 11,
            normalizerVersion: 11,
            authority: 'test-authority',
            windowMs: 3_600_000,
            includeSynthetic: false,
            indexedRows: 4,
            completeness: {},
            callPairing: {},
            topTransitions: [],
            sequenceEvidence: {},
            failures: {},
            resultOutcomes,
            recoveryRecipes,
            exactSelfRepair,
            optionPolicies,
            retryTax: {},
            recovery: {},
            workflowPressure: {},
            executionAccounting: {},
            executionPolicies,
            payloadAccounting: {},
            runtimeCohorts: {},
            optimizationEvidence: {},
            discontinuities: {},
            toolStarts: [],
            sourceIntegrity: {
                indexSchemaVersion: 11,
                normalizerVersion: 11,
                status: 'materialized',
                cursor: { generationSequence: 1, lastTransition: 'append' },
            },
            queryScope: {
                includeSynthetic: false,
                runtimeSourceBinding: null,
                runtimeEpochId: 'epoch-current',
            },
            ingestion: { ok: true },
        };
        /** @type {Record<string, unknown> | null} */
        let summarizeOptions = null;
        const operationContext = /** @type {import('#copilot/mcp/public/protocol/tools').McpToolOperationContext} */ (
            /** @type {unknown} */ ({
                config: {
                    runtimeSourceGeneration: { runtimeEpochId: 'epoch-current' },
                },
                capabilities: {
                    roundTripAnalytics: {
                        summarize: async (options) => {
                            summarizeOptions = options;
                            return report;
                        },
                    },
                },
            })
        );

        const result = await roundTripAnalyticsTool().handler({}, operationContext);

        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], true);
        assert.deepEqual(result.structuredContent?.['derivedIndex']?.sourceIntegrity, report.sourceIntegrity);
        assert.deepEqual(result.structuredContent?.['analytics']?.resultOutcomes, resultOutcomes);
        assert.deepEqual(result.structuredContent?.['analytics']?.recoveryRecipes, recoveryRecipes);
        assert.deepEqual(result.structuredContent?.['analytics']?.exactSelfRepair, exactSelfRepair);
        assert.deepEqual(result.structuredContent?.['analytics']?.optionPolicies, optionPolicies);
        assert.deepEqual(result.structuredContent?.['analytics']?.executionPolicies, executionPolicies);
        assert.deepEqual(result.structuredContent?.['analytics']?.retryTax, {});
        assert.equal(result.structuredContent?.['analytics']?.generation, 'current');
        assert.deepEqual(result.structuredContent?.['analytics']?.queryScope, report.queryScope);
        assert.equal(summarizeOptions?.['runtimeEpochId'], 'epoch-current');

        summarizeOptions = null;
        const historical = await roundTripAnalyticsTool().handler({ generation: 'all' }, operationContext);
        assert.equal(historical.structuredContent?.['analytics']?.generation, 'all');
        assert.equal(summarizeOptions?.['runtimeEpochId'], undefined);
    });
});
