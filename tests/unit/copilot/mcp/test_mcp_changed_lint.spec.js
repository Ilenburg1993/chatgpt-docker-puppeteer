// @ts-check

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'vitest';
import {
    collectChangedCopilotLintPaths,
    parseNulSeparatedPaths,
    selectChangedCopilotLintPaths,
} from '../../../../scripts/analysis/copilot-changed-lint.mjs';

/** @type {string[]} */
const temporaryRoots = [];

function makeGitRoot() {
    const root = mkdtempSync(path.join(tmpdir(), 'mcp-changed-lint-'));
    temporaryRoots.push(root);
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Changed Lint Test'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'changed-lint@example.invalid'], { cwd: root });
    return root;
}

/** @param {string} root @param {string} relative @param {string} content */
function write(root, relative, content) {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
}

afterEach(() => {
    while (temporaryRoots.length > 0) rmSync(temporaryRoots.pop(), { recursive: true, force: true });
});

describe('Copilot changed lint preflight', () => {
    it('selects only lintable Copilot source/test paths and excludes generated .ai artifacts', () => {
        assert.deepEqual(
            selectChangedCopilotLintPaths([
                './src/copilot/mcp/z.js',
                'src\\copilot\\mcp\\a.ts',
                'src/copilot/.ai/generated.js',
                'tests/unit/copilot/mcp/a.spec.js',
                'tests/unit/other/outside.spec.js',
                'src/copilot/readme.md',
                'src/copilot/mcp/z.js',
            ]),
            ['src/copilot/mcp/a.ts', 'src/copilot/mcp/z.js', 'tests/unit/copilot/mcp/a.spec.js'],
        );
    });

    it('parses NUL-delimited Git output without empty rows', () => {
        assert.deepEqual(parseNulSeparatedPaths('src/copilot/a.js\0tests/unit/copilot/a.spec.js\0'), [
            'src/copilot/a.js',
            'tests/unit/copilot/a.spec.js',
        ]);
    });

    it('collects unstaged, staged and untracked files while excluding deleted tracked files', () => {
        const root = makeGitRoot();
        write(root, 'src/copilot/unstaged.js', 'export const value = 1;\n');
        write(root, 'src/copilot/staged.js', 'export const value = 1;\n');
        write(root, 'src/copilot/deleted.js', 'export const value = 1;\n');
        execFileSync('git', ['add', '.'], { cwd: root });
        execFileSync('git', ['commit', '-qm', 'baseline'], { cwd: root });

        write(root, 'src/copilot/unstaged.js', 'export const value = 2;\n');
        write(root, 'src/copilot/staged.js', 'export const value = 2;\n');
        execFileSync('git', ['add', 'src/copilot/staged.js'], { cwd: root });
        rmSync(path.join(root, 'src/copilot/deleted.js'));
        write(root, 'tests/unit/copilot/untracked.spec.js', 'export const testValue = 1;\n');
        write(root, 'src/copilot/.ai/generated.js', 'export const generated = true;\n');

        assert.deepEqual(collectChangedCopilotLintPaths(root), [
            'src/copilot/staged.js',
            'src/copilot/unstaged.js',
            'tests/unit/copilot/untracked.spec.js',
        ]);
    });
});
