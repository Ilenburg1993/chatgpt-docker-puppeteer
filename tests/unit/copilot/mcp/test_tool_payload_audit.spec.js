// @ts-check

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { getCanonicalMcpTools } from '#copilot/mcp/public/registry';

import { buildToolPayloadAudit } from '#copilot/mcp/public/diagnostics/tool-payload';
import { MCP_TOOL_EXECUTION_LIMITS } from '#copilot/mcp/public/protocol/tools';

describe('MCP tools/list payload audit', () => {
    it('measures SDK wire descriptors instead of internal Zod state', async () => {
        const audit = await buildToolPayloadAudit({
            tools: getCanonicalMcpTools(),
            top: 5,
            maxEnvelopeBytes: MCP_TOOL_EXECUTION_LIMITS.toolsList.maxEnvelopeBytes,
        });

        assert.equal(audit['ok'], true);
        assert.equal(audit['measurement'], 'sdk-in-memory-tools/list');
        assert.equal(audit['toolCount'], getCanonicalMcpTools().length);
        assert.equal(audit['withinEnvelopeBudget'], true, JSON.stringify(audit, null, 2));
        assert.ok(Number(audit['budgetHeadroomBytes']) > 1024, JSON.stringify(audit, null, 2));
        assert.ok(Number(audit['totalEnvelopeBytes']) > 100_000);
        assert.equal(audit['maxEnvelopeBytes'], 400 * 1024);
        assert.ok(Number(audit['totalEnvelopeBytes']) < MCP_TOOL_EXECUTION_LIMITS.toolsList.maxEnvelopeBytes);
        assert.ok(Number(audit['budgetHeadroomBytes']) > 0);

        const fieldTotals = /** @type {Record<string, number>} */ (audit['fieldTotals']);
        const inputSchemaBytes = fieldTotals['inputSchemaBytes'];
        const metaBytes = fieldTotals['metaBytes'];
        if (inputSchemaBytes === undefined || metaBytes === undefined) {
            throw new Error('Totais de campos obrigatórios ausentes no relatório.');
        }
        assert.ok(inputSchemaBytes > metaBytes);
        assert.ok(inputSchemaBytes < MCP_TOOL_EXECUTION_LIMITS.toolsList.maxEnvelopeBytes);
        assert.equal('securitySchemesBytes' in fieldTotals, false);

        const topTools = /** @type {Record<string, unknown>[]} */ (audit['topTools']);
        assert.equal(topTools.length, 5);
        assert.ok(Number(topTools[0]?.['totalBytes']) >= Number(topTools.at(-1)?.['totalBytes']));
        assert.ok(Number(topTools[0]?.['totalBytes']) < 32 * 1024);
        assert.ok(Number(topTools[0]?.['totalBytes']) < MCP_TOOL_EXECUTION_LIMITS.toolsList.maxEnvelopeBytes / 4);
    });

    it('reports an exceeded custom budget without failing the read-only audit', async () => {
        const audit = await buildToolPayloadAudit({
            tools: getCanonicalMcpTools(),
            top: 1,
            maxEnvelopeBytes: 100_000,
        });

        assert.equal(audit['ok'], true);
        assert.equal(audit['withinEnvelopeBudget'], false);
        assert.ok(Number(audit['budgetHeadroomBytes']) < 0);
    });
});
