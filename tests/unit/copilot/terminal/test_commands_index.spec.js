// @ts-check

import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureIoIndexSchema } from '../../../../src/copilot/db/io-index-schema.js';

import { configureInfraSqliteProvider } from '#copilot/infra/public/database';
import { cmdIndex } from '../../../../src/copilot/terminal/commands/workspace-index.js';

import { resetInfraSqliteProviderForTest, resetIoIndexForTest } from '#copilot/infra/public/testing';
const WORKSPACE = '/workspaces/chatgpt-docker-puppeteer';

/** @type {string | null} */
let tmpDir = null;
/** @type {string | null} */
let tmpRel = null;
/** @type {import('better-sqlite3').Database | null} */
let testDb = null;

function mockCtx() {
    /** @type {string[]} */
    const lines = [];
    return {
        println: (/** @type {string} */ line) => lines.push(line),
        output: () => lines.join('\n'),
    };
}

beforeEach(async () => {
    resetIoIndexForTest();
    resetInfraSqliteProviderForTest();
    testDb = new Database(':memory:');
    ensureIoIndexSchema(testDb);
    configureInfraSqliteProvider(() => /** @type {import('better-sqlite3').Database} */ (testDb));
    tmpDir = mkdtempSync(join(WORKSPACE, 'tmp', '.terminal-index-'));
    tmpRel = relative(WORKSPACE, tmpDir).replace(/\\/gu, '/');
    await mkdir(join(tmpDir, 'nested'), { recursive: true });
    await writeFile(join(tmpDir, 'alpha.js'), 'export function alphaHelper() { return "needle"; }\n', 'utf8');
    await writeFile(join(tmpDir, 'nested', 'beta.md'), '# Beta\n\nsemantic terminal index token\n', 'utf8');
});

afterEach(() => {
    resetIoIndexForTest();
    resetInfraSqliteProviderForTest();
    if (testDb?.open) testDb.close();
    testDb = null;
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
        expect(ctx.output()).toContain('gitignore on');
        expect(ctx.output()).toContain('Progresso');
        expect(ctx.output()).toContain('Varredura');
        expect(ctx.output()).toContain('Resultado');
        expect(ctx.output()).toContain('indexados 2');
        expect(ctx.output()).toContain('Workspace');
        expect(ctx.output()).not.toContain('indexed=');
        expect(ctx.output()).not.toContain('workspaceRoot=');
        expect(ctx.output()).not.toContain('gitignore=');
        expect(ctx.output()).not.toContain('falhou:');

        await cmdIndex(ctx, 'status');
        expect(ctx.output()).toContain('Índice L2 local');
        const filesMatch = ctx.output().match(/arquivos\s+(\d+)/u);
        expect(filesMatch).toBeTruthy();
        expect(Number(filesMatch?.[1] ?? 0)).toBeGreaterThanOrEqual(2);
        expect(ctx.output()).not.toContain('files=');
        expect(ctx.output()).not.toContain('latest=');

        await cmdIndex(ctx, 'search semantic terminal index token');
        expect(ctx.output()).toContain('/index search');
        expect(ctx.output()).toContain('resultados');
        expect(ctx.output()).toContain('beta.md');
        expect(ctx.output()).toContain('Arquivo');
        expect(ctx.output()).not.toContain('[terminal]');
        expect(ctx.output()).not.toContain('**terminal**');

        await cmdIndex(ctx, 'symbol alphaHelper');
        expect(ctx.output()).toContain('/index symbol');
        expect(ctx.output()).toContain('alphaHelper');
        expect(ctx.output()).toContain('exportado');
        expect(ctx.output()).not.toMatch(/alphaHelper\s+export(?:\s|$)/u);
        expect(ctx.output()).not.toContain('matches=');

        await cmdIndex(ctx, 'clear');
        const plainOutput = ctx.output().replace(/\u001b\[[0-9;]*m/gu, '');
        expect(plainOutput).toMatch(/Índice L2\s+limpo/u);
    });
});
