// @ts-check

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    buildIoIndexForDirectory: vi.fn(),
    getIoIndexStats: vi.fn(),
    searchIoIndex: vi.fn(),
    findIoIndexSymbol: vi.fn(),
}));

vi.mock('../../../../../src/copilot/infra/index.js', () => ({
    buildIoIndexForDirectory: mocks.buildIoIndexForDirectory,
    getIoIndexStats: mocks.getIoIndexStats,
    searchIoIndex: mocks.searchIoIndex,
    findIoIndexSymbol: mocks.findIoIndexSymbol,
}));

import {
    indexTools,
    workspaceIndexBuildTool,
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
    });

    it('exports canonical index tool names', () => {
        expect(indexTools.map((tool) => tool.name)).toEqual([
            'workspace_index_build',
            'workspace_index_status',
            'workspace_index_search',
            'workspace_index_find_symbol',
        ]);
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
        const search = await getHandler(workspaceIndexSearchTool)({ query: 'alpha' });
        const symbol = await getHandler(workspaceIndexFindSymbolTool)({ symbol: 'alpha' });

        expect(mocks.buildIoIndexForDirectory).toHaveBeenCalledWith('src/copilot', {
            include: ['*.js'],
            concurrency: 3,
        });
        expect(status).toEqual({ available: true, files: 2 });
        expect(search.results).toEqual([{ relativePath: 'a.md' }]);
        expect(symbol.results).toEqual([{ symbolName: 'alpha' }]);
    });
});
