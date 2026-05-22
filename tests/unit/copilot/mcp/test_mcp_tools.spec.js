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
        assert.equal(validators['unit'], 'npm run test:copilot:unit');
    });
});
