// @ts-check

import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cmdScope } from '../../../../src/copilot/terminal/commands/scope.js';

const WORKSPACE = '/workspaces/chatgpt-docker-puppeteer';

/** @type {string | null} */
let tmpDir = null;
/** @type {string | null} */
let tmpRel = null;

function mockCtx() {
    /** @type {string[]} */
    const lines = [];
    return {
        hubSessionId: `hub-scope-${Date.now()}`,
        println: (/** @type {string} */ line) => lines.push(line),
        output: () => lines.join('\n'),
    };
}

beforeEach(async () => {
    vi.stubEnv('NO_COLOR', '1');
    tmpDir = mkdtempSync(join(WORKSPACE, 'tmp', '.terminal-scope-'));
    tmpRel = relative(WORKSPACE, tmpDir).replace(/\\/gu, '/');
    await mkdir(join(tmpDir, 'nested'), { recursive: true });
    await writeFile(
        join(tmpDir, 'alpha.js'),
        "export function alphaHelper() { return 'alpha'; }\nexport class AlphaService {}\n",
        'utf8',
    );
    await writeFile(join(tmpDir, 'nested', 'beta.js'), 'export const betaValue = 42;\n', 'utf8');
    await writeFile(join(tmpDir, 'notes.md'), '# Notes\n\nText\n', 'utf8');
});

afterEach(async () => {
    const cleanupContext = mockCtx();
    await cmdScope(cleanupContext, 'close scope-terminal-test');
    await cmdScope(cleanupContext, 'close scope-terminal-filtered');
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
    tmpRel = null;
    vi.unstubAllEnvs();
});

describe('terminal/commands/scope', () => {
    it('/scope declare/context/find/refresh/close usa io-session-scope canônico', async () => {
        expect(tmpRel).toBeTruthy();
        const ctx = mockCtx();

        await cmdScope(
            ctx,
            `declare scope-terminal-test ${tmpRel} --await --include *.js --max-files 1 --concurrency 2`,
        );
        expect(ctx.output()).toContain('Escopo declarado');
        expect(ctx.output()).toContain('scope-terminal-test');
        expect(ctx.output()).toContain('diretório');
        expect(ctx.output()).toContain('símbolos sim');
        expect(ctx.output()).toContain('recursivo sim');
        expect(ctx.output()).toContain('informativo');
        expect(ctx.output()).toContain('pronto');

        await cmdScope(ctx, 'context scope-terminal-test');
        expect(ctx.output()).toContain('Contexto de escopo');
        expect(ctx.output()).toContain('exportações');
        expect(ctx.output()).toContain('Exportação');
        expect(ctx.output()).toContain('alphaHelper · função ·');
        expect(ctx.output()).not.toContain('::alphaHelper(function)');
        expect(ctx.output()).not.toContain('Export        ');
        expect(ctx.output()).not.toContain('exports ');

        await cmdScope(ctx, 'find scope-terminal-test alphaHelper --exact');
        expect(ctx.output()).toContain('Busca de símbolo no escopo');
        expect(ctx.output()).toContain('resultados 1');
        expect(ctx.output()).toContain('alphaHelper');

        await cmdScope(ctx, `refresh scope-terminal-test ${tmpRel}/alpha.js`);
        expect(ctx.output()).toContain('Escopo');
        expect(ctx.output()).toContain('atualizados 1');

        await cmdScope(ctx, 'close scope-terminal-test');
        expect(ctx.output()).toContain('Escopo fechado');
        expect(ctx.output()).not.toContain('\x1b[');
        expect(ctx.output()).not.toContain('files=');
        expect(ctx.output()).not.toContain('parsed=');
        expect(ctx.output()).not.toContain('dir=');
        expect(ctx.output()).not.toContain('parseSymbols=');
        expect(ctx.output()).not.toContain('recursive=');
    });

    it('/scope list mostra escopos ativos e filtros advisory não cortam a declaração', async () => {
        expect(tmpRel).toBeTruthy();
        const ctx = mockCtx();

        await cmdScope(
            ctx,
            `declare scope-terminal-filtered ${tmpRel} --await --include *.js --exclude nested/* --max-files 1`,
        );
        await cmdScope(ctx, 'list');

        expect(ctx.output()).toContain('Escopos ativos');
        expect(ctx.output()).toContain('scope-terminal-filtered');
        expect(ctx.output()).toContain('arquivos 1');
        expect(ctx.output()).not.toContain('\x1b[');
        expect(ctx.output()).not.toContain('files=');
    });
});
