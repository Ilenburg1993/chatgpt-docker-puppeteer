// @ts-check
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { estimateStructuredTextResultBytes, getResultSizeHint, okResult, withResultSizeHint } from '#copilot/mcp/control-plane';

describe('MCP result helpers', () => {
    it('keeps result-size hints outside enumerable payload fields', () => {
        const result = withResultSizeHint(okResult({ success: true, value: 'ok' }), {
            bytes: 123,
            strategy: 'conservative-estimate',
            source: 'unit-test',
        });

        assert.equal(getResultSizeHint(result)?.bytes, 123);
        assert.equal(Object.keys(result).includes('unit-test'), false);
        assert.equal(JSON.stringify(result).includes('unit-test'), false);
    });

    it('returns a finite size estimate for structured text results', () => {
        const bytes = estimateStructuredTextResultBytes({ success: true, value: 'x'.repeat(32) }, 'visible text');
        assert.equal(Number.isFinite(bytes), true);
        assert.ok(bytes > Buffer.byteLength('visible text', 'utf8'));
    });
});
