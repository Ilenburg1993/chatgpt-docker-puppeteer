// @ts-check

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    buildIoIndexForDirectory: vi.fn(),
    getIoIndexStats: vi.fn(),
    searchIoIndex: vi.fn(),
    findIoIndexSymbol: vi.fn(),
    findIoIndexImports: vi.fn(),
}));

vi.mock('#copilot/infra/public/indexing', () => ({
    buildIoIndexForDirectory: mocks.buildIoIndexForDirectory,
    getIoIndexStats: mocks.getIoIndexStats,
    searchIoIndex: mocks.searchIoIndex,
    findIoIndexSymbol: mocks.findIoIndexSymbol,
    findIoIndexImports: mocks.findIoIndexImports,
}));

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
        ]);
    });

    it('delegates find-imports calls to io index registry', async () => {
        mocks.getIoIndexStats.mockReturnValue({ available: true, files: 5 });
        mocks.findIoIndexImports.mockReturnValue([{ source: 'react', relativePath: 'src/App.js', line: 1 }]);

        const result = await getHandler(workspaceIndexFindImportsTool)({ source: 'react', maxResults: 10 });

        expect(mocks.findIoIndexImports).toHaveBeenCalledWith('react', { maxResults: 10 });
        expect(result).toMatchObject({ source: 'react', maxResults: 10, results: [{ source: 'react' }] });
    });

    it('delegates build/status/search/symbol calls to io index registry', async () => {
        mocks.buildIoIndexForDirectory.mockResolvedValue({ available: true, indexed: 2 });
        mocks.getIoIndexStats.mockReturnValue({ available: true, files: 2 });
        mocks.searchIoIndex.mockReturnValue([{ relativePath: 'a.md' }]);
        mocks.findIoIndexSymbol.mockReturnValue([{ symbolName: 'alpha' }]);

        await getHandler(workspaceIndexBuildTool)({
            directory: 'src/copilot',
            include: ['*.js'],
            concurrency: 3,
        });
        const status = await getHandler(workspaceIndexStatusTool)({});
        const search = await getHandler(workspaceIndexSearchTool)({ query: 'alpha', maxResults: 7 });
        const symbol = await getHandler(workspaceIndexFindSymbolTool)({ symbol: 'alpha', maxResults: 5 });

        expect(mocks.buildIoIndexForDirectory).toHaveBeenCalledWith(expect.stringMatching(/src[/\\]copilot$/), {
            include: ['*.js'],
            concurrency: 3,
        });
        expect(status).toEqual({ available: true, files: 2 });
        expect(mocks.searchIoIndex).toHaveBeenCalledWith('alpha', { maxResults: 7 });
        expect(mocks.findIoIndexSymbol).toHaveBeenCalledWith('alpha', { maxResults: 5 });
        expect(search).toMatchObject({ maxResults: 7, results: [{ relativePath: 'a.md' }] });
        expect(symbol).toMatchObject({ maxResults: 5, results: [{ symbolName: 'alpha' }] });
    });

    it('rejects index build directory outside workspace before calling infra', async () => {
        const result = await getHandler(workspaceIndexBuildTool)({
            directory: '/etc',
        });

        expect(result.success).toBe(false);
        expect(result.available).toBe(false);
        expect(mocks.buildIoIndexForDirectory).not.toHaveBeenCalled();
    });
});
