// @ts-check

import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cmdFs } from '../../../../src/copilot/terminal/commands/fs.js';

const WORKSPACE = '/workspaces/chatgpt-docker-puppeteer';

/** @type {string | null} */
let tmpDir = null;
/** @type {string | null} */
let tmpRel = null;

function mockCtx() {
    /** @type {string[]} */
    const lines = [];
    return {
        println: (/** @type {string} */ line) => lines.push(line),
        output: () => lines.join('\n'),
    };
}

beforeEach(() => {
    tmpDir = mkdtempSync(join(WORKSPACE, 'tmp', '.terminal-fs-'));
    tmpRel = relative(WORKSPACE, tmpDir).replace(/\\/gu, '/');
});

afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
    tmpRel = null;
});

describe('terminal/commands/fs', () => {
    it('/fs create/read/list/search opera no FS local via file-tools canônicas', async () => {
        expect(tmpRel).toBeTruthy();
        const fileRel = `${tmpRel}/live.md`;
        const token = `LIVE_FS_${Date.now()}`;

        const create = mockCtx();
        await cmdFs(create, `create ${fileRel} ${token} alpha beta`);
        expect(create.output()).toContain('FS local criado');
        expect(create.output()).toContain('io=write');
        await expect(readFile(join(WORKSPACE, fileRel), 'utf8')).resolves.toContain(token);

        const read = mockCtx();
        await cmdFs(read, `read ${fileRel}`);
        expect(read.output()).toContain('(FS local)');
        expect(read.output()).toContain(token);
        expect(read.output()).toContain('engine=io-engine.fs.readFile.text');

        const list = mockCtx();
        await cmdFs(list, `list ${tmpRel}`);
        expect(list.output()).toContain('FS local');
        expect(list.output()).toContain('live.md');
        expect(list.output()).toContain('engine=io-scanner.fs.readdir');

        const search = mockCtx();
        await cmdFs(search, `search ${token} ${tmpRel}`);
        expect(search.output()).toContain('FS search');
        expect(search.output()).toContain(token);
        expect(search.output()).toContain('io=search');
    });

    it('/fs list usa scanner recursivo e hidden quando solicitado', async () => {
        expect(tmpDir).toBeTruthy();
        expect(tmpRel).toBeTruthy();
        await mkdir(join(/** @type {string} */ (tmpDir), 'nested'), { recursive: true });
        const hiddenRel = `${tmpRel}/.hidden.md`;
        const nestedRel = `${tmpRel}/nested/file.md`;

        await cmdFs(mockCtx(), `create ${hiddenRel} hidden`);
        await cmdFs(mockCtx(), `create ${nestedRel} nested`);

        const shallow = mockCtx();
        await cmdFs(shallow, `list ${tmpRel}`);
        expect(shallow.output()).not.toContain('.hidden.md');
        expect(shallow.output()).toContain('nested');

        const recursive = mockCtx();
        await cmdFs(recursive, `list ${tmpRel} --recursive --hidden --depth 2`);
        expect(recursive.output()).toContain('.hidden.md');
        expect(recursive.output()).toContain('nested');
    });

    it('/fs write deixa claro que sobrescreve arquivo existente no FS local', async () => {
        expect(tmpRel).toBeTruthy();
        const fileRel = `${tmpRel}/replace.md`;

        await cmdFs(mockCtx(), `create ${fileRel} first`);
        const write = mockCtx();
        await cmdFs(write, `write ${fileRel} second value`);

        expect(write.output()).toContain('FS local escrito');
        await expect(readFile(join(WORKSPACE, fileRel), 'utf8')).resolves.toBe('second value');
    });
});
