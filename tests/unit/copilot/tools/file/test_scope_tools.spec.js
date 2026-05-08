// @ts-check

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    declareScope: vi.fn(),
    refreshScope: vi.fn(),
    getScopeContext: vi.fn(),
    findSymbol: vi.fn(),
    listScopes: vi.fn(),
    getScopeStats: vi.fn(),
    closeScope: vi.fn(),
}));

vi.mock('#copilot/infra/io-session-scope', () => ({
    closeScope: mocks.closeScope,
    declareScope: mocks.declareScope,
    refreshScope: mocks.refreshScope,
    getScopeContext: mocks.getScopeContext,
    getScopeStats: mocks.getScopeStats,
    findSymbol: mocks.findSymbol,
    listScopes: mocks.listScopes,
}));

import {
    scopeTools,
    workspaceScopeCloseTool,
    workspaceScopeContextTool,
    workspaceScopeDeclareTool,
    workspaceScopeFindSymbolTool,
    workspaceScopeListTool,
    workspaceScopeRefreshTool,
} from '../../../../../src/copilot/tools/file/scope-tools.js';

/** @param {any} tool */
function getHandler(tool) {
    return tool.handler ?? tool.execute ?? tool.run;
}

describe('tools/file/scope-tools', () => {
    beforeEach(() => {
        mocks.declareScope.mockReset();
        mocks.refreshScope.mockReset();
        mocks.getScopeContext.mockReset();
        mocks.findSymbol.mockReset();
        mocks.listScopes.mockReset();
        mocks.getScopeStats.mockReset();
        mocks.closeScope.mockReset();
    });

    it('exports canonical tool names for scope operations', () => {
        expect(scopeTools.map((t) => t.name)).toEqual([
            'workspace_scope_declare',
            'workspace_scope_list',
            'workspace_scope_refresh',
            'workspace_scope_context',
            'workspace_scope_find_symbol',
            'workspace_scope_close',
        ]);
    });

    it('delegates declare scope parameters', async () => {
        const handler = getHandler(workspaceScopeDeclareTool);
        mocks.declareScope.mockResolvedValue({ awaitReady: vi.fn().mockResolvedValue({ files: 10 }) });

        const out = await handler({ sessionId: 's1', directory: 'src/copilot', maxFiles: 50 });

        expect(mocks.declareScope).toHaveBeenCalledWith({
            sessionId: 's1',
            directory: 'src/copilot',
            maxFiles: 50,
            parseSymbols: undefined,
            indexMode: undefined,
            concurrency: undefined,
            include: undefined,
            exclude: undefined,
            recursive: undefined,
        });
        expect(out.sessionId).toBe('s1');
    });

    it('workspace_scope_declare usa scopeName como sessionId efetivo quando fornecido', async () => {
        const handler = getHandler(workspaceScopeDeclareTool);
        mocks.declareScope.mockResolvedValue({ scopeId: 'scope-feature-a', files: [], symbols: new Map() });

        const out = await handler({
            sessionId: 'session-default',
            scopeName: 'feature-a',
            directory: 'src',
        });

        expect(mocks.declareScope).toHaveBeenCalledWith(
            expect.objectContaining({
                sessionId: 'feature-a',
                directory: 'src',
            }),
        );
        expect(out.sessionId).toBe('feature-a');
    });

    it('workspace_scope_declare aguarda awaitReady quando solicitado', async () => {
        const handler = getHandler(workspaceScopeDeclareTool);
        const awaitReadyFn = vi.fn().mockResolvedValue({ ready: true });
        mocks.declareScope.mockResolvedValue({ sessionId: 's-await', awaitReady: awaitReadyFn });

        const out = await handler({ sessionId: 's-await', directory: 'src/copilot', awaitReady: true });

        expect(awaitReadyFn).toHaveBeenCalledTimes(1);
        expect(out.sessionId).toBe('s-await');
    });

    it('delegates list/refresh/context/find/close calls', async () => {
        mocks.listScopes.mockReturnValue(['abc']);
        mocks.getScopeStats.mockReturnValue({ sessionId: 'abc', ready: true });
        mocks.refreshScope.mockResolvedValue({ refreshed: true });
        mocks.getScopeContext.mockResolvedValue({ files: [] });
        mocks.findSymbol.mockResolvedValue({ symbol: 'buildTool', matches: [] });
        mocks.closeScope.mockResolvedValue({ sessionId: 'abc', ready: true });

        await getHandler(workspaceScopeListTool)({ includeStats: true });
        await getHandler(workspaceScopeRefreshTool)({ sessionId: 'abc', modifiedPaths: ['src/a.ts'] });
        await getHandler(workspaceScopeContextTool)({ sessionId: 'abc' });
        await getHandler(workspaceScopeFindSymbolTool)({ sessionId: 'abc', symbol: 'buildTool' });
        await getHandler(workspaceScopeCloseTool)({ sessionId: 'abc' });

        expect(mocks.listScopes).toHaveBeenCalled();
        expect(mocks.getScopeStats).toHaveBeenCalledWith('abc');
        expect(mocks.refreshScope).toHaveBeenCalledWith('abc', ['src/a.ts']);
        expect(mocks.getScopeContext).toHaveBeenCalledWith('abc');
        expect(mocks.findSymbol).toHaveBeenCalledWith('abc', 'buildTool', { exactMatch: undefined });
        expect(mocks.closeScope).toHaveBeenCalledWith('abc');
    });
});
