// @ts-check
/**
 * tests/unit/copilot/bridges/test_gh_shared.spec.js
 *
 * F177: Testes para gh/shared.js — helpers puros do GitHub CLI bridge.
 */

import assert from 'node:assert/strict';

import { calcFetchLimit, fmtDate, runIcon, slicePage } from '../../../../src/copilot/bridges/gh/shared.js';

describe('gh/shared fmtDate', () => {
    it('retorna string vazia para input vazio', () => {
        assert.strictEqual(fmtDate(''), '');
    });

    it('formata minutos recentes', () => {
        const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
        const result = fmtDate(fiveMinAgo);
        assert.ok(result.includes('min'));
    });

    it('formata horas recentes', () => {
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
        const result = fmtDate(twoHoursAgo);
        assert.ok(result.includes('h'));
    });

    it('formata dias recentes', () => {
        const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60_000).toISOString();
        const result = fmtDate(fiveDaysAgo);
        assert.ok(result.includes('d'));
    });

    it('formata datas antigas como localeDateString', () => {
        const result = fmtDate('2020-01-15T00:00:00Z');
        // Deve ser uma data absoluta (não relativa)
        assert.ok(!result.includes('min'));
        assert.ok(!result.includes('h'));
    });
});

describe('gh/shared runIcon', () => {
    it('success', () => assert.strictEqual(runIcon('completed', 'success'), '✅'));
    it('failure', () => assert.strictEqual(runIcon('completed', 'failure'), '❌'));
    it('cancelled', () => assert.strictEqual(runIcon('completed', 'cancelled'), '🚫'));
    it('in_progress', () => assert.strictEqual(runIcon('in_progress', null), '⏳'));
    it('queued', () => assert.strictEqual(runIcon('queued', null), '🔲'));
    it('unknown', () => assert.strictEqual(runIcon('other', null), '❓'));
});

describe('gh/shared slicePage', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

    it('primeira página retorna itens corretos', () => {
        const result = slicePage(items, { page: 1, pageSize: 3 });
        assert.deepStrictEqual(result.items, ['a', 'b', 'c']);
        assert.strictEqual(result.hasMore, true);
        assert.strictEqual(result.page, 1);
    });

    it('última página sem hasMore', () => {
        const result = slicePage(items, { page: 3, pageSize: 3 });
        assert.deepStrictEqual(result.items, ['g']);
        assert.strictEqual(result.hasMore, false);
    });

    it('página além do range retorna array vazio', () => {
        const result = slicePage(items, { page: 10, pageSize: 3 });
        assert.deepStrictEqual(result.items, []);
        assert.strictEqual(result.hasMore, false);
    });
});

describe('gh/shared calcFetchLimit', () => {
    it('calcula limit para page 1 / pageSize 10', () => {
        const limit = calcFetchLimit({ page: 1, pageSize: 10 });
        assert.strictEqual(limit, 11);
    });

    it('cap em 1000', () => {
        const limit = calcFetchLimit({ page: 100, pageSize: 100 });
        assert.strictEqual(limit, 1000);
    });
});
