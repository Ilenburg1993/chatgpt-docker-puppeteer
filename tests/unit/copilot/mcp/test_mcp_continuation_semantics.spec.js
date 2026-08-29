// @ts-check

import { createComposedMcpProcessHost } from '#copilot/mcp/public/composition/process-host';
import { createMcpToolOperationContext, getResultExecutionHint } from '#copilot/mcp/public/protocol/tools';
import { getCanonicalMcpTools } from '#copilot/mcp/public/registry';
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

const PROCESS_HOST = createComposedMcpProcessHost({
    hostId: 'mcp-continuation-semantics-test',
    backgroundServices: false,
});
const OPERATION_CONTEXT = createMcpToolOperationContext(
    {
        mcpReq: {
            id: 'mcp-continuation-semantics-test',
            method: 'tools/call',
            signal: new AbortController().signal,
            _meta: { caller: 'test_mcp_continuation_semantics' },
            envelope: { protocol: '2026' },
        },
    },
    { workspace: PROCESS_HOST.workspace, config: PROCESS_HOST.processConfig.toolConfig },
);

function tool(name) {
    const definition = getCanonicalMcpTools().find((candidate) => candidate.name === name);
    assert.ok(definition, `missing tool ${name}`);
    return {
        ...definition,
        handler: (input) => definition.handler(input, OPERATION_CONTEXT),
    };
}

describe('MCP continuation semantics', () => {
    it('treats a search cursor as optional continuation rather than transport-required work', async () => {
        const result = await tool('repo_search_text').handler({
            batch: [{ query: 'import', path: 'src/copilot/mcp', maxResults: 1 }],
            batchResultBudgetBytes: 1024 * 1024,
        });
        assert.equal(result.isError, undefined);
        const rows = /** @type {Record<string, unknown>[]} */ (result.structuredContent?.['results']);
        assert.equal(rows.length, 1);
        assert.equal(typeof rows[0]?.['nextCursor'], 'string');
        const hint = getResultExecutionHint(result);
        assert.equal(hint?.continuationAvailable, true);
        assert.equal(hint?.continuationAvailableOperations, 1);
        assert.equal(hint?.continuationRecommended, true);
        assert.equal(hint?.continuationRecommendedOperations, 1);
        assert.equal(hint?.continuationTransportRequired, undefined);
        assert.equal(hint?.continuationTransportRequiredOperations, undefined);
    });

    it('marks payload-budget truncation as transport-required continuation', async () => {
        const batch = Array.from({ length: 32 }, () => ({
            path: 'src/copilot/mcp/tools/repo-read.js',
            hashMode: 'none',
        }));
        const result = await tool('repo_read_file').handler({
            batch,
            batchConcurrency: 8,
            batchResultBudgetBytes: 1024 * 1024,
        });
        assert.equal(result.isError, undefined);
        assert.ok(Number(result.structuredContent?.['payloadTruncatedCount'] ?? 0) > 0);
        const hint = getResultExecutionHint(result);
        assert.equal(hint?.continuationAvailable, true);
        assert.ok(Number(hint?.continuationAvailableOperations ?? 0) > 0);
        assert.equal(hint?.continuationTransportRequired, true);
        assert.ok(Number(hint?.continuationTransportRequiredOperations ?? 0) > 0);
        assert.equal(hint?.continuationRecommended, true);
        assert.ok(Number(hint?.continuationRecommendedOperations ?? 0) > 0);
    });

    it('omits structural outline arrays atomically and preserves same-page recovery when the batch budget is exhausted', async () => {
        const batch = Array.from({ length: 24 }, () => ({
            path: 'src/copilot/mcp/tools/repo-read.js',
            maxItems: 500,
            maxBytes: 64 * 1024,
        }));
        const result = await tool('repo_file_outline').handler({
            batch,
            batchConcurrency: 8,
            batchResultBudgetBytes: 64 * 1024,
        });
        assert.equal(result.isError, undefined);
        assert.ok(Number(result.structuredContent?.['payloadTruncatedCount'] ?? 0) > 0);
        assert.ok(Number(result.structuredContent?.['resultBytes'] ?? Infinity) <= 64 * 1024);
        const rows = /** @type {Record<string, unknown>[]} */ (result.structuredContent?.['results']);
        const omitted = rows.find((row) => row['payloadOmittedForBatchBudget'] === true);
        assert.ok(omitted);
        assert.deepEqual(omitted['symbols'], []);
        assert.equal('payloadRecoveryCursor' in omitted, true);
        assert.equal(
            omitted['payloadRecoveryStrategy'],
            'repeat-same-page-with-larger-batch-budget-or-single-call',
        );
        const hint = getResultExecutionHint(result);
        assert.equal(hint?.continuationTransportRequired, true);
        assert.ok(Number(hint?.continuationTransportRequiredOperations ?? 0) > 0);
    });
});
