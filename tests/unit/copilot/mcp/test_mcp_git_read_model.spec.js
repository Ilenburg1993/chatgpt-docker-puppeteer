// @ts-check

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
    normalizeGitPickaxe,
    normalizeGitRevision,
    parseGitBlameLinePorcelain,
    parseGitLogRecords,
    parseGitLsTreeZ,
    parseGitNameStatusZ,
    parseGitStatusPorcelainV2Z,
    parseGitWorktreePorcelainZ,
} from '#copilot/mcp/public/workspace/git';

describe('MCP Git read model', () => {
    it('parses porcelain v2 branch headers and NUL-safe ordinary/rename/unmerged/untracked rows', () => {
        const output = [
            '# branch.oid 0123456789abcdef0123456789abcdef01234567',
            '# branch.head main',
            '# branch.upstream origin/main',
            '# branch.ab +3 -2',
            '# stash 4',
            '1 .M N... 100644 100644 100644 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa src/a.js',
            '2 R. N... 100644 100644 100644 bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb cccccccccccccccccccccccccccccccccccccccc R087 src/new name.js',
            'src/old name.js',
            'u UU N... 100644 100644 100644 100644 dddddddddddddddddddddddddddddddddddddddd eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee ffffffffffffffffffffffffffffffffffffffff src/conflict.js',
            '? src/untracked file.js',
            '! dist/generated.js',
            '',
        ].join('\0');

        const parsed = parseGitStatusPorcelainV2Z(output);
        assert.deepEqual(parsed.branch, {
            oid: '0123456789abcdef0123456789abcdef01234567',
            head: 'main',
            upstream: 'origin/main',
            ahead: 3,
            behind: 2,
            stashCount: 4,
        });
        assert.equal(parsed.uncertain, false);
        assert.deepEqual(parsed.entries, [
            {
                kind: 'ordinary',
                path: 'src/a.js',
                indexStatus: '.',
                worktreeStatus: 'M',
                submodule: 'N...',
            },
            {
                kind: 'renamed',
                path: 'src/new name.js',
                indexStatus: 'R',
                worktreeStatus: '.',
                submodule: 'N...',
                originalPath: 'src/old name.js',
                score: 87,
            },
            {
                kind: 'unmerged',
                path: 'src/conflict.js',
                indexStatus: 'U',
                worktreeStatus: 'U',
                submodule: 'N...',
            },
            {
                kind: 'untracked',
                path: 'src/untracked file.js',
                indexStatus: '?',
                worktreeStatus: '?',
                submodule: null,
            },
            {
                kind: 'ignored',
                path: 'dist/generated.js',
                indexStatus: '!',
                worktreeStatus: '!',
                submodule: null,
            },
        ]);
    });

    it('parses name-status rename/copy triples without losing NUL-safe paths', () => {
        const parsed = parseGitNameStatusZ(
            ['M', 'src/a file.js', 'R091', 'src/old.js', 'src/new.js', 'C100', 'src/base.js', 'src/copy.js', 'D', 'src/dead.js', ''].join('\0'),
        );
        assert.equal(parsed.uncertain, false);
        assert.deepEqual(parsed.changes, [
            { status: 'M', code: 'M', path: 'src/a file.js', deleted: false },
            { status: 'R091', code: 'R', path: 'src/new.js', oldPath: 'src/old.js', score: 91, deleted: false },
            { status: 'C100', code: 'C', path: 'src/copy.js', oldPath: 'src/base.js', score: 100, deleted: false },
            { status: 'D', code: 'D', path: 'src/dead.js', deleted: true },
        ]);
    });

    it('enforces revision atoms instead of accepting caller-composed ranges or option injection', () => {
        for (const revision of ['HEAD', 'HEAD~2', 'origin/main', 'refs/tags/v1.2.3', '@{u}', 'abc1234']) {
            assert.equal(normalizeGitRevision(revision), revision);
        }
        for (const revision of ['--all', 'HEAD..main', 'HEAD...main', 'HEAD main', 'HEAD:path', '', 'a\u0000b']) {
            assert.throws(() => normalizeGitRevision(revision), /** @param {unknown} error */ (error) => {
                assert.equal(/** @type {{code?:string}} */ (error).code, 'ERR_GIT_REVISION');
                return true;
            });
        }
        assert.equal(normalizeGitPickaxe('needle.*value', 'searchRegex'), 'needle.*value');
        assert.throws(() => normalizeGitPickaxe('', 'searchString'));
    });

    it('parses structured commit records without line-oriented ambiguity', () => {
        const row = [
            '0123456789abcdef0123456789abcdef01234567',
            '0123456',
            'Ada Lovelace',
            'ada@example.test',
            '2026-08-28T20:00:00-03:00',
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            'subject with spaces',
        ].join('\u001f');
        const parsed = parseGitLogRecords(`${row}\0`);
        assert.equal(parsed.uncertain, false);
        assert.deepEqual(parsed.commits, [
            {
                hash: '0123456789abcdef0123456789abcdef01234567',
                shortHash: '0123456',
                authorName: 'Ada Lovelace',
                authorEmail: 'ada@example.test',
                authoredAt: '2026-08-28T20:00:00-03:00',
                parents: [
                    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                ],
                subject: 'subject with spaces',
            },
        ]);
    });

    it('parses worktree porcelain groups including detached/locked state', () => {
        const parsed = parseGitWorktreePorcelainZ(
            [
                'worktree /repo',
                'HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                'branch refs/heads/main',
                '',
                'worktree /repo/.worktrees/feature',
                'HEAD bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                'detached',
                'locked maintenance',
                '',
            ].join('\0'),
        );
        assert.equal(parsed.uncertain, false);
        assert.deepEqual(parsed.worktrees, [
            {
                path: '/repo',
                head: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                branch: 'refs/heads/main',
                detached: false,
                bare: false,
                locked: false,
                prunable: false,
            },
            {
                path: '/repo/.worktrees/feature',
                head: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                branch: null,
                detached: true,
                bare: false,
                locked: 'maintenance',
                prunable: false,
            },
        ]);
    });

    it('parses NUL-safe ls-tree records including tree and blob sizes', () => {
        const parsed = parseGitLsTreeZ(
            [
                '040000 tree 0123456789abcdef0123456789abcdef01234567       -\tsrc',
                '100644 blob fedcba9876543210fedcba9876543210fedcba98      42\tREADME.md',
                '',
            ].join('\0'),
        );
        assert.equal(parsed.uncertain, false);
        assert.deepEqual(parsed.entries, [
            {
                mode: '040000',
                type: 'tree',
                object: '0123456789abcdef0123456789abcdef01234567',
                size: null,
                path: 'src',
            },
            {
                mode: '100644',
                type: 'blob',
                object: 'fedcba9876543210fedcba9876543210fedcba98',
                size: 42,
                path: 'README.md',
            },
        ]);
    });

    it('parses line-porcelain blame metadata and content', () => {
        const parsed = parseGitBlameLinePorcelain(
            [
                '0123456789abcdef0123456789abcdef01234567 7 9 1',
                'author Ada Lovelace',
                'author-mail <ada@example.test>',
                'author-time 1787958000',
                'author-tz -0300',
                'committer-time 1787958000',
                'summary Introduce invariant',
                'filename src/a.js',
                '\tconst invariant = true;',
                '',
            ].join('\n'),
        );
        assert.equal(parsed.uncertain, false);
        assert.deepEqual(parsed.lines, [
            {
                commit: '0123456789abcdef0123456789abcdef01234567',
                originalLine: 7,
                finalLine: 9,
                groupLines: 1,
                author: 'Ada Lovelace',
                authorMail: '<ada@example.test>',
                authorTime: 1787958000,
                authorTz: '-0300',
                committerTime: 1787958000,
                summary: 'Introduce invariant',
                filename: 'src/a.js',
                previous: null,
                content: 'const invariant = true;',
            },
        ]);
    });
});
