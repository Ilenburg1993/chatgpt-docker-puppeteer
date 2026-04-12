// @ts-check
/**
 * tests/unit/copilot/tools/file/test_read_tools.spec.js
 *
 * Testes unitários para src/copilot/tools/file/read-tools.js Cobre: readFileContentTool, listDirectoryTool,
 * searchInFilesTool, diffFilesTool
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#copilot/observability/logger', () => ({ log: vi.fn() }));

import {
    diffFilesTool,
    listDirectoryTool,
    readFileContentTool,
    searchInFilesTool,
} from '../../../../../src/copilot/tools/file/read-tools.js';

/** Extract handler from buildTool result */
function getHandler(tool) {
    // buildTool returns { name, description, parameters, handler }
    return tool.handler ?? tool.execute ?? tool.run;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const WORKSPACE = '/workspaces/chatgpt-docker-puppeteer';
let tmpDir;
let fileA;
let fileB;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(WORKSPACE, 'tmp', '.readtools-test-'));
    fileA = path.join(tmpDir, 'a.txt');
    fileB = path.join(tmpDir, 'b.txt');
    fs.writeFileSync(fileA, 'line1\nline2\nline3\nline4\n');
    fs.writeFileSync(fileB, 'line1\nline2\nMODIFIED\nline4\n');
    fs.mkdirSync(path.join(tmpDir, 'sub'));
    fs.writeFileSync(path.join(tmpDir, 'sub', 'nested.js'), 'console.log("hello");');
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── readFileContentTool ────────────────────────────────────────────────────

describe('tools/file/readFileContentTool', () => {
    it('exporta name e handler', () => {
        expect(readFileContentTool.name).toBe('read_file_content');
        expect(typeof getHandler(readFileContentTool)).toBe('function');
    });

    it('lê arquivo inteiro', async () => {
        const handler = getHandler(readFileContentTool);
        const r = await handler({ path: fileA, encoding: 'utf8' });
        expect(r.success).toBe(true);
        expect(r.content).toContain('line1');
        expect(r.content).toContain('line4');
    });

    it('suporta startLine e endLine', async () => {
        const handler = getHandler(readFileContentTool);
        const r = await handler({ path: fileA, startLine: 2, endLine: 3, encoding: 'utf8' });
        expect(r.success).toBe(true);
        expect(r.content).toContain('line2');
        expect(r.content).toContain('line3');
        expect(r.content).not.toContain('line1');
    });

    it('suporta encoding base64', async () => {
        const handler = getHandler(readFileContentTool);
        const r = await handler({ path: fileA, encoding: 'base64' });
        expect(r.success).toBe(true);
        expect(r.encoding).toBe('base64');
        const decoded = Buffer.from(r.content, 'base64').toString('utf8');
        expect(decoded).toContain('line1');
    });

    it('erro para diretório', async () => {
        const handler = getHandler(readFileContentTool);
        const r = await handler({ path: tmpDir, encoding: 'utf8' });
        expect(r.success).toBe(false);
        expect(r.error).toContain('diretório');
    });

    it('erro para arquivo inexistente', async () => {
        const handler = getHandler(readFileContentTool);
        const r = await handler({ path: path.join(tmpDir, 'nope.txt'), encoding: 'utf8' });
        expect(r.success).toBe(false);
    });
});

// ─── listDirectoryTool ──────────────────────────────────────────────────────

describe('tools/file/listDirectoryTool', () => {
    it('exporta name list_directory', () => {
        expect(listDirectoryTool.name).toBe('list_directory');
    });

    it('lista diretório com arquivos e subpastas', async () => {
        const handler = getHandler(listDirectoryTool);
        const r = await handler({ path: tmpDir, recursive: false, depth: 3, showHidden: false });
        expect(r.success).toBe(true);
        expect(r.entries.length).toBeGreaterThanOrEqual(3); // a.txt, b.txt, sub
        const names = r.entries.map((e) => e.name);
        expect(names).toContain('a.txt');
        expect(names).toContain('sub');
    });

    it('modo recursivo mostra filhos', async () => {
        const handler = getHandler(listDirectoryTool);
        const r = await handler({ path: tmpDir, recursive: true, depth: 3, showHidden: false });
        expect(r.success).toBe(true);
        const subEntry = r.entries.find((e) => e.name === 'sub');
        expect(subEntry?.children).toBeDefined();
        expect(subEntry?.children?.length).toBeGreaterThanOrEqual(1);
    });

    it('erro para arquivo (não é diretório)', async () => {
        const handler = getHandler(listDirectoryTool);
        const r = await handler({ path: fileA, recursive: false, depth: 3, showHidden: false });
        expect(r.success).toBe(false);
        expect(r.error).toContain('diretório');
    });

    it('showHidden inclui dotfiles', async () => {
        fs.writeFileSync(path.join(tmpDir, '.hidden'), 'secret');
        const handler = getHandler(listDirectoryTool);

        const r1 = await handler({ path: tmpDir, recursive: false, depth: 3, showHidden: false });
        const names1 = r1.entries.map((e) => e.name);
        expect(names1).not.toContain('.hidden');

        const r2 = await handler({ path: tmpDir, recursive: false, depth: 3, showHidden: true });
        const names2 = r2.entries.map((e) => e.name);
        expect(names2).toContain('.hidden');
    });
});

// ─── searchInFilesTool ──────────────────────────────────────────────────────

describe('tools/file/searchInFilesTool', () => {
    it('exporta name search_in_files', () => {
        expect(searchInFilesTool.name).toBe('search_in_files');
    });

    it('busca texto em arquivo', async () => {
        const handler = getHandler(searchInFilesTool);
        const r = await handler({
            pattern: 'line2',
            path: tmpDir,
            isRegex: false,
            caseSensitive: false,
            contextLines: 0,
            maxResults: 10,
        });
        expect(r.success).toBe(true);
        expect(r.output).toContain('line2');
    });

    it('busca regex', async () => {
        const handler = getHandler(searchInFilesTool);
        const r = await handler({
            pattern: 'line[34]',
            path: tmpDir,
            isRegex: true,
            caseSensitive: false,
            contextLines: 0,
            maxResults: 10,
        });
        expect(r.success).toBe(true);
        expect(r.output).toContain('line3');
    });

    it('rejeita pattern longo (>500 chars)', async () => {
        const handler = getHandler(searchInFilesTool);
        const r = await handler({
            pattern: 'x'.repeat(501),
            path: tmpDir,
            isRegex: false,
            caseSensitive: false,
            contextLines: 2,
            maxResults: 50,
        });
        expect(r.success).toBe(false);
        expect(r.error).toContain('500');
    });

    it('retorna matchCount=0 para padrão sem match', async () => {
        const handler = getHandler(searchInFilesTool);
        const r = await handler({
            pattern: 'ZZZZZ_NO_MATCH',
            path: tmpDir,
            isRegex: false,
            caseSensitive: false,
            contextLines: 0,
            maxResults: 10,
        });
        expect(r.success).toBe(true);
        expect(r.matchCount === 0 || r.output === '').toBe(true);
    });
});

// ─── diffFilesTool ──────────────────────────────────────────────────────────

describe('tools/file/diffFilesTool', () => {
    it('exporta name diff_files', () => {
        expect(diffFilesTool.name).toBe('diff_files');
    });

    it('diff entre dois arquivos diferentes', async () => {
        const handler = getHandler(diffFilesTool);
        const r = await handler({ path_a: fileA, path_b: fileB, context_lines: 3 });
        expect(r.success).toBe(true);
        expect(r.identical).toBe(false);
        expect(r.diff).toContain('MODIFIED');
    });

    it('diff idêntico retorna identical=true', async () => {
        const handler = getHandler(diffFilesTool);
        const r = await handler({ path_a: fileA, path_b: fileA, context_lines: 3 });
        expect(r.success).toBe(true);
        expect(r.identical).toBe(true);
    });

    it('erro se path_a inválido', async () => {
        const handler = getHandler(diffFilesTool);
        const r = await handler({
            path_a: path.join(tmpDir, 'nonexistent'),
            path_b: fileB,
            context_lines: 3,
        });
        expect(r.success).toBe(false);
    });
});
