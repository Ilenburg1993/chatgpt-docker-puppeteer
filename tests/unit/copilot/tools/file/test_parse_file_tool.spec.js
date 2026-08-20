// @ts-check
/**
 * tests/unit/copilot/tools/file/test_parse_file_tool.spec.js
 *
 * Testes unitários para a tool workspace_parse_file em index-tools.js. Cobre: validatePath, readText,
 * parseFileForContext, flags de inclusão.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── mocks ─────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
    validatePath: vi.fn(),
    readText: vi.fn(),
    parseFileForContext: vi.fn(),
    // outros símbolos de indexing.js necessários para o módulo carregar
    getIoIndexStats: vi.fn(() => ({ available: false })),
    buildIoIndex: vi.fn(),
    getIoIndexStatus: vi.fn(),
    searchIoIndex: vi.fn(() => []),
    findIoIndexSymbol: vi.fn(() => []),
    invalidateIoIndexPath: vi.fn(),
    findIoIndexImports: vi.fn(() => []),
    formatIndexImportRows: vi.fn(() => ''),
    formatIndexSymbolRows: vi.fn(() => ''),
    formatIndexSearchRows: vi.fn(() => ''),
    paginateSearchItems: vi.fn(() => ({
        items: [],
        totalItems: 0,
        truncated: false,
        nextCursor: null,
        cursorOffset: 0,
    })),
    normalizeSearchWindow: vi.fn(() => ({ commandMaxCount: null })),
}));

vi.mock('../../../../../src/copilot/tools/file/shared.js', () => ({
    validatePath: mocks.validatePath,
    WORKSPACE_ROOT: '/workspaces/chatgpt-docker-puppeteer',
}));

vi.mock('#copilot/infra/public/workspace-io', () => ({
    createWorkspaceIo: () => ({ readText: mocks.readText }),
}));

vi.mock('#copilot/infra/public/indexing', async (importOriginal) => {
    const actual = /** @type {Record<string, unknown>} */ (await importOriginal());
    return {
        ...actual,
        getIoIndexStats: mocks.getIoIndexStats,
        buildIoIndex: mocks.buildIoIndex,
        getIoIndexStatus: mocks.getIoIndexStatus,
        searchIoIndex: mocks.searchIoIndex,
        findIoIndexSymbol: mocks.findIoIndexSymbol,
        invalidateIoIndexPath: mocks.invalidateIoIndexPath,
        findIoIndexImports: mocks.findIoIndexImports,
        parseFileForContext: mocks.parseFileForContext,
    };
});

vi.mock('#copilot/observability/logger', () => ({
    log: vi.fn(),
    LOG_DIR: '/tmp/test-logs',
    getRecentLogs: vi.fn(() => []),
}));

import { workspaceParseFileTool } from '../../../../../src/copilot/tools/file/index-tools.js';

/** @param {any} tool */
const getHandler = (tool) => tool.handler;

// ── payload padrão de parseFileForContext ─────────────────────────────────────

const PARSED_PAYLOAD = {
    symbols: {
        symbols: [{ name: 'buildTool', kind: 'function', line: 5 }],
        imports: [{ source: 'zod/v3', specifiers: ['z'] }],
        exports: ['buildTool'],
        parseError: null,
    },
    outline: ['── Exports (1)', '  buildTool'],
    topComments: ['// @ts-check', '/** @module */'],
};

beforeEach(() => {
    vi.clearAllMocks();
    mocks.validatePath.mockResolvedValue({
        ok: true,
        resolved: '/workspaces/chatgpt-docker-puppeteer/src/copilot/foo.js',
    });
    mocks.readText.mockResolvedValue({
        content: 'export function buildTool() {}',
        contentHash: 'content-hash',
    });
    mocks.parseFileForContext.mockResolvedValue(PARSED_PAYLOAD);
});

// ── workspace_parse_file ──────────────────────────────────────────────────────

describe('workspace_parse_file', () => {
    it('retorna símbolos, imports, exports e outline por padrão', async () => {
        const result = await getHandler(workspaceParseFileTool)({ path: 'src/copilot/foo.js' });

        expect(result.success).toBe(true);
        expect(result.path).toBe('/workspaces/chatgpt-docker-puppeteer/src/copilot/foo.js');
        expect(result.symbols).toEqual(PARSED_PAYLOAD.symbols.symbols);
        expect(result.imports).toEqual(PARSED_PAYLOAD.symbols.imports);
        expect(result.exports).toEqual(PARSED_PAYLOAD.symbols.exports);
        expect(result.outline).toEqual(PARSED_PAYLOAD.outline);
        expect(result.parseError).toBeNull();
    });

    it('não inclui topComments por padrão', async () => {
        const result = await getHandler(workspaceParseFileTool)({ path: 'src/copilot/foo.js' });

        expect(result.topComments).toBeUndefined();
    });

    it('inclui topComments quando includeTopComments=true', async () => {
        const result = await getHandler(workspaceParseFileTool)({
            path: 'src/copilot/foo.js',
            includeTopComments: true,
        });

        expect(result.topComments).toEqual(PARSED_PAYLOAD.topComments);
    });

    it('limita coleções por itens e bytes e expõe totais', async () => {
        mocks.parseFileForContext.mockResolvedValue({
            ...PARSED_PAYLOAD,
            symbols: {
                ...PARSED_PAYLOAD.symbols,
                symbols: [
                    ...PARSED_PAYLOAD.symbols.symbols,
                    { name: 'second', kind: 'function', line: 9 },
                ],
            },
        });

        const result = await getHandler(workspaceParseFileTool)({
            path: 'src/copilot/foo.js',
            maxItems: 1,
            maxBytes: 256,
        });

        expect(result.symbols).toHaveLength(1);
        expect(result.truncated).toBe(true);
        expect(result.maxItems).toBe(1);
        expect(result.maxBytes).toBe(256);
        expect(result.returnedContentBytes).toBeLessThanOrEqual(256);
        expect(result.totalCounts.symbols).toBe(2);
        expect(result.returnedCounts.symbols).toBe(1);
    });

    it('omite imports quando includeImports=false', async () => {
        const result = await getHandler(workspaceParseFileTool)({
            path: 'src/copilot/foo.js',
            includeImports: false,
        });

        expect(result.imports).toBeUndefined();
        expect(result.exports).toBeDefined(); // outros campos intactos
    });

    it('omite exports quando includeExports=false', async () => {
        const result = await getHandler(workspaceParseFileTool)({
            path: 'src/copilot/foo.js',
            includeExports: false,
        });

        expect(result.exports).toBeUndefined();
    });

    it('omite outline quando includeOutline=false', async () => {
        const result = await getHandler(workspaceParseFileTool)({
            path: 'src/copilot/foo.js',
            includeOutline: false,
        });

        expect(result.outline).toBeUndefined();
    });

    it('valida path antes de ler — retorna erro quando inválido', async () => {
        mocks.validatePath.mockResolvedValue({ ok: false, reason: 'path outside workspace' });

        const result = await getHandler(workspaceParseFileTool)({ path: '/etc/passwd' });

        expect(result.success).toBe(false);
        expect(result.error).toBe('path outside workspace');
        expect(result.path).toBe('/etc/passwd');
        expect(mocks.readText).not.toHaveBeenCalled();
        expect(mocks.parseFileForContext).not.toHaveBeenCalled();
    });

    it('retorna erro quando readText falha', async () => {
        mocks.readText.mockRejectedValue(new Error('ENOENT: file not found'));

        const result = await getHandler(workspaceParseFileTool)({ path: 'missing.js' });

        expect(result.success).toBe(false);
        expect(result.error).toContain('ENOENT');
        expect(mocks.parseFileForContext).not.toHaveBeenCalled();
    });

    it('passa path resolvido e content para parseFileForContext', async () => {
        await getHandler(workspaceParseFileTool)({ path: 'src/foo.js' });

        expect(mocks.parseFileForContext).toHaveBeenCalledWith(
            '/workspaces/chatgpt-docker-puppeteer/src/copilot/foo.js',
            'export function buildTool() {}',
            { contentHash: 'content-hash' },
        );
    });

    it('propaga parseError quando Babel falha no parse', async () => {
        mocks.parseFileForContext.mockResolvedValue({
            symbols: {
                symbols: [],
                imports: [],
                exports: [],
                parseError: 'SyntaxError: Unexpected token',
            },
            outline: '',
            topComments: '',
        });

        const result = await getHandler(workspaceParseFileTool)({ path: 'broken.js' });

        expect(result.success).toBe(true); // parse error não é fatal
        expect(result.parseError).toBe('SyntaxError: Unexpected token');
        expect(result.symbols).toEqual([]);
    });
});
