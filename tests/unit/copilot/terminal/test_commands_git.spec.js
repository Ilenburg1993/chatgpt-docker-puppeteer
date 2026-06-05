// @ts-check

import { beforeEach, describe, expect, it, vi } from 'vitest';

const bridgeMocks = vi.hoisted(() => ({
    formatBranch: vi.fn(() => ''),
    formatLog: vi.fn(() => ''),
    formatStatus: vi.fn(() => ''),
    gitBranch: vi.fn(async () => []),
    gitDiff: vi.fn(async () => ''),
    gitLog: vi.fn(async () => []),
    gitPull: vi.fn(async () => ''),
    gitStash: vi.fn(async () => ''),
    gitStashList: vi.fn(async () => ''),
    gitStatus: vi.fn(async () => []),
}));

vi.mock('#copilot/bridges', () => bridgeMocks);

import { cmdGit } from '../../../../src/copilot/terminal/commands/git.js';

function mockCtx() {
    /** @type {string[]} */
    const lines = [];
    const println = (/** @type {string} */ line) => lines.push(line);
    return { println, output: () => lines.join('\n') };
}

const SAMPLE_DIFF = [
    'diff --git a/a.txt b/a.txt',
    'index 1111111..2222222 100644',
    '--- a/a.txt',
    '+++ b/a.txt',
    '@@ -1 +1 @@',
    '-old',
    '+new',
].join('\n');

describe('terminal/commands/git', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renderiza /git diff com preview canônico e fallback explícito', async () => {
        bridgeMocks.gitDiff.mockResolvedValueOnce(SAMPLE_DIFF);
        const ctx = mockCtx();

        await cmdGit({ println: ctx.println }, ['diff', '--plain']);

        expect(bridgeMocks.gitDiff).toHaveBeenCalledWith({ staged: false, file: undefined });
        expect(ctx.output()).toContain('Git diff');
        expect(ctx.output()).toContain('Preview');
        expect(ctx.output()).toContain('js · fallback: diff externo desativado');
        expect(ctx.output()).toContain('-old');
        expect(ctx.output()).toContain('+new');
        expect(ctx.output()).not.toContain('Gerando diff…');
    });

    it('informa diff vazio sem imprimir bloco antigo', async () => {
        bridgeMocks.gitDiff.mockResolvedValueOnce('');
        const ctx = mockCtx();

        await cmdGit({ println: ctx.println }, ['diff']);

        expect(ctx.output()).toContain('sem diferenças');
        expect(ctx.output()).not.toContain('Sem diferenças.');
    });

    it('renderiza status com presenter do terminal, sem formatStatus ANSI do bridge', async () => {
        bridgeMocks.gitStatus.mockResolvedValueOnce([
            { xy: ' M', path: '.codex/config.toml', label: 'unstaged:modificado', color: '\x1b[33m' },
            { xy: '??', path: 'tmp/new-file.txt', label: 'unstaged:não rastreado', color: '\x1b[90m' },
        ]);
        const ctx = mockCtx();

        await cmdGit({ println: ctx.println }, ['status']);

        expect(bridgeMocks.formatStatus).not.toHaveBeenCalled();
        expect(ctx.output()).toContain('Git status');
        expect(ctx.output()).toContain('.codex/config.toml');
        expect(ctx.output()).toContain('worktree modificado');
        expect(ctx.output()).toContain('não rastreado');
        expect(ctx.output()).not.toContain('unstaged:');
    });

    it('renderiza log e branches sem formatadores ANSI compartilhados', async () => {
        bridgeMocks.gitLog.mockResolvedValueOnce([
            {
                abbrevHash: 'abc1234',
                subject: 'Improve terminal UX',
                authorName: 'Codex',
                authorDate: 'há 1 minuto',
                refNames: 'HEAD -> main',
            },
        ]);
        bridgeMocks.gitBranch.mockResolvedValueOnce([
            { name: 'main', current: true, upstream: 'origin/main', lastCommit: 'abc1234' },
        ]);
        const ctx = mockCtx();

        await cmdGit({ println: ctx.println }, ['log', '1']);
        await cmdGit({ println: ctx.println }, ['branch']);

        expect(bridgeMocks.formatLog).not.toHaveBeenCalled();
        expect(bridgeMocks.formatBranch).not.toHaveBeenCalled();
        expect(ctx.output()).toContain('Improve terminal UX');
        expect(ctx.output()).toContain('HEAD -> main');
        expect(ctx.output()).toContain('upstream origin/main');
        expect(ctx.output()).toContain('atual');
    });
});
