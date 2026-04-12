// @ts-check
/**
 * tests/unit/copilot/bridges/test_git_bridge.spec.js
 *
 * F173: Testes para git-bridge.js — wrappers git CLI. Testa funções puras (format*) e funções async que usam git real
 * (estamos num repo git).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    formatBranch,
    formatLog,
    formatStatus,
    gitBranch,
    gitLog,
    gitStatus,
} from '../../../../src/copilot/bridges/git-bridge.js';

describe('git-bridge formatStatus', () => {
    it('retorna mensagem limpa quando array vazio', () => {
        const result = formatStatus([]);
        assert.ok(result.includes('limpo'));
    });

    it('formata entradas com cor e path', () => {
        /** @type {import('../../../../src/copilot/bridges/git-bridge.js').StatusEntry[]} */
        const entries = [
            { xy: 'M ', path: 'file.js', label: 'staged:modificado', color: '\x1b[33m' },
            { xy: '??', path: 'new.txt', label: 'unstaged:não rastreado', color: '\x1b[90m' },
        ];
        const result = formatStatus(entries);
        assert.ok(result.includes('file.js'));
        assert.ok(result.includes('new.txt'));
    });
});

describe('git-bridge formatLog', () => {
    it('formata log entries com hash e subject', () => {
        const entries = [
            {
                hash: 'abc123full',
                abbrevHash: 'abc123',
                authorName: 'Alice',
                authorDate: '2 hours ago',
                subject: 'fix bug',
                refNames: 'HEAD -> main',
            },
        ];
        const result = formatLog(entries);
        assert.ok(result.includes('abc123'));
        assert.ok(result.includes('fix bug'));
    });

    it('oneline usa formato resumido', () => {
        const entries = [
            {
                hash: 'abc123full',
                abbrevHash: 'abc123',
                authorName: 'Alice',
                authorDate: '2 hours ago',
                subject: 'fix bug',
                refNames: '',
            },
        ];
        const result = formatLog(entries, true);
        assert.ok(result.includes('abc123'));
    });
});

describe('git-bridge formatBranch', () => {
    it('marca branch atual com *', () => {
        const branches = [
            { name: 'main', current: true },
            { name: 'develop', current: false },
        ];
        const result = formatBranch(branches);
        assert.ok(result.includes('*'));
        assert.ok(result.includes('main'));
    });
});

describe('git-bridge async (real git)', () => {
    it('gitStatus retorna array', async () => {
        const result = await gitStatus();
        assert.ok(Array.isArray(result));
    });

    it('gitLog retorna commits', async () => {
        const result = await gitLog({ n: 3 });
        assert.ok(Array.isArray(result));
        assert.ok(result.length > 0, 'deve haver pelo menos 1 commit');
        assert.ok(result[0].hash);
        assert.ok(result[0].subject);
    });

    it('gitBranch retorna pelo menos uma branch', async () => {
        const result = await gitBranch();
        assert.ok(Array.isArray(result));
        assert.ok(result.length > 0);
        const current = result.find((b) => b.current);
        assert.ok(current, 'deve haver uma branch marcada como current');
    });
});
