// @ts-check

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { buildToolPayloadAudit } from '#copilot/mcp/scripts';

describe('MCP tools/list payload audit', () => {
    it('measures SDK wire descriptors instead of internal Zod state', async () => {
        const audit = await buildToolPayloadAudit({ top: 5, maxEnvelopeBytes: 128 * 1024 });

        assert.equal(audit['ok'], true);
        assert.equal(audit['measurement'], 'sdk-in-memory-tools/list');
        assert.equal(audit['toolCount'], 102);
        assert.equal(audit['withinEnvelopeBudget'], true);
        assert.ok(Number(audit['totalEnvelopeBytes']) > 100_000);
        assert.ok(Number(audit['totalEnvelopeBytes']) < 128 * 1024);
        assert.ok(Number(audit['budgetHeadroomBytes']) > 0);

        const fieldTotals = /** @type {Record<string, number>} */ (audit['fieldTotals']);
        assert.ok(fieldTotals['inputSchemaBytes'] > fieldTotals['metaBytes']);
        assert.ok(fieldTotals['inputSchemaBytes'] < 50_000);
        assert.equal('securitySchemesBytes' in fieldTotals, false);

        const topTools = /** @type {Record<string, unknown>[]} */ (audit['topTools']);
        assert.equal(topTools.length, 5);
        assert.equal(topTools[0]?.['name'], 'repo_apply_file_batch');
        assert.ok(Number(topTools[0]?.['totalBytes']) < 4_000);
    });

    it('reports an exceeded custom budget without failing the read-only audit', async () => {
        const audit = await buildToolPayloadAudit({ top: 1, maxEnvelopeBytes: 100_000 });

        assert.equal(audit['ok'], true);
        assert.equal(audit['withinEnvelopeBudget'], false);
        assert.ok(Number(audit['budgetHeadroomBytes']) < 0);
    });
});
