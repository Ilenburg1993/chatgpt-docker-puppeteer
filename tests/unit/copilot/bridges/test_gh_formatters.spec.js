// @ts-check
import { describe, it } from 'node:test';
/**
 * tests/unit/copilot/bridges/test_gh_formatters.spec.js
 *
 * Testes para funções puras de formatação em gh/issues.js, gh/prs.js, gh/ci.js e gh/index.js.
 */

import { formatRunList } from '../../../../src/copilot/bridges/gh/ci.js';
import { formatReleaseList } from '../../../../src/copilot/bridges/gh/index.js';
import { formatIssueList } from '../../../../src/copilot/bridges/gh/issues.js';
import { formatPrList } from '../../../../src/copilot/bridges/gh/prs.js';

// ─── formatIssueList ──────────────────────────────────────────────────────────

describe('gh formatIssueList', () => {
    it('retorna mensagem vazia para array vazio', () => {
        expect(formatIssueList([])).toContain('nenhuma issue');
    });

    it('formata issue open com labels', () => {
        const issues = [
            {
                number: 42,
                title: 'Bug crítico no login',
                state: 'open',
                labels: [{ name: 'bug' }, { name: 'critical' }],
                author: { login: 'dev1' },
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            },
        ];
        const result = formatIssueList(issues);
        expect(result).toContain('#42');
        expect(result).toContain('[bug]');
        expect(result).toContain('dev1');
    });

    it('formata issue closed', () => {
        const issues = [
            {
                number: 10,
                title: 'Feature request',
                state: 'closed',
                labels: [],
                author: { login: 'user' },
                createdAt: '2024-01-01T00:00:00Z',
                updatedAt: '2024-01-02T00:00:00Z',
            },
        ];
        const result = formatIssueList(issues);
        expect(result).toContain('#10');
        expect(result).toContain('closed');
    });

    it('trunca título longo', () => {
        const issues = [
            {
                number: 1,
                title: 'A'.repeat(100),
                state: 'open',
                labels: [],
                author: { login: 'a' },
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            },
        ];
        const result = formatIssueList(issues);
        // título é truncado para 50 chars
        expect(result).not.toContain('A'.repeat(100));
    });
});

// ─── formatPrList ─────────────────────────────────────────────────────────────

describe('gh formatPrList', () => {
    it('retorna mensagem vazia para array vazio', () => {
        expect(formatPrList([])).toContain('nenhum PR');
    });

    it('formata PR open com branch e autor', () => {
        const prs = [
            {
                number: 99,
                title: 'Add dark mode',
                state: 'open',
                headRefName: 'feature/dark-mode',
                author: { login: 'designer' },
                isDraft: false,
                createdAt: new Date().toISOString(),
                mergeable: 'MERGEABLE',
            },
        ];
        const result = formatPrList(prs);
        expect(result).toContain('#99');
        expect(result).toContain('dark-mode');
        expect(result).toContain('designer');
    });

    it('marca draft PR', () => {
        const prs = [
            {
                number: 5,
                title: 'WIP: draft',
                state: 'open',
                headRefName: 'wip',
                author: { login: 'x' },
                isDraft: true,
                createdAt: new Date().toISOString(),
                mergeable: 'UNKNOWN',
            },
        ];
        const result = formatPrList(prs);
        expect(result).toContain('rascunho');
    });

    it('formata PR merged', () => {
        const prs = [
            {
                number: 3,
                title: 'Final',
                state: 'merged',
                headRefName: 'main',
                author: { login: 'dev' },
                isDraft: false,
                createdAt: '2024-06-01T00:00:00Z',
                mergeable: 'MERGEABLE',
            },
        ];
        const result = formatPrList(prs);
        expect(result).toContain('merged');
    });
});

// ─── formatRunList ────────────────────────────────────────────────────────────

describe('gh formatRunList', () => {
    it('retorna mensagem vazia para array vazio', () => {
        expect(formatRunList([])).toContain('nenhum run');
    });

    it('formata run com status e conclusion', () => {
        const runs = [
            {
                databaseId: 12345,
                name: 'CI Pipeline',
                status: 'completed',
                conclusion: 'success',
                event: 'push',
                createdAt: new Date().toISOString(),
                headBranch: 'main',
            },
        ];
        const result = formatRunList(runs);
        expect(result).toContain('#12345');
        expect(result).toContain('CI Pipeline');
        expect(result).toContain('main');
    });

    it('formata run in_progress sem conclusion', () => {
        const runs = [
            {
                databaseId: 67890,
                name: 'Tests',
                status: 'in_progress',
                conclusion: null,
                event: 'pull_request',
                createdAt: new Date().toISOString(),
                headBranch: 'feature/x',
            },
        ];
        const result = formatRunList(runs);
        expect(result).toContain('#67890');
    });
});

// ─── formatReleaseList ────────────────────────────────────────────────────────

describe('gh formatReleaseList', () => {
    it('retorna mensagem vazia para array vazio', () => {
        expect(formatReleaseList([])).toContain('nenhuma release');
    });

    it('formata release com tag e nome', () => {
        const releases = [
            {
                tagName: 'v1.0.0',
                name: 'First Release',
                isPrerelease: false,
                publishedAt: new Date().toISOString(),
            },
        ];
        const result = formatReleaseList(releases);
        expect(result).toContain('v1.0.0');
        expect(result).toContain('First Release');
    });

    it('marca pre-release', () => {
        const releases = [
            {
                tagName: 'v2.0.0-beta.1',
                name: 'Beta',
                isPrerelease: true,
                publishedAt: new Date().toISOString(),
            },
        ];
        const result = formatReleaseList(releases);
        expect(result).toContain('[pre]');
    });
});
