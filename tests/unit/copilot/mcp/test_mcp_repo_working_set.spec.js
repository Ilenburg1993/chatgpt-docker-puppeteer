// @ts-check

import assert from 'node:assert/strict';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const stats = {
        sessionId: 'mock',
        pathCount: 2,
        candidateFiles: 3,
        selectedFiles: 2,
        hardLimitReached: true,
        selection: {
            mode: 'coverage',
            candidateBuckets: 3,
            selectedBuckets: 2,
            preferredRequested: 1,
            preferredSelected: 1,
            seedSymbolsRequested: 1,
            seedSymbolPathsResolved: 1,
        },
        preloaded: 2,
        parsed: 2,
        failed: 0,
        invalidated: 0,
        index: null,
        symbolBytes: 128,
        warmDurationMs: 5,
        ready: true,
        degraded: false,
        status: 'ready',
        lastError: null,
        startedAt: 1,
        completedAt: 2,
        maxActiveScopes: 32,
    };
    return {
        stats,
        declareScope: vi.fn(() => ({
            sessionId: 'ignored-by-tool',
            ready: false,
            awaitReady: vi.fn(async () => stats),
        })),
        getScopeStats: vi.fn(() => stats),
        getScopeContext: vi.fn(() => ({
            sessionId: 'mock',
            files: 2,
            candidateFiles: 3,
            selectedFiles: 2,
            hardLimitReached: true,
            symbols: 2,
            symbolBytes: 128,
            invalidated: 0,
            topExports: ['a.js::alpha(function)'],
            manifest: [
                { path: 'src/copilot/a.js', symbolCount: 1, exports: ['alpha'], imports: ['./b.js'], stale: false },
            ],
            manifestTruncated: false,
            contextBytes: 128,
            ready: true,
            degraded: false,
            status: 'ready',
            lastError: null,
        })),
        findSymbol: vi.fn(() => [
            {
                filePath: `${process.cwd()}/src/copilot/a.js`,
                symbol: { name: 'alpha', kind: 'function', line: 1, exported: true },
            },
        ]),
        refreshScope: vi.fn(async () => ({ refreshed: 0, removed: 0, failed: 0, skipped: 0 })),
        closeScope: vi.fn(() => stats),
    };
});

vi.mock('#copilot/infra/public/session', () => ({
    declareScope: mocks.declareScope,
    getScopeStats: mocks.getScopeStats,
    getScopeContext: mocks.getScopeContext,
    findSymbol: mocks.findSymbol,
    refreshScope: mocks.refreshScope,
    closeScope: mocks.closeScope,
}));

import { repoWorkingSetTool, resetMcpWorkingSetsForTest } from '../../../../src/copilot/mcp/tools/repo-working-set.js';

afterEach(() => {
    resetMcpWorkingSetsForTest();
    vi.clearAllMocks();
});

/** @param {{ structuredContent?: unknown }} result */
function structured(result) {
    return /** @type {Record<string, any>} */ (result.structuredContent);
}

describe('mcp/repo_working_set', () => {
    it('abre working set com id opaco gerado no servidor e retorna contexto no mesmo call', async () => {
        const result = await repoWorkingSetTool.handler({
            action: 'open',
            path: 'src/copilot',
            maxFiles: 2,
            maxBytes: 4096,
            concurrency: 2,
            parseSymbols: true,
            indexMode: 'auto',
            selectionMode: 'coverage',
            seedPaths: ['src/copilot/mcp/README.md'],
            seedSymbols: ['repoWriteTools'],
        });
        const out = structured(result);

        expect(result.isError).toBeUndefined();
        expect(out['workingSetId']).toMatch(/^mcp-ws-[0-9a-f-]{36}$/u);
        expect(out['context']).toBeTruthy();
        expect(out['contextIncluded']).toBe(true);
        expect(out['contextAvailable']).toBe(true);
        expect(out['stats']).toBeTruthy();
        const text = String(result.content?.[0]?.text ?? '');
        expect(text.length).toBeLessThan(320);
        expect(text).not.toContain('manifest');
        expect(mocks.declareScope).toHaveBeenCalledTimes(1);
        expect(mocks.declareScope).toHaveBeenCalledWith(
            expect.objectContaining({
                sessionId: out['workingSetId'],
                directory: expect.stringMatching(/src[/\\]copilot$/u),
                workspaceRoot: expect.stringMatching(/chatgpt-docker-puppeteer$/u),
                maxFiles: 2,
                concurrency: 2,
                parseSymbols: true,
                indexMode: 'auto',
                selectionMode: 'coverage',
                preferredPaths: [expect.stringMatching(/src[/\\]copilot[/\\]mcp[/\\]README\.md$/u)],
                seedSymbols: ['repoWriteTools'],
            }),
        );
        expect(mocks.getScopeContext).toHaveBeenCalledWith(out['workingSetId'], {
            maxFiles: 2,
            maxBytes: 4096,
        });
    });

    it('open contextMode=omit aquece e retorna id/stats sem materializar manifest', async () => {
        const result = await repoWorkingSetTool.handler({
            action: 'open',
            path: 'src/copilot',
            contextMode: 'omit',
        });
        const out = structured(result);

        expect(result.isError).toBeUndefined();
        expect(out['contextMode']).toBe('omit');
        expect(out['contextIncluded']).toBe(false);
        expect(out['contextAvailable']).toBe(true);
        expect(out['context']).toBeUndefined();
        expect(mocks.getScopeContext).not.toHaveBeenCalled();
    });

    it('rejeita seed legível que esteja fora do root aberto', async () => {
        const result = await repoWorkingSetTool.handler({
            action: 'open',
            path: 'src/copilot/mcp',
            seedPaths: ['package.json'],
        });

        expect(result.isError).toBe(true);
        expect(structured(result)['code']).toBe('ERR_WORKING_SET_SEED_OUTSIDE_ROOT');
        expect(mocks.declareScope).not.toHaveBeenCalled();
    });

    it('rejeita id forjado antes de chamar find/refresh/close da engine compartilhada', async () => {
        const result = await repoWorkingSetTool.handler({ action: 'find', workingSetId: 'forged', symbol: 'alpha' });

        expect(result.isError).toBe(true);
        expect(mocks.findSymbol).not.toHaveBeenCalled();
        expect(mocks.refreshScope).not.toHaveBeenCalled();
        expect(mocks.closeScope).not.toHaveBeenCalled();
    });

    it('refresh auto/include/omit materializa contexto somente quando a política exige', async () => {
        const opened = structured(
            await repoWorkingSetTool.handler({ action: 'open', path: 'src/copilot', indexMode: 'off', contextMode: 'omit' }),
        );
        const id = String(opened['workingSetId']);
        expect(mocks.getScopeContext).not.toHaveBeenCalled();

        mocks.refreshScope.mockResolvedValueOnce({ refreshed: 1, removed: 0, failed: 0, skipped: 0 });
        const auto = structured(await repoWorkingSetTool.handler({ action: 'refresh', workingSetId: id }));
        assert.equal(auto['contextIncluded'], true);
        assert.ok(auto['context']);
        expect(mocks.getScopeContext).toHaveBeenCalledTimes(1);

        mocks.refreshScope.mockResolvedValueOnce({ refreshed: 0, removed: 1, failed: 0, skipped: 0 });
        const removed = structured(await repoWorkingSetTool.handler({ action: 'refresh', workingSetId: id }));
        assert.equal(removed['removed'], 1);
        assert.equal(removed['contextIncluded'], true);
        assert.ok(removed['context']);
        expect(mocks.getScopeContext).toHaveBeenCalledTimes(2);

        mocks.refreshScope.mockResolvedValueOnce({ refreshed: 1, removed: 0, failed: 0, skipped: 0 });
        const omitted = structured(
            await repoWorkingSetTool.handler({ action: 'refresh', workingSetId: id, contextMode: 'omit' }),
        );
        assert.equal(omitted['contextIncluded'], false);
        assert.equal(omitted['context'], undefined);
        expect(mocks.getScopeContext).toHaveBeenCalledTimes(2);

        mocks.refreshScope.mockResolvedValueOnce({ refreshed: 0, removed: 0, failed: 0, skipped: 0 });
        const included = structured(
            await repoWorkingSetTool.handler({ action: 'refresh', workingSetId: id, contextMode: 'include' }),
        );
        assert.equal(included['contextIncluded'], true);
        assert.ok(included['context']);
        expect(mocks.getScopeContext).toHaveBeenCalledTimes(3);
    });

    it('texto compacto evita duplicar um manifest grande no mesmo CallToolResult', async () => {
        const largeManifest = Array.from({ length: 40 }, (_, index) => ({
            path: `src/copilot/feature-${index}/runtime.js`,
            symbolCount: 12,
            exports: Array.from({ length: 6 }, (__, item) => `export_${index}_${item}`),
            imports: Array.from({ length: 6 }, (__, item) => `./dep-${index}-${item}.js`),
            stale: false,
        }));
        mocks.getScopeContext.mockReturnValueOnce({
            sessionId: 'mock',
            files: 40,
            candidateFiles: 80,
            selectedFiles: 40,
            hardLimitReached: true,
            symbols: 480,
            symbolBytes: 32000,
            invalidated: 0,
            topExports: Array.from({ length: 24 }, (_, index) => `runtime-${index}.js::export_${index}(function)`),
            manifest: largeManifest,
            manifestTruncated: false,
            contextBytes: 15000,
            ready: true,
            degraded: false,
            status: 'ready',
            lastError: null,
        });

        const result = await repoWorkingSetTool.handler({ action: 'open', path: 'src/copilot' });
        const structuredContent = structured(result);
        const actualBytes = Buffer.byteLength(JSON.stringify(result), 'utf8');
        const legacyLike = {
            ...result,
            content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
        };
        const legacyBytes = Buffer.byteLength(JSON.stringify(legacyLike), 'utf8');
        const text = String(result.content?.[0]?.text ?? '');

        expect(text.length).toBeLessThan(320);
        expect(text).not.toContain('feature-0');
        expect(actualBytes).toBeLessThan(legacyBytes * 0.7);
    });

    it('compõe find, refresh, status, context e close sobre o mesmo working set', async () => {
        const opened = structured(await repoWorkingSetTool.handler({ action: 'open', path: 'src/copilot', indexMode: 'off' }));
        const id = String(opened['workingSetId']);

        const found = structured(
            await repoWorkingSetTool.handler({ action: 'find', workingSetId: id, symbol: 'alpha', exactMatch: true }),
        );
        assert.equal(found['matchCount'], 1);
        assert.equal(found['matches'][0]?.path, 'src/copilot/a.js');

        const contextCallsAfterOpen = mocks.getScopeContext.mock.calls.length;
        const refreshed = structured(await repoWorkingSetTool.handler({ action: 'refresh', workingSetId: id }));
        assert.equal(refreshed['refreshed'], 0);
        assert.equal(refreshed['contextIncluded'], false);
        assert.equal(refreshed['contextAvailable'], true);
        assert.equal(refreshed['context'], undefined);
        expect(mocks.getScopeContext).toHaveBeenCalledTimes(contextCallsAfterOpen);
        expect(mocks.refreshScope).toHaveBeenCalledWith(id, undefined);

        const status = structured(await repoWorkingSetTool.handler({ action: 'status', workingSetId: id }));
        assert.equal(status['workingSetId'], id);
        assert.ok(status['stats']);

        const context = structured(
            await repoWorkingSetTool.handler({ action: 'context', workingSetId: id, maxFiles: 10, maxBytes: 8192 }),
        );
        assert.ok(context['context']);
        expect(mocks.getScopeContext).toHaveBeenLastCalledWith(id, { maxFiles: 10, maxBytes: 8192 });

        const closed = structured(await repoWorkingSetTool.handler({ action: 'close', workingSetId: id }));
        assert.equal(closed['closed'], true);
        expect(mocks.closeScope).toHaveBeenCalledWith(id);
    });
});
