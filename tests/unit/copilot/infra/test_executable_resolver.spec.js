// @ts-check

import { resolveExecutable } from '#copilot/infra/public/platform/process/executable';
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

/** @type {string[]} */
const tempRoots = [];

function makeRoot() {
    const root = join(tmpdir(), `copilot-executable-resolver-${process.pid}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(root, { recursive: true });
    tempRoots.push(root);
    return root;
}

/** @param {string} filePath @param {number} [mode=0o755] */
function makeFile(filePath, mode = 0o755) {
    mkdirSync(join(filePath, '..'), { recursive: true });
    writeFileSync(filePath, '#!/bin/sh\nexit 0\n', { mode });
    chmodSync(filePath, mode);
    return filePath;
}

afterEach(() => {
    while (tempRoots.length > 0) rmSync(tempRoots.pop() ?? '', { recursive: true, force: true });
});

describe('platform/process executable resolver', () => {
    it('prioritizes explicit executable candidates and returns provenance without invoking a process', () => {
        const root = makeRoot();
        const local = makeFile(join(root, 'local-eslint'));
        const pathDir = join(root, 'path');
        makeFile(join(pathDir, 'eslint'));

        const result = resolveExecutable('eslint', {
            env: { PATH: pathDir },
            candidates: [join(root, 'missing'), local],
            cwd: root,
            platform: 'linux',
        });

        expect(result).toEqual({
            found: true,
            command: 'eslint',
            path: local,
            source: 'candidate',
            candidatesChecked: 2,
            searchedPathEntries: 1,
            candidateIndex: 1,
            pathEntryIndex: null,
            extension: null,
        });
        expect(Object.isFrozen(result)).toBe(true);
    });

    it('falls back to PATH, skips non-executable POSIX files and records the selected PATH entry', () => {
        const root = makeRoot();
        const first = join(root, 'first');
        const second = join(root, 'second');
        makeFile(join(first, 'tool'), 0o644);
        const executable = makeFile(join(second, 'tool'));

        const result = resolveExecutable('tool', {
            env: { PATH: [first, second].join(delimiter) },
            cwd: root,
            platform: 'linux',
        });

        expect(result).toMatchObject({
            found: true,
            path: executable,
            source: 'path',
            searchedPathEntries: 2,
            pathEntryIndex: 1,
            extension: null,
        });
        expect(result.candidatesChecked).toBe(2);
    });

    it('supports Path casing and PATHEXT semantics for Windows without X_OK', () => {
        const root = makeRoot();
        const first = join(root, 'windows-bin');
        const command = makeFile(join(first, 'demo.CMD'), 0o644);

        const result = resolveExecutable('demo', {
            env: { Path: first, PATHEXT: '.EXE;.CMD' },
            cwd: root,
            platform: 'win32',
        });

        expect(result).toMatchObject({
            found: true,
            path: command,
            source: 'path',
            pathEntryIndex: 0,
            extension: '.CMD',
        });
    });

    it('resolves a direct command path without searching PATH', () => {
        const root = makeRoot();
        const command = makeFile(join(root, 'direct-tool'));

        const result = resolveExecutable(command, {
            env: { PATH: '' },
            platform: 'linux',
        });

        expect(result).toMatchObject({
            found: true,
            command,
            path: command,
            source: 'command-path',
            searchedPathEntries: 0,
            pathEntryIndex: null,
        });
    });

    it('returns a stable not-found record and rejects missing explicit environment ownership', () => {
        const result = resolveExecutable('missing-tool', {
            env: { PATH: '' },
            platform: 'linux',
        });
        expect(result).toEqual({
            found: false,
            command: 'missing-tool',
            path: null,
            source: 'not-found',
            candidatesChecked: 0,
            searchedPathEntries: 0,
            candidateIndex: null,
            pathEntryIndex: null,
            extension: null,
        });
        expect(() => resolveExecutable('missing-tool', /** @type {never} */ ({}))).toThrow(/explicit env/iu);
    });
});
