// @ts-check

import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getIoIndex } from '../../../../src/copilot/infra/io-index-registry.js';
import { cmdIndex } from '../../../../src/copilot/terminal/commands/workspace-index.js';

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

beforeEach(async () => {
    getIoIndex()?.clearAll();
    tmpDir = mkdtempSync(join(WORKSPACE, 'tmp', '.terminal-index-'));
    tmpRel = relative(WORKSPACE, tmpDir).replace(/\\/gu, '/');
    await mkdir(join(tmpDir, 'nested'), { recursive: true });
    await writeFile(join(tmpDir, 'alpha.js'), 'export function alphaHelper() { return "needle"; }\n', 'utf8');
    await writeFile(join(tmpDir, 'nested', 'beta.md'), '# Beta\n\nsemantic terminal index token\n', 'utf8');
});

afterEach(() => {
    getIoIndex()?.clearAll();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
    tmpRel = null;
});

describe('terminal/commands/index', () => {
    it('/index build/status/search/symbol usa índice L2 canônico', async () => {
        expect(tmpRel).toBeTruthy();
        const ctx = mockCtx();

        await cmdIndex(ctx, `build ${tmpRel} --ext js --ext md --concurrency 2`);
        expect(ctx.output()).toContain('/index build');
        expect(ctx.output()).toContain('indexed=2');

        await cmdIndex(ctx, 'status');
        expect(ctx.output()).toContain('Índice L2 local');
        expect(ctx.output()).toContain('files=2');

        await cmdIndex(ctx, 'search semantic terminal index token');
        expect(ctx.output()).toContain('/index search');
        expect(ctx.output()).toContain('beta.md');

        await cmdIndex(ctx, 'symbol alphaHelper');
        expect(ctx.output()).toContain('/index symbol');
        expect(ctx.output()).toContain('alphaHelper');

        await cmdIndex(ctx, 'clear');
        expect(ctx.output()).toContain('Índice L2 limpo');
    });
});
