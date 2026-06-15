// @ts-check
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- test file usa mocks não tipados

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    buildIoIndexForDirectory: vi.fn(),
    getIoIndexStats: vi.fn(),
    searchIoIndex: vi.fn(),
    findIoIndexSymbol: vi.fn(),
    findIoIndexImports: vi.fn(),
}));

vi.mock('#copilot/infra/public/indexing', async (importOriginal) => {
    // formatters e paginators são funções puras — usamos a implementação real
    const actual = await importOriginal();
    return {
        ...actual,
        buildIoIndexForDirectory: mocks.buildIoIndexForDirectory,
        getIoIndexStats: mocks.getIoIndexStats,
        searchIoIndex: mocks.searchIoIndex,
        findIoIndexSymbol: mocks.findIoIndexSymbol,
        findIoIndexImports: mocks.findIoIndexImports,
    };
});

import {
    indexTools,
    workspaceIndexBuildTool,
    workspaceIndexFindImportsTool,
    workspaceIndexFindSymbolTool,
    workspaceIndexSearchTool,
    workspaceIndexStatusTool,
} from '../../../../../src/copilot/tools/file/index-tools.js';

/** @param {any} tool */
function getHandler(tool) {
    return tool.handler ?? tool.execute ?? tool.run;
}

describe('tools/file/index-tools', () => {
    beforeEach(() => {
        mocks.buildIoIndexForDirectory.mockReset();
        mocks.getIoIndexStats.mockReset();
        mocks.searchIoIndex.mockReset();
        mocks.findIoIndexSymbol.mockReset();
        mocks.findIoIndexImports.mockReset();
    });

    it('exports canonical index tool names', () => {
        expect(indexTools.map((tool) => tool.name)).toEqual([
            'workspace_index_build',
            'workspace_index_status',
            'workspace_index_search',
            'workspace_index_find_symbol',
            'workspace_index_invalidate',
            'workspace_find_imports',
            'workspace_parse_file',
        ]);
    });

    // --- available: false ---

    it('returns available: false when index not available for search', async () => {
        mocks.getIoIndexStats.mockReturnValue({ available: false });
        const result = await getHandler(workspaceIndexSearchTool)({ query: 'alpha' });
        expect(result).toMatchObject({ available: false, matchCount: 0, output: '', engine: 'fts5-index' });
        expect(mocks.searchIoIndex).not.toHaveBeenCalled();
    });

    it('returns available: false when index not available for symbol lookup', async () => {
        mocks.getIoIndexStats.mockReturnValue({ available: false });
        const result = await getHandler(workspaceIndexFindSymbolTool)({ symbol: 'MyClass' });
        expect(result).toMatchObject({ available: false, matchCount: 0, output: '', engine: 'fts5-index' });
        expect(mocks.findIoIndexSymbol).not.toHaveBeenCalled();
    });

    it('returns available: false when index not available for imports lookup', async () => {
        mocks.getIoIndexStats.mockReturnValue({ available: false });
        const result = await getHandler(workspaceIndexFindImportsTool)({ source: 'react' });
        expect(result).toMatchObject({ available: false, matchCount: 0, output: '', engine: 'fts5-index' });
        expect(mocks.findIoIndexImports).not.toHaveBeenCalled();
    });

    // --- output formatting ---

    it('formats search results as output string with FTS5 highlights as **bold**', async () => {
        mocks.getIoIndexStats.mockReturnValue({ available: true, files: 5 });
        mocks.searchIoIndex.mockReturnValue([
            { filePath: '/ws/src/a.js', relativePath: 'src/a.js', snippet: 'some [match] text', rank: 1 },
        ]);

        const result = await getHandler(workspaceIndexSearchTool)({ query: 'match', maxResults: 10 });

        expect(result.output).toContain('src/a.js');
        expect(result.output).toContain('**match**');
        expect(result.output).not.toContain('[match]');
        expect(result.matchCount).toBe(1);
        expect(result.totalMatches).toBeGreaterThanOrEqual(1);
        expect(result.engine).toBe('fts5-index');
        expect(result.truncated).toBe(false);
        expect(result.nextCursor).toBeNull();
        expect(typeof result.cursorOffset).toBe('number');
    });

    it('formats symbol results as output string with file:line and kind', async () => {
        mocks.getIoIndexStats.mockReturnValue({ available: true, files: 5 });
        mocks.findIoIndexSymbol.mockReturnValue([
            {
                filePath: '/ws/src/b.js',
                relativePath: 'src/b.js',
                symbolName: 'alpha',
                symbolKind: 'function',
                exported: 1,
                line: 10,
                docComment: null,
            },
        ]);

        const result = await getHandler(workspaceIndexFindSymbolTool)({ symbol: 'alpha', maxResults: 5 });

        expect(result.output).toContain('src/b.js:10');
        expect(result.output).toContain('alpha');
        expect(result.output).toContain('function');
        expect(result.matchCount).toBe(1);
        expect(result.engine).toBe('fts5-index');
        expect(result.truncated).toBe(false);
    });

    it('formats import results as output string with specifiers', async () => {
        mocks.getIoIndexStats.mockReturnValue({ available: true, files: 5 });
        mocks.findIoIndexImports.mockReturnValue([
            {
                filePath: '/ws/src/App.js',
                relativePath: 'src/App.js',
                source: 'react',
                specifiersJson: '["useState","useEffect"]',
                isDynamic: 0,
                line: 1,
            },
        ]);

        const result = await getHandler(workspaceIndexFindImportsTool)({ source: 'react', maxResults: 10 });

        expect(result.output).toContain('src/App.js:1');
        expect(result.output).toContain("from 'react'");
        expect(result.output).toContain('useState');
        expect(result.output).toContain('useEffect');
        expect(result.matchCount).toBe(1);
        expect(result.engine).toBe('fts5-index');
    });

    it('marks dynamic imports in output', async () => {
        mocks.getIoIndexStats.mockReturnValue({ available: true, files: 3 });
        mocks.findIoIndexImports.mockReturnValue([
            {
                filePath: '/ws/src/lazy.js',
                relativePath: 'src/lazy.js',
                source: './heavy',
                specifiersJson: '[]',
                isDynamic: 1,
                line: 5,
            },
        ]);

        const result = await getHandler(workspaceIndexFindImportsTool)({ source: './heavy' });
        expect(result.output).toContain('(dynamic)');
    });

    // --- filtering ---

    it('applies exactMatch filter for symbol lookup', async () => {
        mocks.getIoIndexStats.mockReturnValue({ available: true, files: 5 });
        mocks.findIoIndexSymbol.mockReturnValue([
            {
                filePath: '/ws/a.js',
                relativePath: 'a.js',
                symbolName: 'alpha',
                symbolKind: 'function',
                exported: 0,
                line: 1,
                docComment: null,
            },
            {
                filePath: '/ws/b.js',
                relativePath: 'b.js',
                symbolName: 'alphaHelper',
                symbolKind: 'function',
                exported: 0,
                line: 2,
                docComment: null,
            },
        ]);

        const result = await getHandler(workspaceIndexFindSymbolTool)({ symbol: 'alpha', exactMatch: true });

        expect(result.matchCount).toBe(1);
        expect(result.output).toContain('a.js');
        expect(result.output).not.toContain('alphaHelper');
    });

    it('includes all results when exactMatch is false (default)', async () => {
        mocks.getIoIndexStats.mockReturnValue({ available: true, files: 5 });
        mocks.findIoIndexSymbol.mockReturnValue([
            { filePath: '/ws/a.js', relativePath: 'a.js', symbolName: 'alpha', symbolKind: 'function', exported: 0, line: 1, docComment: null },
            { filePath: '/ws/b.js', relativePath: 'b.js', symbolName: 'alphaHelper', symbolKind: 'function', exported: 0, line: 2, docComment: null },
        ]);

        const result = await getHandler(workspaceIndexFindSymbolTool)({ symbol: 'alpha' });

        expect(result.matchCount).toBe(2);
    });

    it('applies includePattern filtering for search', async () => {
        mocks.getIoIndexStats.mockReturnValue({ available: true, files: 5 });
        mocks.searchIoIndex.mockReturnValue([
            { filePath: '/ws/src/a.ts', relativePath: 'src/a.ts', snippet: '[match]', rank: 1 },
            { filePath: '/ws/src/b.js', relativePath: 'src/b.js', snippet: '[match]', rank: 1 },
        ]);

        const result = await getHandler(workspaceIndexSearchTool)({ query: 'match', includePattern: '*.ts' });

        expect(result.matchCount).toBe(1);
        expect(result.output).toContain('src/a.ts');
        expect(result.output).not.toContain('src/b.js');
    });

    it('applies excludePattern filtering for search', async () => {
        mocks.getIoIndexStats.mockReturnValue({ available: true, files: 5 });
        mocks.searchIoIndex.mockReturnValue([
            { filePath: '/ws/src/a.ts', relativePath: 'src/a.ts', snippet: '[match]', rank: 1 },
            { filePath: '/ws/node_modules/lib.ts', relativePath: 'node_modules/lib.ts', snippet: '[match]', rank: 1 },
        ]);

        const result = await getHandler(workspaceIndexSearchTool)({ query: 'match', excludePattern: 'node_modules' });

        expect(result.matchCount).toBe(1);
        expect(result.output).toContain('src/a.ts');
        expect(result.output).not.toContain('node_modules');
    });

    // --- pagination ---

    it('respects maxResults and returns nextCursor when truncated', async () => {
        mocks.getIoIndexStats.mockReturnValue({ available: true, files: 10 });
        // commandMaxCount = 0 + 2 + 1 = 3, but we return 3 to signal truncation
        mocks.searchIoIndex.mockReturnValue([
            { filePath: '/ws/a.js', relativePath: 'a.js', snippet: '[x]', rank: 1 },
            { filePath: '/ws/b.js', relativePath: 'b.js', snippet: '[x]', rank: 1 },
            { filePath: '/ws/c.js', relativePath: 'c.js', snippet: '[x]', rank: 1 },
        ]);

        const result = await getHandler(workspaceIndexSearchTool)({ query: 'x', maxResults: 2 });

        expect(result.matchCount).toBe(2);
        expect(result.truncated).toBe(true);
        expect(result.nextCursor).toBeTruthy();
    });

    // --- delegation ---

    it('delegates build/status calls to io index registry', async () => {
        mocks.buildIoIndexForDirectory.mockResolvedValue({ available: true, indexed: 2 });
        mocks.getIoIndexStats.mockReturnValue({ available: true, files: 2 });

        await getHandler(workspaceIndexBuildTool)({
            directory: 'src/copilot',
            include: ['*.js'],
            concurrency: 3,
        });
        const status = await getHandler(workspaceIndexStatusTool)({});

        expect(mocks.buildIoIndexForDirectory).toHaveBeenCalledWith(expect.stringMatching(/src[/\\]copilot$/), {
            workspaceRoot: '/workspaces/chatgpt-docker-puppeteer',
            include: ['*.js'],
            concurrency: 3,
        });
        expect(status).toEqual({ available: true, files: 2 });
    });

    it('rejects index build directory outside workspace before calling infra', async () => {
        const result = await getHandler(workspaceIndexBuildTool)({ directory: '/etc' });

        expect(result.success).toBe(false);
        expect(result.available).toBe(false);
        expect(mocks.buildIoIndexForDirectory).not.toHaveBeenCalled();
    });

    it('passes commandMaxCount to searchIoIndex for over-fetch detection', async () => {
        mocks.getIoIndexStats.mockReturnValue({ available: true, files: 10 });
        mocks.searchIoIndex.mockReturnValue([]);

        await getHandler(workspaceIndexSearchTool)({ query: 'foo', maxResults: 10 });

        // commandMaxCount = 0 + 10 + 1 = 11
        expect(mocks.searchIoIndex).toHaveBeenCalledWith('foo', { maxResults: 11 });
    });

    // --- exactSource filter for workspace_find_imports ---

    it('applies exactSource filter for imports lookup', async () => {
        mocks.getIoIndexStats.mockReturnValue({ available: true, files: 10 });
        // Mock simulates io-index-sqlite filtering behavior
        mocks.findIoIndexImports.mockImplementation((source, options) => {
            const rows = [
                { filePath: '/ws/a.js', relativePath: 'a.js', source: 'react', specifiersJson: '["useState"]', isDynamic: 0, line: 1 },
                { filePath: '/ws/b.js', relativePath: 'b.js', source: 'react-dom', specifiersJson: '["render"]', isDynamic: 0, line: 2 },
            ];
            return options?.exactSource ? rows.filter((r) => r.source === source) : rows;
        });

        const result = await getHandler(workspaceIndexFindImportsTool)({ source: 'react', exactSource: true });

        expect(mocks.findIoIndexImports).toHaveBeenCalledWith('react', expect.objectContaining({ exactSource: true }));
        expect(result.matchCount).toBe(1);
        expect(result.output).toContain("from 'react'");
        expect(result.output).not.toContain('react-dom');
    });

    it('includes all results when exactSource is false (default)', async () => {
        mocks.getIoIndexStats.mockReturnValue({ available: true, files: 10 });
        mocks.findIoIndexImports.mockReturnValue([
            { filePath: '/ws/a.js', relativePath: 'a.js', source: 'react', specifiersJson: '[]', isDynamic: 0, line: 1 },
            { filePath: '/ws/b.js', relativePath: 'b.js', source: 'react-dom', specifiersJson: '[]', isDynamic: 0, line: 2 },
        ]);

        const result = await getHandler(workspaceIndexFindImportsTool)({ source: 'react' });

        expect(result.matchCount).toBe(2);
    });

    it('does not pass exactSource to findIoIndexImports when undefined', async () => {
        mocks.getIoIndexStats.mockReturnValue({ available: true, files: 5 });
        mocks.findIoIndexImports.mockReturnValue([]);

        await getHandler(workspaceIndexFindImportsTool)({ source: 'zod' });

        expect(mocks.findIoIndexImports).toHaveBeenCalledWith('zod', {});
    });
});
