// @ts-check
/**
 * Tests for first-band Copilot MCP tools.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { resolveReadPath } from '../../../../src/copilot/mcp/control-plane/paths.js';
import { getCanonicalMcpTools } from '../../../../src/copilot/mcp/registry.js';

function findTool(name) {
    const tool = getCanonicalMcpTools().find((candidate) => candidate.name === name);
    assert.ok(tool, `missing tool ${name}`);
    return tool;
}

describe('copilot MCP tools', () => {
    it('resolves workspace read paths and rejects escapes', async () => {
        const ok = await resolveReadPath('src/copilot/mcp/README.md');
        assert.equal(ok.ok, true);
        if (ok.ok) {
            assert.equal(ok.relative, 'src/copilot/mcp/README.md');
        }

        const denied = await resolveReadPath('../package.json');
        assert.equal(denied.ok, false);
        if (!denied.ok) {
            assert.equal(denied.code, 'ERR_PATH_DENIED');
            assert.equal(typeof denied.hint, 'string');
        }
    });

    it('repo_read_file returns structured content and text content', async () => {
        const tool = findTool('repo_read_file');
        const result = await tool.handler({
            path: 'src/copilot/mcp/README.md',
            startLine: 1,
            endLine: 8,
        });

        assert.equal(result.isError, undefined);
        assert.ok(result.structuredContent && typeof result.structuredContent === 'object');
        const structured = /** @type {Record<string, unknown>} */ (result.structuredContent);
        assert.equal(structured['success'], true);
        assert.equal(structured['path'], 'src/copilot/mcp/README.md');
        assert.equal(typeof structured['sha256'], 'string');
        assert.equal(typeof structured['returnedSha256'], 'string');
        assert.ok(Array.isArray(result.content));
        assert.ok(String(result.content[0]?.text ?? '').includes('Copilot MCP Server'));
    });

    it('repo_file_stats returns metadata and optional content hash', async () => {
        const tool = findTool('repo_file_stats');
        const result = await tool.handler({
            path: 'src/copilot/mcp/README.md',
            includeHash: true,
        });

        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], true);
        assert.equal(result.structuredContent?.['path'], 'src/copilot/mcp/README.md');
        assert.equal(result.structuredContent?.['type'], 'file');
        assert.equal(typeof result.structuredContent?.['sizeBytes'], 'number');
        assert.equal(typeof result.structuredContent?.['sha256'], 'string');
        assert.equal(result.structuredContent?.['hashComputed'], true);
    });

    it('read tools return stable error codes for recoverable client errors', async () => {
        const readTool = findTool('repo_read_file');
        const emptyPath = await readTool.handler({ path: '' });
        assert.equal(emptyPath.isError, true);
        assert.equal(emptyPath.structuredContent?.['success'], false);
        assert.equal(emptyPath.structuredContent?.['code'], 'ERR_EMPTY_PATH');
        assert.equal(typeof emptyPath.structuredContent?.['hint'], 'string');

        const invalidRange = await readTool.handler({
            path: 'src/copilot/mcp/README.md',
            startLine: 10,
            endLine: 2,
        });
        assert.equal(invalidRange.isError, true);
        assert.equal(invalidRange.structuredContent?.['code'], 'ERR_INVALID_LINE_RANGE');
    });

    it('repo_tree accepts empty path and repo_root_tree exposes workspace root', async () => {
        const treeTool = findTool('repo_tree');
        const tree = await treeTool.handler({ path: '', maxEntries: 5 });
        assert.equal(tree.isError, undefined);
        assert.equal(tree.structuredContent?.['path'], 'src/copilot');

        const rootTool = findTool('repo_root_tree');
        const root = await rootTool.handler({ maxEntries: 20 });
        assert.equal(root.isError, undefined);
        assert.equal(root.structuredContent?.['path'], '.');
        const entries = /** @type {unknown[]} */ (root.structuredContent?.['entries']);
        assert.ok(entries.length > 0);
    });

    it('repo_root_tree redacts protected hidden path metadata', async () => {
        const rootTool = findTool('repo_root_tree');
        const root = await rootTool.handler({ maxEntries: 200, showHidden: true });
        assert.equal(root.isError, undefined);
        assert.equal(root.structuredContent?.['securityPolicy']?.['listProtectedPaths'], 'redacted');
        assert.ok(Number(root.structuredContent?.['blockedEntriesCount'] ?? 0) > 0);
        const entries = /** @type {{ name?: string; path?: string }[]} */ (root.structuredContent?.['entries']);
        assert.equal(
            entries.some((entry) => entry.name === '.env.local' || entry.path === '.env.local'),
            false,
        );
    });

    it('repo_search_text accepts context lines and cursor metadata', async () => {
        const tool = findTool('repo_search_text');
        const result = await tool.handler({
            pattern: 'Copilot MCP Server',
            path: 'src/copilot/mcp',
            contextLines: 2,
            maxResults: 5,
        });
        assert.equal(result.isError, undefined);
        const structured = /** @type {Record<string, unknown>} */ (result.structuredContent);
        assert.equal(structured['contextLines'], 2);
        assert.equal(structured['cursor'], null);
        assert.ok('nextCursor' in structured);
    });

    it('repo_search_text returns match and line counts separately when context is included', async () => {
        const tool = findTool('repo_search_text');
        const result = await tool.handler({
            pattern: 'repo_read_file_chunks',
            path: 'src/copilot/mcp/tools/repo-read.js',
            contextLines: 2,
            maxResults: 20,
        });
        assert.equal(result.isError, undefined);
        const structured = /** @type {Record<string, unknown>} */ (result.structuredContent);
        assert.ok(Number(structured['returnedMatchCount'] ?? 0) > 0);
        assert.ok(Number(structured['returnedLineCount'] ?? 0) >= Number(structured['returnedMatchCount'] ?? 0));
        assert.ok(Number(structured['totalMatchCount'] ?? 0) >= Number(structured['returnedMatchCount'] ?? 0));
    });

    it('repo_find_symbol_usages mirrors LLM-B symbol usage search semantics', async () => {
        const tool = findTool('repo_find_symbol_usages');
        const result = await tool.handler({
            symbol: 'repoReadTools',
            path: 'src/copilot/mcp/tools/repo-read.js',
            maxResults: 20,
        });
        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], true);
        assert.ok(Number(result.structuredContent?.['matchCount'] ?? 0) >= 1);
        assert.ok(Array.isArray(result.structuredContent?.['matches']));
        assert.ok(String(result.structuredContent?.['output'] ?? '').includes('repoReadTools'));
    });

    it('repo_read_file_chunks pages large-file reads with cursor metadata', async () => {
        const tool = findTool('repo_read_file_chunks');
        const result = await tool.handler({
            path: 'src/copilot/mcp/tools/repo-read.js',
            chunkLines: 20,
            endLine: 45,
        });
        assert.equal(result.isError, undefined);
        const structured = /** @type {Record<string, unknown>} */ (result.structuredContent);
        assert.equal(structured['success'], true);
        assert.equal(structured['path'], 'src/copilot/mcp/tools/repo-read.js');
        assert.ok(Array.isArray(structured['chunks']));
        assert.equal(structured['chunkLines'], 20);
        assert.ok('nextCursor' in structured);
    });

    it('repo_read_file_chunks separates returned lines from scanned line metadata', async () => {
        const tool = findTool('repo_read_file_chunks');
        const result = await tool.handler({
            path: 'src/copilot/mcp/tools/repo-read.js',
            chunkLines: 1,
            startLine: 1,
            endLine: 3,
        });
        assert.equal(result.isError, undefined);
        const structured = /** @type {Record<string, unknown>} */ (result.structuredContent);
        assert.equal(structured['returnedLineCount'], 3);
        assert.equal(structured['returnedChunkCount'], 3);
        assert.equal(structured['fileTotalLinesKnown'], false);
        assert.equal(structured['fileTotalLines'], null);
        assert.ok(Number(structured['lastScannedLine'] ?? 0) >= 3);
    });

    it('repo_symbol_search and repo_file_outline expose IO navigation primitives', async () => {
        const symbolTool = findTool('repo_symbol_search');
        const symbolResult = await symbolTool.handler({
            name: 'repoReadTools',
            path: 'src/copilot/mcp',
            maxResults: 5,
        });
        assert.equal(symbolResult.isError, undefined);
        assert.equal(symbolResult.structuredContent?.['success'], true);
        assert.ok(Number(symbolResult.structuredContent?.['matchCount'] ?? 0) >= 1);

        const outlineTool = findTool('repo_file_outline');
        const outlineResult = await outlineTool.handler({
            path: 'src/copilot/mcp/tools/repo-read.js',
            includeTopComments: true,
        });
        assert.equal(outlineResult.isError, undefined);
        assert.equal(outlineResult.structuredContent?.['success'], true);
        assert.ok(Array.isArray(outlineResult.structuredContent?.['symbols']));
        assert.ok(Array.isArray(outlineResult.structuredContent?.['outline']));
        const exports = /** @type {string[]} */ (outlineResult.structuredContent?.['exports'] ?? []);
        assert.ok(exports.includes('repoReadTools'));
    });

    it('mcp_smoke_workspace runs read-only end-to-end checks', async () => {
        const tool = findTool('mcp_smoke_workspace');
        const result = await tool.handler({});
        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], true);
        assert.ok(Array.isArray(result.structuredContent?.['checks']));
    });

    it('repo_index tools expose shared IO index build, status, search, symbols and imports', async () => {
        const buildTool = findTool('repo_index_build');
        const build = await buildTool.handler({
            path: 'src/copilot/mcp/tools',
            include: ['repo-index.js'],
            maxFiles: 5,
            pruneMissing: false,
        });
        assert.equal(build.isError, undefined);
        assert.equal(build.structuredContent?.['success'], true);

        const statusTool = findTool('repo_index_status');
        const status = await statusTool.handler({});
        assert.equal(status.isError, undefined);
        assert.equal(status.structuredContent?.['success'], true);
        assert.equal(typeof status.structuredContent?.['stats'], 'object');

        const searchTool = findTool('repo_index_search');
        const search = await searchTool.handler({ query: 'repoIndexTools', maxResults: 5 });
        assert.equal(search.isError, undefined);
        assert.equal(search.structuredContent?.['success'], true);
        assert.equal(search.structuredContent?.['available'], true);
        assert.ok(String(search.structuredContent?.['output'] ?? '').includes('repo-index.js'));

        const symbolTool = findTool('repo_index_find_symbol');
        const symbol = await symbolTool.handler({ symbol: 'repoIndexTools', exactMatch: true, maxResults: 5 });
        assert.equal(symbol.isError, undefined);
        assert.equal(symbol.structuredContent?.['success'], true);
        assert.ok(Number(symbol.structuredContent?.['matchCount'] ?? 0) >= 1);

        const importsTool = findTool('repo_find_imports');
        const imports = await importsTool.handler({ source: 'zod', exactSource: true, maxResults: 5 });
        assert.equal(imports.isError, undefined);
        assert.equal(imports.structuredContent?.['success'], true);
        assert.ok(String(imports.structuredContent?.['output'] ?? '').includes("from 'zod'"));
    });

    it('repo_diff_files returns a canonical unified diff', async () => {
        const tool = findTool('repo_diff_files');
        const result = await tool.handler({
            pathA: 'src/copilot/mcp/tools/repo-read.js',
            pathB: 'src/copilot/mcp/tools/meta.js',
            contextLines: 1,
        });
        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], true);
        assert.equal(result.structuredContent?.['identical'], false);
        assert.equal(typeof result.structuredContent?.['diff'], 'string');
    });

    it('mcp_capabilities_summary groups the tool surface', async () => {
        const tool = findTool('mcp_capabilities_summary');
        const result = await tool.handler({});
        assert.equal(result.isError, undefined);
        const structured = /** @type {Record<string, unknown>} */ (result.structuredContent);
        assert.ok(Array.isArray(structured['read']));
        assert.ok(/** @type {string[]} */ (structured['read']).includes('repo_root_tree'));
        assert.ok(/** @type {string[]} */ (structured['read']).includes('repo_symbol_search'));
        assert.ok(/** @type {string[]} */ (structured['read']).includes('repo_find_symbol_usages'));
        assert.ok(Array.isArray(structured['index']));
        assert.ok(/** @type {string[]} */ (structured['index']).includes('repo_index_status'));
        assert.ok(/** @type {string[]} */ (structured['runtime']).includes('mcp_tunnel_status'));
    });

    it('project_doctor returns canonical validators', async () => {
        const tool = findTool('project_doctor');
        const result = await tool.handler({ includeScripts: false });

        assert.equal(result.isError, undefined);
        const structured = /** @type {Record<string, unknown>} */ (result.structuredContent);
        const validators = /** @type {Record<string, unknown>} */ (structured['validators']);
        assert.equal(validators['typecheck'], 'npm run typecheck:strict:src.copilot');
        assert.equal(validators['lint'], 'npm run lint:copilot');
        assert.equal(validators['unitMcp'], 'npx vitest --config vitest.copilot.config.js run tests/unit/copilot/mcp');
        assert.equal(validators['unit'], 'npm run test:copilot:unit');
    });
});
