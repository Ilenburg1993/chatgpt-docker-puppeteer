// @ts-check
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseJsonFromMixedOutput } from '../../../scripts/audit/lib/exec.mjs';

test('parseJsonFromMixedOutput parses final valid JSON block with noisy logs', () => {
    const mixed = [
        '[dotenv@17.2.4] injecting env (0) from .env -- tip: { override: true }',
        '(node:1) Warning: NO_COLOR ignored',
        '{"ok":false,"temp":true}',
        'some random non-json line',
        '{"ok":true,"available":true,"nested":{"x":1}}',
        '(node:2) trailing warning',
    ].join('\n');

    const parsed = parseJsonFromMixedOutput(mixed);
    assert.ok(parsed && typeof parsed === 'object');
    assert.equal(parsed.ok, true);
    assert.equal(parsed.available, true);
});

test('parseJsonFromMixedOutput can prefer first valid block', () => {
    const mixed = '{"ok":false}\n{"ok":true}';
    const first = parseJsonFromMixedOutput(mixed, { preferLast: false });
    assert.equal(first?.ok, false);
});

test('parseJsonFromMixedOutput returns null for invalid payload', () => {
    const parsed = parseJsonFromMixedOutput('no json here\nand { broken');
    assert.equal(parsed, null);
});

test('parseJsonFromMixedOutput parses JSON array blocks from noisy output', () => {
    const mixed = ['(node:1) warning', 'random log', '[["src/a.js","src/b.js"],["src/c.js","src/d.js"]]', 'tail'].join(
        '\n',
    );

    const parsed = parseJsonFromMixedOutput(mixed);
    assert.ok(Array.isArray(parsed));
    assert.equal(parsed.length, 2);
});
