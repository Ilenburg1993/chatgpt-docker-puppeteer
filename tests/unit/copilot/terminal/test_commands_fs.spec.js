// @ts-check

import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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

function expectNoAnsi(output) {
    expect(output).not.toContain('\x1b[');
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
        expect(create.output()).toContain('I/O write');
        expectNoAnsi(create.output());
        await expect(readFile(join(WORKSPACE, fileRel), 'utf8')).resolves.toContain(token);

        const read = mockCtx();
        await cmdFs(read, `read ${fileRel}`);
        expect(read.output()).toContain('(FS local)');
        expect(read.output()).toContain(`Arquivo       ${fileRel} · (FS local)`);
        expect(read.output()).not.toContain(`${WORKSPACE}/`);
        expect(read.output()).toContain(token);
        expect(read.output()).toContain('motor io-engine.fs.readFile.text');
        expectNoAnsi(read.output());

        const list = mockCtx();
        await cmdFs(list, `list ${tmpRel}`);
        expect(list.output()).toContain('FS local');
        expect(list.output()).toContain('live.md');
        expect(list.output()).toContain('motor io-scanner.fs.readdir');
        expectNoAnsi(list.output());

        const search = mockCtx();
        await cmdFs(search, `search ${token} ${tmpRel}`);
        expect(search.output()).toContain('FS search');
        expect(search.output()).toContain(`${fileRel}:1:${token}`);
        expect(search.output()).not.toContain(`${WORKSPACE}/`);
        expect(search.output()).toContain(token);
        expect(search.output()).toContain('I/O search');
        expect(search.output()).toContain('resultados');
        expect(search.output()).not.toContain('matches=');
        expectNoAnsi(search.output());
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

    it('/fs preview usa preview read-only com fallback JS explícito', async () => {
        expect(tmpRel).toBeTruthy();
        const fileRel = `${tmpRel}/preview.js`;

        await cmdFs(mockCtx(), `create ${fileRel} const value = 42;`);
        const preview = mockCtx();
        await cmdFs(preview, `preview ${fileRel} --plain --lines 3`);

        expect(preview.output()).toContain('Preview');
        expect(preview.output()).toContain('js · fallback canônico · motivo preview externo desativado');
        expect(preview.output()).toContain('1 │ const value = 42;');
        expect(preview.output()).toContain('Arquivo');
        expectNoAnsi(preview.output());
    });

    it('/fs read --preview mantém leitura canônica e preview opcional', async () => {
        expect(tmpRel).toBeTruthy();
        const fileRel = `${tmpRel}/read-preview.md`;

        await cmdFs(mockCtx(), `create ${fileRel} linha-alpha`);
        const read = mockCtx();
        await cmdFs(read, `read ${fileRel} --preview --plain`);

        expect(read.output()).toContain('Preview');
        expect(read.output()).toContain('linha-alpha');
        expect(read.output()).toContain('I/O read');
        expectNoAnsi(read.output());
    });

    it('/fs preview --markdown usa renderer Markdown explícito com fallback seguro', async () => {
        expect(tmpRel).toBeTruthy();
        const fileRel = `${tmpRel}/doc.md`;

        await cmdFs(mockCtx(), `create ${fileRel} # Titulo`);
        const preview = mockCtx();
        await cmdFs(preview, `preview ${fileRel} --markdown --plain`);

        expect(preview.output()).toContain('Preview');
        expect(preview.output()).toContain('js · fallback canônico · motivo markdown externo desativado');
        expect(preview.output()).toContain('# Titulo');
        expectNoAnsi(preview.output());
    });

    it('/fs preview --json usa preview estruturado explícito com fallback seguro', async () => {
        expect(tmpDir).toBeTruthy();
        expect(tmpRel).toBeTruthy();
        const fileRel = `${tmpRel}/payload.json`;
        await writeFile(join(/** @type {string} */ (tmpDir), 'payload.json'), '{"b":2,"a":{"c":3}}\n', 'utf8');

        const preview = mockCtx();
        await cmdFs(preview, `preview ${fileRel} --json --plain`);

        expect(preview.output()).toContain('Preview');
        expect(preview.output()).toContain('js · fallback canônico · motivo renderer externo desativado');
        expect(preview.output()).toContain('"b": 2');
        expect(preview.output()).toContain('"a": {');
        expectNoAnsi(preview.output());
    });

    it('/fs preview --yaml usa preview estruturado explícito com fallback seguro', async () => {
        expect(tmpDir).toBeTruthy();
        expect(tmpRel).toBeTruthy();
        const fileRel = `${tmpRel}/payload.yaml`;
        await writeFile(join(/** @type {string} */ (tmpDir), 'payload.yaml'), 'b: 2\na:\n  c: 3\n', 'utf8');

        const preview = mockCtx();
        await cmdFs(preview, `preview ${fileRel} --yaml --plain`);

        expect(preview.output()).toContain('Preview');
        expect(preview.output()).toContain('js · fallback canônico · motivo renderer externo desativado');
        expect(preview.output()).toContain('b: 2');
        expect(preview.output()).toContain('a:');
        expectNoAnsi(preview.output());
    });

    it('/fs read exibe guidance acionável quando tool falha', async () => {
        const ctx = mockCtx();
        await cmdFs(ctx, 'read tmp/inexistente.md');

        expect(ctx.output()).toContain('FS local');
        expect(ctx.output()).toContain('Próximos passos:');
        expect(ctx.output()).toContain('/status');
        expectNoAnsi(ctx.output());
    });
});
