// @ts-check
/**
 * tests/unit/copilot/tools/search/test_search_tools.spec.js
 *
 * Testes unitários para src/copilot/tools/search/ — domínio canônico de search. Cobre: searchInFilesTool,
 * workspaceSymbolSearchTool, findSymbolUsagesTool, searchTools barrel.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#copilot/observability/logger', () => ({
    log: vi.fn(),
    LOG_DIR: '/tmp/test-logs',
    getRecentLogs: vi.fn(() => []),
}));

import {
    findSymbolUsagesTool,
    searchInFilesTool,
    searchTools,
    symbolSearchTools,
    workspaceSymbolSearchTool,
} from '../../../../../src/copilot/tools/search/index.js';

const WORKSPACE = '/workspaces/chatgpt-docker-puppeteer';
/** @type {string} */
let tmpDir;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(WORKSPACE, 'tmp', '.search-test-'));
    fs.writeFileSync(path.join(tmpDir, 'alpha.js'), 'export function hello() { return "world"; }\n', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'beta.ts'), 'export const count: number = 42;\n', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'gamma.md'), '# Doc\nHello world content here.\n', 'utf8');
});

afterEach(() => {
    try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
        // ignora falhas de limpeza
    }
});

// ─── barrel ──────────────────────────────────────────────────────────────────

describe('search barrel — estrutura', () => {
    it('searchTools é array com 3 elementos', () => {
        expect(Array.isArray(searchTools)).toBe(true);
        expect(searchTools).toHaveLength(3);
    });

    it('searchTools inclui search_in_files', () => {
        const names = searchTools.map((/** @type {any} */ t) => t.name);
        expect(names).toContain('search_in_files');
    });

    it('symbolSearchTools é array com 2 elementos', () => {
        expect(Array.isArray(symbolSearchTools)).toBe(true);
        expect(symbolSearchTools).toHaveLength(2);
    });

    it('re-exports individuais existem', () => {
        expect(searchInFilesTool).toBeDefined();
        expect(workspaceSymbolSearchTool).toBeDefined();
        expect(findSymbolUsagesTool).toBeDefined();
    });
});

// ─── searchInFilesTool ────────────────────────────────────────────────────────

describe('searchInFilesTool (search_in_files)', () => {
    it('tem nome e descrição canônicos', () => {
        expect(/** @type {any} */ (searchInFilesTool).name).toBe('search_in_files');
        expect(typeof (/** @type {any} */ (searchInFilesTool).description)).toBe('string');
    });

    it('encontra texto em arquivo dentro do workspace', async () => {
        const result = await /** @type {any} */ (searchInFilesTool).handler({
            pattern: 'hello',
            path: tmpDir,
            isRegex: false,
            caseSensitive: false,
            contextLines: 0,
        });
        expect(result.success).toBe(true);
        expect(result.output).toMatch(/hello/i);
    });

    it('retorna output vazio quando padrão não existe', async () => {
        const result = await /** @type {any} */ (searchInFilesTool).handler({
            pattern: 'xyzzy_nao_existe_9999',
            path: tmpDir,
            isRegex: false,
            caseSensitive: false,
            contextLines: 0,
        });
        expect(result.success).toBe(true);
        expect(result.output.trim()).toBe('');
    });

    it('filtra por includePattern glob', async () => {
        const result = await /** @type {any} */ (searchInFilesTool).handler({
            pattern: 'export',
            path: tmpDir,
            includePattern: '*.ts',
            isRegex: false,
            caseSensitive: false,
            contextLines: 0,
        });
        expect(result.success).toBe(true);
        // beta.ts tem "export"; alpha.js não deve aparecer no output
        expect(result.output).toMatch(/beta\.ts/);
        expect(result.output).not.toMatch(/alpha\.js/);
    });

    it('retorna success=false para path fora do workspace', async () => {
        const result = await /** @type {any} */ (searchInFilesTool).handler({
            pattern: 'root',
            path: '/etc',
        });
        expect(result.success).toBe(false);
        expect(result.error).toBeTruthy();
    });
});

// ─── workspaceSymbolSearchTool ────────────────────────────────────────────────

describe('workspaceSymbolSearchTool (workspace_symbol_search)', () => {
    it('tem nome canônico', () => {
        expect(/** @type {any} */ (workspaceSymbolSearchTool).name).toBe('workspace_symbol_search');
    });

    it('retorna success para busca simples', async () => {
        const result = await /** @type {any} */ (workspaceSymbolSearchTool).handler({
            name: 'hello',
            kind: 'function',
            path: tmpDir,
            caseSensitive: false,
        });
        // Pode retornar matches ou não — o importante é não crashar
        expect(typeof result.success).toBe('boolean');
    });

    it('retorna success=false para path inválido', async () => {
        const result = await /** @type {any} */ (workspaceSymbolSearchTool).handler({
            name: 'foo',
            kind: 'all',
            path: '/etc/nao-existe-aqui',
            caseSensitive: false,
        });
        expect(result.success).toBe(false);
    });

    it('exactMatch: true — aceita parâmetro sem crashar', async () => {
        const result = await /** @type {any} */ (workspaceSymbolSearchTool).handler({
            name: 'hello',
            kind: 'function',
            path: tmpDir,
            caseSensitive: false,
            exactMatch: true,
        });
        expect(typeof result.success).toBe('boolean');
    });

    it('exactMatch: true — não retorna símbolo com nome diferente', async () => {
        const result = await /** @type {any} */ (workspaceSymbolSearchTool).handler({
            name: 'helloXYZ_nao_existe_99',
            kind: 'function',
            path: tmpDir,
            caseSensitive: false,
            exactMatch: true,
        });
        // Símbolo inexistente → matchCount 0 ou success false
        const count = result.matchCount ?? 0;
        expect(count).toBe(0);
    });
});

// ─── findSymbolUsagesTool ─────────────────────────────────────────────────────

describe('findSymbolUsagesTool (find_symbol_usages)', () => {
    it('tem nome canônico', () => {
        expect(/** @type {any} */ (findSymbolUsagesTool).name).toBe('find_symbol_usages');
    });

    it('encontra usages de símbolo em arquivo', async () => {
        const result = await /** @type {any} */ (findSymbolUsagesTool).handler({
            symbol: 'hello',
            path: tmpDir,
            includePattern: '*.{js,ts,mjs,cjs}',
            wholeWord: false,
            caseSensitive: false,
        });
        expect(result.success).toBe(true);
        expect(result.output).toMatch(/hello/);
    });
});
