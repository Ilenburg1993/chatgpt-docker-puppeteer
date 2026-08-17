// @ts-check
/**
 * Tests for first-band Copilot MCP tools.
 */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { describe, it } from 'vitest';

import { invalidateIoCachePath } from '#copilot/infra/io-cache.js';
import { getCanonicalMcpTools } from '#copilot/mcp';
import {
    getTtlCacheStats,
    recordMcpToolMetric,
    resetMcpMetricsForTests,
    resolveReadPath,
} from '#copilot/mcp/control-plane';
import {
    readRepoReadFileResultCacheStats,
    resetRepoReadResponseCacheForTest,
} from '../../../../src/copilot/mcp/tools/repo-read-cache.js';

/** @param {string} name */
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

    it('repo_read_file supports reduced hash payload modes', async () => {
        const tool = findTool('repo_read_file');
        const returnedOnly = await tool.handler({
            path: 'src/copilot/mcp/README.md',
            startLine: 1,
            endLine: 8,
            hashMode: 'returned',
        });
        assert.equal(returnedOnly.isError, undefined);
        assert.equal(returnedOnly.structuredContent?.['hashMode'], 'returned');
        assert.equal(returnedOnly.structuredContent?.['sha256'], undefined);
        assert.equal(typeof returnedOnly.structuredContent?.['returnedSha256'], 'string');

        const noHashes = await tool.handler({
            path: 'src/copilot/mcp/README.md',
            startLine: 1,
            endLine: 8,
            hashMode: 'none',
        });
        assert.equal(noHashes.isError, undefined);
        assert.equal(noHashes.structuredContent?.['hashMode'], 'none');
        assert.equal(noHashes.structuredContent?.['sha256'], undefined);
        assert.equal(noHashes.structuredContent?.['returnedSha256'], undefined);
    });

    it('repo_read_file batches several reads in one call without duplicating file bodies into legacy text', async () => {
        const tool = findTool('repo_read_file');
        const result = await tool.handler({
            batch: [
                { path: 'src/copilot/mcp/README.md', startLine: 1, endLine: 8, hashMode: 'returned' },
                { path: 'src/copilot/mcp/tools/repo-read.js', startLine: 1, endLine: 8, hashMode: 'none' },
            ],
        });
        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], true);
        assert.equal(result.structuredContent?.['batch'], true);
        assert.equal(result.structuredContent?.['requestCount'], 2);
        const results = /** @type {Record<string, unknown>[]} */ (result.structuredContent?.['results']);
        assert.equal(results.length, 2);
        assert.ok(String(results[0]?.['content'] ?? '').includes('Copilot MCP Server'));
        assert.ok(String(results[1]?.['content'] ?? '').includes('@module copilot/mcp/tools/repo-read'));
        const legacyText = String(result.content?.[0]?.text ?? '');
        assert.ok(legacyText.includes('Read batch completed'));
        assert.equal(legacyText.includes('Copilot MCP Server'), false);
    });

    it('repo_read_file returns identical results for repeated same-window reads through the extracted cache module', async () => {
        resetRepoReadResponseCacheForTest();
        const tool = findTool('repo_read_file');
        const args = {
            path: 'src/copilot/mcp/README.md',
            startLine: 1,
            endLine: 8,
        };
        const first = await tool.handler(args);
        const afterFirst = readRepoReadFileResultCacheStats();
        const second = await tool.handler(args);
        const afterSecond = readRepoReadFileResultCacheStats();

        assert.deepEqual(second.structuredContent, first.structuredContent);
        assert.deepEqual(second.content, first.content);
        assert.equal(afterFirst.misses, 1);
        assert.equal(afterFirst.sets, 1);
        assert.equal(typeof afterFirst.bytes, 'number');
        assert.ok(afterFirst.bytes > 0);
        assert.equal(typeof afterFirst.maxBytes, 'number');
        assert.equal(afterSecond.hits, 1);
        assert.equal(afterSecond.size, 1);
        const resolved = await resolveReadPath(args.path);
        assert.equal(resolved.ok, true);
        if (resolved.ok) invalidateIoCachePath(resolved.resolved);
        const afterInvalidation = readRepoReadFileResultCacheStats();
        assert.equal(afterInvalidation.busInvalidations, 1);
        assert.equal(afterInvalidation.clears, 1);
        assert.equal(afterInvalidation.size, 0);
    });

    it('repo_read_file coalesces concurrent same-window reads through singleflight', async () => {
        resetRepoReadResponseCacheForTest();
        const tool = findTool('repo_read_file');
        const args = {
            path: 'src/copilot/mcp/README.md',
            startLine: 1,
            endLine: 20,
        };
        const [first, second] = await Promise.all([tool.handler(args), tool.handler(args)]);
        const stats = readRepoReadFileResultCacheStats();

        assert.equal(first.isError, undefined);
        assert.equal(second.isError, undefined);
        assert.deepEqual(second.structuredContent, first.structuredContent);
        assert.equal(stats.misses, 1);
        assert.equal(stats.singleflightLeaders, 1);
        assert.equal(stats.singleflightJoins, 1);
        assert.equal(stats.size, 1);
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

    it('repo_root_redaction_status audits root redaction without returning hidden names', async () => {
        const tool = findTool('repo_root_redaction_status');
        const result = await tool.handler({});
        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], true);
        assert.equal(result.structuredContent?.['path'], '.');
        assert.equal(result.structuredContent?.['policy']?.['hiddenNamesReturned'], false);
        assert.equal(result.structuredContent?.['policy']?.['protectedNamesReturned'], false);
        assert.equal(typeof result.structuredContent?.['hiddenInspectableTopLevelCount'], 'number');
        assert.equal(typeof result.structuredContent?.['protectedOrRedactedTopLevelCount'], 'number');
        assert.equal('entries' in (result.structuredContent ?? {}), false);
    });

    it('chatgpt_connector_current_url_status returns saved URL status without client URL input', async () => {
        const tool = findTool('chatgpt_connector_current_url_status');
        const result = await tool.handler({});
        assert.equal(result.isError, undefined);
        assert.ok('currentUrl' in (result.structuredContent ?? {}));
        assert.ok('validation' in (result.structuredContent ?? {}));
        assert.equal(result.structuredContent?.['chatgptForm']?.['authentication'], 'OAuth');
        assert.ok(Array.isArray(result.structuredContent?.['recovery']));
        if (
            result.structuredContent?.['source'] === 'permanent-config' &&
            result.structuredContent?.['validation']?.['ok'] === true
        ) {
            assert.deepEqual(result.structuredContent?.['recovery'], []);
            assert.equal(result.structuredContent?.['permanentTunnel']?.['ready'], true);
            assert.equal(result.structuredContent?.['temporaryTunnel']?.['ignoredForOperationalReadiness'], true);
        }
    });

    it('repo_search_text accepts context lines and cursor metadata', async () => {
        const tool = findTool('repo_search_text');
        const result = await tool.handler({
            pattern: 'Copilot MCP Server',
            path: 'src/copilot/mcp/README.md',
            contextLines: 2,
            maxResults: 5,
        });
        assert.equal(result.isError, undefined);
        const structured = /** @type {Record<string, unknown>} */ (result.structuredContent);
        assert.equal(structured['contextLines'], 2);
        assert.equal(structured['cursor'], null);
        assert.ok('nextCursor' in structured);
    });

    it('repo_search_text accepts query as a client-friendly alias for pattern', async () => {
        const tool = findTool('repo_search_text');
        const result = await tool.handler({
            query: 'Copilot MCP Server',
            path: 'src/copilot/mcp',
            maxResults: 5,
        });
        assert.equal(result.isError, undefined);
        const structured = /** @type {Record<string, unknown>} */ (result.structuredContent);
        assert.equal(structured['pattern'], 'Copilot MCP Server');
        assert.equal(structured['query'], 'Copilot MCP Server');
        assert.ok(Number(structured['returnedMatchCount'] ?? 0) > 0);
    });

    it('repo_search_text batches several searches and keeps heavy outputs only in structured results', async () => {
        const tool = findTool('repo_search_text');
        const result = await tool.handler({
            batch: [
                { query: 'repo_read_file', path: 'src/copilot/mcp/tools', maxResults: 5 },
                { query: 'repo_apply_patch', path: 'src/copilot/mcp/tools', maxResults: 5 },
            ],
        });
        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], true);
        assert.equal(result.structuredContent?.['batch'], true);
        assert.equal(result.structuredContent?.['requestCount'], 2);
        const results = /** @type {Record<string, unknown>[]} */ (result.structuredContent?.['results']);
        assert.equal(results.length, 2);
        assert.ok(Number(results[0]?.['returnedMatchCount'] ?? 0) > 0);
        assert.ok(Number(results[1]?.['returnedMatchCount'] ?? 0) > 0);
        const legacyText = String(result.content?.[0]?.text ?? '');
        assert.ok(legacyText.includes('Search batch completed'));
        assert.equal(legacyText.includes('repo_read_file.js'), false);
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
        assert.equal(structured['countsPostSanitization'], true);
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

    it('repo_read_file_chunks returns identical results for repeated same-window chunk reads through the extracted cache module', async () => {
        resetRepoReadResponseCacheForTest();
        const tool = findTool('repo_read_file_chunks');
        const args = {
            path: 'src/copilot/mcp/tools/repo-read.js',
            chunkLines: 10,
            startLine: 1,
            endLine: 20,
        };
        const first = await tool.handler(args);
        const afterFirst = readRepoReadFileResultCacheStats();
        const second = await tool.handler(args);
        const afterSecond = readRepoReadFileResultCacheStats();
        assert.equal(first.isError, undefined);
        assert.deepEqual(second.structuredContent, first.structuredContent);
        assert.deepEqual(second.content, first.content);
        assert.equal(afterFirst.chunkMisses, 1);
        assert.equal(afterFirst.chunkSets, 1);
        assert.equal(typeof afterFirst.chunkBytes, 'number');
        assert.ok(afterFirst.chunkBytes > 0);
        assert.equal(afterSecond.chunkHits, 1);
        assert.equal(afterSecond.chunkSize, 1);
        const resolved = await resolveReadPath(args.path);
        assert.equal(resolved.ok, true);
        if (resolved.ok) invalidateIoCachePath(resolved.resolved);
        const afterInvalidation = readRepoReadFileResultCacheStats();
        assert.equal(afterInvalidation.busInvalidations, 1);
        assert.equal(afterInvalidation.chunkClears, 1);
        assert.equal(afterInvalidation.chunkSize, 0);
    });

    it('repo_read_file_chunks coalesces concurrent same-window chunk reads through singleflight', async () => {
        resetRepoReadResponseCacheForTest();
        const tool = findTool('repo_read_file_chunks');
        const args = {
            path: 'src/copilot/mcp/tools/repo-read.js',
            chunkLines: 10,
            startLine: 1,
            endLine: 30,
        };
        const [first, second] = await Promise.all([tool.handler(args), tool.handler(args)]);
        const stats = readRepoReadFileResultCacheStats();

        assert.equal(first.isError, undefined);
        assert.equal(second.isError, undefined);
        assert.deepEqual(second.structuredContent, first.structuredContent);
        assert.equal(stats.chunkMisses, 1);
        assert.equal(stats.chunkSingleflightLeaders, 1);
        assert.equal(stats.chunkSingleflightJoins, 1);
        assert.equal(stats.chunkSize, 1);
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

        const boundedOutline = await outlineTool.handler({
            path: 'src/copilot/mcp/tools/repo-read.js',
            maxItems: 1,
            maxBytes: 512,
        });
        assert.equal(boundedOutline.structuredContent?.['truncated'], true);
        assert.equal(boundedOutline.structuredContent?.['maxItems'], 1);
        assert.ok(Number(boundedOutline.structuredContent?.['returnedContentBytes'] ?? Infinity) <= 512);
        assert.ok(
            /** @type {unknown[]} */ (boundedOutline.structuredContent?.['symbols'] ?? []).length <= 1,
        );
    });

    it('mcp_smoke_workspace runs read-only end-to-end checks', async () => {
        const tool = findTool('mcp_smoke_workspace');
        const result = await tool.handler({ issuer: 'http://not-https.example.com' });
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
        assert.equal(typeof status.structuredContent?.['autoBuild'], 'object');

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

        const orphanImportsTool = findTool('repo_find_orphan_imports');
        const orphanImports = await orphanImportsTool.handler({
            path: 'src/copilot/mcp/tools/repo-index.js',
            maxResults: 5,
        });
        assert.equal(orphanImports.isError, undefined);
        assert.equal(orphanImports.structuredContent?.['success'], true);
        assert.equal(orphanImports.structuredContent?.['totalOrphans'], 0);
        assert.equal(orphanImports.structuredContent?.['trueOrphanCount'], 0);
        assert.equal(orphanImports.structuredContent?.['protectedCount'], 0);
        assert.equal(orphanImports.structuredContent?.['aliasResolutionGapCount'], 0);
        assert.equal(typeof orphanImports.structuredContent?.['checkedImports'], 'number');

        const orphanImportsDir = await orphanImportsTool.handler({
            path: 'src/copilot/mcp/tools',
            maxFiles: 30,
            maxResults: 20,
        });
        assert.equal(orphanImportsDir.isError, undefined);
        assert.equal(orphanImportsDir.structuredContent?.['success'], true);
        assert.equal(orphanImportsDir.structuredContent?.['totalOrphans'], 0);
        assert.ok(Number(orphanImportsDir.structuredContent?.['checkedImports'] ?? 0) > 0);
        assert.ok(Number(orphanImportsDir.structuredContent?.['scannedFiles'] ?? 0) > 1);

        const importTargetCache = getTtlCacheStats().find((entry) => entry.name === 'repo-index-import-target-exists');
        assert.equal(importTargetCache?.ttlMs, 5 * 60 * 1000);
        assert.equal(importTargetCache?.maxEntries, 10_000);
        assert.ok(Number(importTargetCache?.size ?? 0) <= Number(importTargetCache?.maxEntries ?? 0));
    });

    it('repo_find_orphan_imports resolves package imports and classifies protected targets', async () => {
        const orphanImportsTool = findTool('repo_find_orphan_imports');
        const tempDir = await mkdtemp(join(process.cwd(), '.tmp-copilot-package-imports-'));
        const importerPath = join(tempDir, 'importer.js');
        const relativeImporterPath = relative(process.cwd(), importerPath);

        try {
            await writeFile(
                importerPath,
                [
                    "import '#copilot/sdk/di';",
                    "import '#copilot/sdk/agents';",
                    "import '#copilot/sdk/session-runtime';",
                    "await import('#copilot/infra/public/cache');",
                    'export const value = 1;',
                    '',
                ].join('\n'),
            );

            const aliases = await orphanImportsTool.handler({
                path: relativeImporterPath,
                includeDynamic: true,
                maxResults: 20,
            });
            assert.equal(aliases.isError, undefined);
            assert.equal(aliases.structuredContent?.['success'], true);
            assert.equal(aliases.structuredContent?.['trueOrphanCount'], 0);
            assert.equal(aliases.structuredContent?.['protectedCount'], 0);
            assert.equal(aliases.structuredContent?.['aliasResolutionGapCount'], 0);
            assert.equal(aliases.structuredContent?.['checkedImports'], 4);

            const protectedResult = await orphanImportsTool.handler({
                path: 'src/copilot/model-gateway/registry/env-byok-compat-importer.js',
                maxResults: 20,
            });
            assert.equal(protectedResult.isError, undefined);
            assert.equal(protectedResult.structuredContent?.['success'], true);
            assert.equal(protectedResult.structuredContent?.['trueOrphanCount'], 0);
            assert.ok(Number(protectedResult.structuredContent?.['protectedCount'] ?? 0) >= 1);
            assert.ok(
                String(protectedResult.structuredContent?.['output'] ?? '').includes('protected/unverifiable'),
            );
        } finally {
            await rm(tempDir, { recursive: true, force: true });
        }
    });

    it('repo_find_orphan_imports clears cached import targets after invalidation', async () => {
        const orphanImportsTool = findTool('repo_find_orphan_imports');
        const tempDir = await mkdtemp(join(process.cwd(), '.tmp-copilot-orphan-cache-'));
        const importerPath = join(tempDir, 'importer.js');
        const targetPath = join(tempDir, 'target.js');
        const relativeImporterPath = relative(process.cwd(), importerPath);
        const relativeTargetPath = relative(process.cwd(), targetPath);

        try {
            await writeFile(importerPath, "import './target.js';\nexport const value = 1;\n");
            await writeFile(targetPath, 'export const target = 1;\n');

            const first = await orphanImportsTool.handler({
                path: relativeImporterPath,
                maxResults: 20,
            });
            assert.equal(first.isError, undefined);
            assert.equal(first.structuredContent?.['success'], true);
            assert.equal(first.structuredContent?.['totalOrphans'], 0);

            await rm(targetPath);
            invalidateIoCachePath(relativeTargetPath);

            const second = await orphanImportsTool.handler({
                path: relativeImporterPath,
                maxResults: 20,
            });
            assert.equal(second.isError, undefined);
            assert.equal(second.structuredContent?.['success'], true);
            assert.equal(second.structuredContent?.['totalOrphans'], 1);
            assert.equal(second.structuredContent?.['checkedImports'], 1);
        } finally {
            await rm(tempDir, { recursive: true, force: true });
        }
    });

    it('repo_find_orphan_imports respects recursive and depth options for indexed directories', async () => {
        const buildTool = findTool('repo_index_build');
        const orphanImportsTool = findTool('repo_find_orphan_imports');
        const tempDir = await mkdtemp(join(process.cwd(), '.tmp-copilot-orphan-depth-'));
        const nestedDir = join(tempDir, 'nested');
        const relativeTempDir = relative(process.cwd(), tempDir);

        try {
            await mkdir(nestedDir, { recursive: true });
            await writeFile(join(tempDir, 'root.js'), "import './missing-root.js';\nexport const root = 1;\n");
            await writeFile(join(nestedDir, 'child.js'), "import './missing-child.js';\nexport const child = 1;\n");

            const build = await buildTool.handler({
                path: relativeTempDir,
                include: ['**/*.js'],
                maxFiles: 10,
                pruneMissing: false,
            });
            assert.equal(build.isError, undefined);
            assert.equal(build.structuredContent?.['success'], true);

            const shallow = await orphanImportsTool.handler({
                path: relativeTempDir,
                recursive: false,
                maxResults: 10,
            });
            assert.equal(shallow.isError, undefined);
            assert.equal(shallow.structuredContent?.['success'], true);
            assert.equal(shallow.structuredContent?.['totalOrphans'], 1);
            assert.equal(shallow.structuredContent?.['skippedByDepth'], 1);
            assert.ok(String(shallow.structuredContent?.['output'] ?? '').includes('root.js'));
            assert.ok(!String(shallow.structuredContent?.['output'] ?? '').includes('nested/child.js'));

            const depthTwo = await orphanImportsTool.handler({
                path: relativeTempDir,
                depth: 2,
                maxResults: 10,
            });
            assert.equal(depthTwo.isError, undefined);
            assert.equal(depthTwo.structuredContent?.['success'], true);
            assert.equal(depthTwo.structuredContent?.['totalOrphans'], 2);
            assert.ok(String(depthTwo.structuredContent?.['output'] ?? '').includes('nested/child.js'));
        } finally {
            await rm(tempDir, { recursive: true, force: true });
        }
    });

    it('repo_diff_files returns a canonical unified diff', async () => {
        const tool = findTool('repo_diff_files');
        const result = await tool.handler({
            pathA: 'src/copilot/mcp/tools/repo-read.js',
            pathB: 'src/copilot/mcp/tools/meta.js',
            contextLines: 1,
            includeDiffPreview: true,
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
        assert.ok(/** @type {string[]} */ (structured['runtime']).includes('delegate_to_repo_autonomy_runner'));
        assert.ok(/** @type {string[]} */ (structured['runtime']).includes('mcp_golden_prompts'));
        assert.ok(/** @type {string[]} */ (structured['runtime']).includes('mcp_maintenance_plan'));
        assert.ok(/** @type {string[]} */ (structured['runtime']).includes('mcp_session_profile'));
        assert.ok(/** @type {string[]} */ (structured['runtime']).includes('mcp_tools_status'));
        assert.ok(/** @type {string[]} */ (structured['runtime']).includes('mcp_tunnel_status'));
        assert.ok(/** @type {string[]} */ (structured['runtime']).includes('mcp_connector_smoke_refresh'));
        assert.ok(/** @type {string[]} */ (structured['runtime']).includes('mcp_post_restart_readiness'));
        assert.ok(/** @type {string[]} */ (structured['validation']).includes('mcp_validation_dashboard'));
        assert.ok(/** @type {string[]} */ (structured['validation']).includes('job_get_summary'));
        assert.equal(typeof structured['annotationProfile'], 'object');
        const authProfile = /** @type {Record<string, unknown>} */ (structured['authProfile']);
        assert.equal(authProfile['maxPowerDefault'], true);
        assert.ok(/** @type {string[]} */ (authProfile['initialScopes']).includes('repo:admin'));
    });

    it('mcp_tools_status exposes annotation and approval planning metadata', async () => {
        const tool = findTool('mcp_tools_status');
        const result = await tool.handler({});
        assert.equal(result.isError, undefined);
        const structured = /** @type {Record<string, unknown>} */ (result.structuredContent);
        assert.equal(structured['success'], true);
        assert.equal(structured['totalTools'], getCanonicalMcpTools().length);
        assert.ok(Number(structured['readOnlyCount'] ?? 0) > 0);
        assert.ok(Number(structured['boundedWriteCount'] ?? 0) > 0);
        assert.ok(Number(structured['destructiveCount'] ?? 0) > 0);
        assert.ok(/** @type {string[]} */ (structured['rememberApprovalCandidates']).includes('repo_apply_patch'));
        assert.ok(
            /** @type {string[]} */ (structured['rememberApprovalCandidates']).includes('repo_apply_patch_batch'),
        );
        assert.equal(/** @type {string[]} */ (structured['rememberApprovalCandidates']).includes('job_cancel'), false);
        assert.ok(/** @type {string[]} */ (structured['destructiveTools']).includes('repo_remove_file'));
        const approvalFrictionProfile = /** @type {Record<string, unknown>} */ (structured['approvalFrictionProfile']);
        assert.equal('rememberApprovalCandidates' in approvalFrictionProfile, false);
        assert.ok(/** @type {string[]} */ (approvalFrictionProfile['neverRememberApproval']).includes('job_cancel'));
        assert.ok(
            /** @type {string[][]} */ (approvalFrictionProfile['planFirstWorkflows']).some(
                (workflow) => workflow[0] === 'repo_patch_batch_plan' && workflow[1] === 'repo_apply_patch_batch',
            ),
        );
        assert.ok(
            /** @type {string[][]} */ (approvalFrictionProfile['planFirstWorkflows']).some(
                (workflow) => workflow[0] === 'mcp_validation_plan' && workflow[1] === 'run_copilot_validator',
            ),
        );
        assert.ok(
            /** @type {string[]} */ (approvalFrictionProfile['firstRememberApprovalWave']).includes(
                'run_copilot_validator',
            ),
        );
        assert.equal(
            /** @type {string[]} */ (approvalFrictionProfile['firstRememberApprovalWave']).includes(
                'mcp_run_safe_validation_suite',
            ),
            false,
        );
        assert.equal('tools' in structured, false);
        const metadataCoverage = /** @type {Record<string, unknown>} */ (structured['metadataCoverage']);
        assert.equal(metadataCoverage['outputSchemaPolicy'], 'specific-only');
        assert.equal(metadataCoverage['specificOutputSchemaCount'], 2);
        assert.equal(metadataCoverage['securityMetadataCount'], getCanonicalMcpTools().length);
        assert.equal(metadataCoverage['securityComplete'], true);
        assert.equal(structured['detailsTool'], 'mcp_capabilities_summary');
        const hostApprovalProfile = /** @type {Record<string, unknown>} */ (structured['hostApprovalProfile']);
        assert.equal(hostApprovalProfile['oauthGrantsAllRepoScopesByDefault'], true);
        assert.ok(Buffer.byteLength(JSON.stringify(structured)) < 15 * 1024);
    });

    it('mcp_session_profile returns the recommended ChatGPT autonomy profile', async () => {
        const tool = findTool('mcp_session_profile');
        const result = await tool.handler({});
        assert.equal(result.isError, undefined);
        const structured = /** @type {Record<string, unknown>} */ (result.structuredContent);
        assert.equal(structured['success'], true);
        assert.equal(structured['profile'], 'chatgpt-max-autonomy-permanent-cloudflare-oauth');
        const recommendedFirstCalls = /** @type {string[]} */ (structured['recommendedFirstCalls']);
        assert.deepEqual(recommendedFirstCalls, ['repo_status']);
        assert.ok(recommendedFirstCalls.length <= 3);
        assert.equal(recommendedFirstCalls.includes('mcp_cloudflare_remote_audit'), false);
        const diagnosticsOnDemand = /** @type {Record<string, unknown>} */ (structured['diagnosticsOnDemand']);
        assert.ok(/** @type {string[]} */ (diagnosticsOnDemand['cloudflare']).includes('mcp_cloudflare_remote_audit'));
        const approvalGuidance = /** @type {Record<string, unknown>} */ (structured['approvalGuidance']);
        assert.ok(
            /** @type {string[]} */ (approvalGuidance['avoidUnlessExplicitlyNeeded']).includes('repo_remove_file'),
        );
        const tunnelGuidance = /** @type {Record<string, unknown>} */ (structured['tunnelGuidance']);
        assert.equal(tunnelGuidance['mode'], 'Cloudflare named permanent tunnel');
        assert.equal(tunnelGuidance['expectedUrlShape'], 'https://mcp.aurelin.org/mcp');
        assert.ok(Buffer.byteLength(JSON.stringify(structured)) < 10 * 1024);
        assert.equal('capabilities' in structured, false);
        assert.equal('smokePrompts' in structured, false);
    });

    it('mcp_latency_dashboard ranks result payload size separately from handler latency', async () => {
        resetMcpMetricsForTests();
        recordMcpToolMetric('large-single-result', {
            durationMs: 2,
            isError: false,
            resultSize: { strategy: 'stringify', bytes: 100_000 },
        });
        for (let index = 0; index < 3; index += 1) {
            recordMcpToolMetric('chatty-result', {
                durationMs: 1,
                isError: false,
                resultSize: { strategy: 'hint', bytes: 50_000 },
            });
        }
        const tool = findTool('mcp_latency_dashboard');
        const result = await tool.handler({ minSampleCalls: 1, maxRows: 5 });
        const structured = /** @type {Record<string, unknown>} */ (result.structuredContent);
        const largest = /** @type {Record<string, unknown>[]} */ (structured['largestResultPayloads']);
        const volume = /** @type {Record<string, unknown>[]} */ (structured['highestResultVolume']);
        assert.equal(largest[0]?.['name'], 'large-single-result');
        assert.equal(largest[0]?.['averageBytes'], 100_000);
        assert.equal(volume[0]?.['name'], 'chatty-result');
        assert.equal(volume[0]?.['totalBytes'], 150_000);
        assert.equal(structured['summary']?.['largestAverageResultBytes'], 100_000);
        resetMcpMetricsForTests();
    });

    it('mcp_post_restart_readiness reports compact permanent tunnel readiness', async () => {
        const tool = findTool('mcp_post_restart_readiness');
        const result = await tool.handler({});
        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], true);
        assert.ok('ready' in (result.structuredContent ?? {}));
        assert.equal(result.structuredContent?.['connectorUrl'], 'https://mcp.aurelin.org/mcp');
        assert.ok(Array.isArray(result.structuredContent?.['nextActions']));
    });

    it('mcp maintenance tools plan and dry-run fixed safe batches', async () => {
        const planTool = findTool('mcp_maintenance_plan');
        const plan = await planTool.handler({});
        assert.equal(plan.isError, undefined);
        assert.equal(plan.structuredContent?.['success'], true);
        assert.equal(plan.structuredContent?.['defaultDryRun'], true);
        assert.ok(Array.isArray(plan.structuredContent?.['items']));
        const items = /** @type {{ fix?: string; risk?: string }[]} */ (plan.structuredContent?.['items']);
        assert.ok(items.some((item) => item.fix === 'ai-artifacts-report' && item.risk === 'read-only'));

        const applyTool = findTool('mcp_maintenance_apply_safe_fixes');
        const dryRun = await applyTool.handler({
            fixes: ['workspace-status', 'summarize-tools', 'ai-artifacts-report', 'run-mcp-smoke', 'refresh-index'],
            dryRun: true,
        });
        assert.equal(dryRun.isError, undefined);
        assert.equal(dryRun.structuredContent?.['success'], true);
        assert.equal(dryRun.structuredContent?.['dryRun'], true);
        const results = /** @type {{ fix?: string; dryRun?: boolean; plannedPath?: string }[]} */ (
            dryRun.structuredContent?.['results']
        );
        assert.ok(results.some((result) => result.fix === 'refresh-index' && result.plannedPath === 'src/copilot'));
        assert.ok(results.some((result) => result.fix === 'ai-artifacts-report'));
        assert.ok(results.every((result) => result.dryRun === true));
    });

    it('delegate_to_repo_autonomy_runner dry-runs fixed autonomy missions', async () => {
        const tool = findTool('delegate_to_repo_autonomy_runner');
        const result = await tool.handler({ mission: 'diagnose-mcp', dryRun: true });
        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], true);
        assert.equal(result.structuredContent?.['dryRun'], true);
        assert.equal(result.structuredContent?.['executed'], false);
        assert.equal(result.structuredContent?.['constraints']?.['arbitraryShell'], false);
        const plan = /** @type {{ step?: string }[]} */ (result.structuredContent?.['plan']);
        assert.ok(plan.some((step) => step.step === 'mcp_smoke_workspace'));

        const focused = await tool.handler({
            mission: 'validate-focused',
            testFile: 'tests/unit/copilot/mcp/test_mcp_tools.spec.js',
            dryRun: true,
        });
        assert.equal(focused.isError, undefined);
        assert.equal(focused.structuredContent?.['testFile'], 'tests/unit/copilot/mcp/test_mcp_tools.spec.js');
        const focusedPlan = /** @type {{ step?: string }[]} */ (focused.structuredContent?.['plan']);
        assert.ok(focusedPlan.some((step) => step.step === 'run_copilot_validator'));
        assert.equal(focusedPlan.some((step) => step.step === 'mcp_run_safe_validation_suite'), false);

        const missingFocusedFile = await tool.handler({ mission: 'validate-focused', dryRun: true });
        assert.equal(missingFocusedFile.isError, true);
        assert.equal(missingFocusedFile.structuredContent?.['code'], 'ERR_FOCUSED_TEST_FILE_REQUIRED');

        const cacheBenchmark = await tool.handler({ mission: 'benchmark-io-cache', dryRun: true });
        assert.equal(cacheBenchmark.isError, undefined);
        assert.equal(cacheBenchmark.structuredContent?.['executed'], false);
        const cacheBenchmarkPlan = /** @type {{ step?: string }[]} */ (cacheBenchmark.structuredContent?.['plan']);
        assert.ok(cacheBenchmarkPlan.some((step) => step.step === 'scheduled_io_cache_benchmark_runner'));
        assert.equal(cacheBenchmarkPlan.some((step) => step.step === 'mcp_run_safe_validation_suite'), false);

        const benchmark = await tool.handler({ mission: 'benchmark-transport', dryRun: true });
        assert.equal(benchmark.isError, undefined);
        assert.equal(benchmark.structuredContent?.['executed'], false);
        const benchmarkPlan = /** @type {{ step?: string }[]} */ (benchmark.structuredContent?.['plan']);
        assert.ok(benchmarkPlan.some((step) => step.step === 'scheduled_transport_benchmark_runner'));
        assert.equal(benchmarkPlan.some((step) => step.step === 'mcp_run_safe_validation_suite'), false);
    });

    it('mcp_golden_prompts returns real-ChatGPT measurement prompts', async () => {
        const tool = findTool('mcp_golden_prompts');
        const result = await tool.handler({});
        assert.equal(result.isError, undefined);
        const structured = /** @type {Record<string, unknown>} */ (result.structuredContent);
        assert.equal(structured['success'], true);
        assert.ok(Array.isArray(structured['prompts']));
        assert.ok(/** @type {unknown[]} */ (structured['prompts']).length >= 6);
        assert.ok(/** @type {string[]} */ (structured['measurementFields']).includes('approvalPromptsShown'));
        assert.ok(/** @type {string[]} */ (structured['measurementFields']).includes('hostBlockCode'));
        assert.equal(typeof structured['hostBlockTemplate'], 'object');
    });

    it('mcp_apps_sdk_readiness reports that CSP is widget-only for this repo MCP', async () => {
        const tool = findTool('mcp_apps_sdk_readiness');
        const result = await tool.handler({});
        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], true);
        const appsSdk = /** @type {Record<string, unknown>} */ (result.structuredContent?.['appsSdk']);
        const companyKnowledge = /** @type {Record<string, unknown>} */ (
            result.structuredContent?.['companyKnowledge']
        );
        assert.equal(appsSdk['cspApplicable'], true);
        assert.equal(appsSdk['hasWidgetResource'], true);
        assert.equal(appsSdk['hasCsp'], true);
        assert.equal(companyKnowledge['searchFetchToolsDetected'], true);
        assert.deepEqual(companyKnowledge['toolNames'], ['search', 'fetch']);
        assert.equal(typeof result.structuredContent?.['promptFrictionImpact'], 'string');
    });

    it('mcp_host_block_diagnostics uses hard evidence before heuristic host-block labels', async () => {
        const tool = findTool('mcp_host_block_diagnostics');
        const result = await tool.handler({
            toolName: 'repo_root_tree',
            argsShape: 'showHidden=true',
            hostMessage: 'Blocked by host before MCP call',
            mcpReachedServer: false,
        });
        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], true);
        assert.equal(result.structuredContent?.['classification']?.['code'], 'CHATGPT_HOST_PRECALL_BLOCK');
        assert.equal(result.structuredContent?.['classification']?.['layer'], 'chatgpt-host');
        assert.equal(result.structuredContent?.['classification']?.['confidence'], 'high');
        assert.equal(result.structuredContent?.['observed']?.['mcpReachedServer'], false);
        assert.equal(typeof result.structuredContent?.['auditTemplate'], 'object');
    });

    it('mcp_host_block_diagnostics separates OAuth reauth from host precall blocks', async () => {
        const tool = findTool('mcp_host_block_diagnostics');
        const result = await tool.handler({
            toolName: 'repo_status',
            mcpReachedServer: true,
            httpStatus: 401,
            wwwAuthenticatePresent: true,
            hostMessage: 'Server returned 401: Reauthentication required',
        });
        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['classification']?.['code'], 'MCP_AUTH_CHALLENGE_OR_REAUTH');
        assert.equal(result.structuredContent?.['classification']?.['layer'], 'mcp-oauth-auth');
        assert.equal(result.structuredContent?.['classification']?.['confidence'], 'high');
        assert.equal(result.structuredContent?.['observed']?.['mcpReachedServer'], true);
        assert.equal(result.structuredContent?.['observed']?.['httpStatus'], 401);
    });

    it('mcp_auth_profile exposes OAuth readiness metadata without requiring enforcement', async () => {
        const tool = findTool('mcp_auth_profile');
        const result = await tool.handler({ scopes: ['repo:read'] });
        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], true);
        assert.equal(typeof result.structuredContent?.['protectedResourceMetadataUrl'], 'string');
        assert.match(String(result.structuredContent?.['challengePreview'] ?? ''), /Bearer/);
        assert.equal(typeof result.structuredContent?.['protectedResourceMetadata'], 'object');
        assert.equal(typeof result.structuredContent?.['environmentTemplates'], 'object');
    });

    it('mcp_oauth_friction_audit reports metadata alignment and approval boundaries', async () => {
        const tool = findTool('mcp_oauth_friction_audit');
        const result = await tool.handler({});
        assert.equal(result.isError, undefined);
        // The tool returns an okResult wrapper with structuredContent-like fields in this test harness
        // Support both shapes for compatibility.
        const structured = result.structuredContent ?? result;
        assert.equal(structured['success'], true);
        assert.equal(typeof structured['reauthRisk'], 'string');
        assert.equal(typeof structured['approvalImpact'], 'string');
        const metadataAlignment = /** @type {Record<string, unknown>} */ (structured['metadataAlignment']);
        assert.equal(typeof metadataAlignment['resourceMatchesAudience'], 'boolean');
        const toolScopes = /** @type {Record<string, unknown>} */ (structured['toolScopes']);
        assert.ok(Array.isArray(toolScopes['publicDiagnosticTools']));
    });

    it('mcp_oauth_issuer_diagnostics reports missing issuer without network calls', async () => {
        const tool = findTool('mcp_oauth_issuer_diagnostics');
        const result = await tool.handler({ issuer: 'http://not-https.example.com' });
        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], true);
        assert.equal(result.structuredContent?.['ready'], false);
        assert.equal(result.structuredContent?.['issuer'], null);
        assert.ok(Array.isArray(result.structuredContent?.['checkedUrls']));
    });

    it('mcp_autonomy_power_score returns a deterministic connector posture score', async () => {
        const tool = findTool('mcp_autonomy_power_score');
        const result = await tool.handler({});
        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], true);
        assert.equal(typeof result.structuredContent?.['score'], 'number');
        assert.equal(typeof result.structuredContent?.['grade'], 'string');
        assert.equal(typeof result.structuredContent?.['toolCounts'], 'object');
        const auth = /** @type {Record<string, unknown>} */ (result.structuredContent?.['auth']);
        assert.equal(auth['maxPowerRepoScopesByDefault'], true);
        assert.ok(/** @type {string[]} */ (auth['initialScopes']).includes('repo:write'));
    });

    it('plan-only tools return read-only next-call previews for sensitive operations', async () => {
        const patchPlanTool = findTool('repo_patch_plan');
        const patchPlan = await patchPlanTool.handler({
            path: 'src/copilot/mcp/registry.js',
            old_string: 'getCanonicalMcpTools',
            new_string: 'getCanonicalMcpTools',
        });
        assert.equal(patchPlan.isError, undefined);
        assert.equal(patchPlan.structuredContent?.['success'], true);
        assert.equal(patchPlan.structuredContent?.['plannedTool'], 'repo_apply_patch');
        assert.equal(typeof patchPlan.structuredContent?.['sha256'], 'string');

        const patchBatchPlanTool = findTool('repo_patch_batch_plan');
        const patchBatchPlan = await patchBatchPlanTool.handler({
            operations: [
                {
                    path: 'src/copilot/mcp/README.md',
                    old_string: 'Copilot MCP Server',
                    new_string: 'Copilot MCP Server',
                    allowNoop: true,
                },
            ],
        });
        assert.equal(patchBatchPlan.isError, undefined);
        assert.equal(patchBatchPlan.structuredContent?.['success'], true);
        assert.equal(patchBatchPlan.structuredContent?.['plannedTool'], 'repo_apply_patch_batch');
        assert.equal(patchBatchPlan.structuredContent?.['operationCount'], 1);
        assert.equal(patchBatchPlan.structuredContent?.['nextCall']?.['tool'], 'repo_apply_patch_batch');

        const applyPatchBatchTool = findTool('repo_apply_patch_batch');
        const applyPatchBatchDryRun = await applyPatchBatchTool.handler({
            operations: [
                {
                    path: 'src/copilot/mcp/README.md',
                    old_string: 'Copilot MCP Server',
                    new_string: 'Copilot MCP Server',
                    allowNoop: true,
                },
            ],
        });
        assert.equal(applyPatchBatchDryRun.isError, undefined);
        assert.equal(applyPatchBatchDryRun.structuredContent?.['success'], true);
        assert.equal(applyPatchBatchDryRun.structuredContent?.['dryRun'], true);
        assert.equal(applyPatchBatchDryRun.structuredContent?.['operationCount'], 1);
        assert.deepEqual(applyPatchBatchDryRun.structuredContent?.['applied'], []);

        const applyPatchBatchWithoutConfirm = await applyPatchBatchTool.handler({
            operations: [
                {
                    path: 'src/copilot/mcp/README.md',
                    old_string: 'Copilot MCP Server',
                    new_string: 'Copilot MCP Server',
                    allowNoop: true,
                },
            ],
            dryRun: false,
        });
        assert.equal(applyPatchBatchWithoutConfirm.isError, true);
        assert.equal(applyPatchBatchWithoutConfirm.structuredContent?.['code'], 'ERR_PATCH_BATCH_CONFIRM_REQUIRED');

        const createPlanTool = findTool('repo_create_file_plan');
        const createPlan = await createPlanTool.handler({
            path: 'src/copilot/.ai/jobs/plan-only-created.txt',
            content: 'planned\n',
        });
        assert.equal(createPlan.isError, undefined);
        assert.equal(createPlan.structuredContent?.['plannedTool'], 'repo_create_file');

        const validationPlanTool = findTool('mcp_validation_plan');
        const inspectFirstPlan = await validationPlanTool.handler({});
        assert.equal(inspectFirstPlan.isError, undefined);
        assert.equal(inspectFirstPlan.structuredContent?.['recommendation'], 'no-validator-yet');
        assert.equal(inspectFirstPlan.structuredContent?.['plannedTool'], null);

        const focusedPlan = await validationPlanTool.handler({
            testFile: 'tests/unit/copilot/mcp/test_mcp_jobs.spec.js',
        });
        assert.equal(focusedPlan.isError, undefined);
        assert.equal(focusedPlan.structuredContent?.['plannedTool'], 'run_copilot_validator');
        assert.equal(focusedPlan.structuredContent?.['validator'], 'unit-focused');
        assert.equal(focusedPlan.structuredContent?.['breadth'], 'file-scoped');

        const broadPlan = await validationPlanTool.handler({ suite: 'mcp-fast' });
        assert.equal(broadPlan.isError, undefined);
        assert.equal(broadPlan.structuredContent?.['validator'], 'suite-mcp-fast');
        assert.equal(broadPlan.structuredContent?.['broadValidation'], true);
    });

    it('repo_apply_patch_batch supports sequential atomic patches to the same file', async () => {
        const jobsRoot = join(process.cwd(), 'src/copilot/.ai/jobs');
        await mkdir(jobsRoot, { recursive: true });
        const tempDir = await mkdtemp(join(jobsRoot, 'same-file-patch-batch-'));
        const absolutePath = join(tempDir, 'sample.txt');
        const repoPath = relative(process.cwd(), absolutePath).replaceAll('\\', '/');
        await writeFile(absolutePath, 'alpha\nomega\n', 'utf8');
        try {
            const tool = findTool('repo_apply_patch_batch');
            const operations = [
                { path: repoPath, old_string: 'alpha', new_string: 'beta' },
                { path: repoPath, old_string: 'beta', new_string: 'gamma' },
            ];
            const dryRun = await tool.handler({ operations });
            assert.equal(dryRun.isError, undefined);
            assert.equal(dryRun.structuredContent?.['success'], true);
            const planned = /** @type {Record<string, unknown>[]} */ (dryRun.structuredContent?.['operations']);
            assert.equal(planned.length, 2);
            assert.equal(planned[0]?.['groupedSameFile'], true);
            assert.equal(planned[1]?.['groupedSameFile'], true);

            const applied = await tool.handler({ operations, dryRun: false, confirmBatch: true });
            assert.equal(applied.isError, undefined);
            assert.equal(applied.structuredContent?.['success'], true);
            assert.equal(applied.structuredContent?.['appliedCount'], 2);
            const appliedRows = /** @type {Record<string, unknown>[]} */ (applied.structuredContent?.['applied']);
            assert.equal(appliedRows[0]?.['groupedSameFile'], true);
            assert.equal(appliedRows[1]?.['groupedSameFile'], true);
            assert.equal(await readFile(absolutePath, 'utf8'), 'gamma\nomega\n');
        } finally {
            await rm(tempDir, { recursive: true, force: true });
        }
    });

    it('mcp_last_validation_summary reads persisted validator history without starting jobs', async () => {
        const tool = findTool('mcp_last_validation_summary');
        const result = await tool.handler({});
        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], true);
        assert.equal(typeof result.structuredContent?.['count'], 'number');
        assert.ok(Array.isArray(result.structuredContent?.['summaries']));
        assert.equal(typeof result.structuredContent?.['effectiveChecks'], 'object');
    });

    it('mcp_tunnel_status reports effective OAuth auth and connector smoke freshness', async () => {
        const tool = findTool('mcp_tunnel_status');
        const result = await tool.handler({});
        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.['success'], true);
        assert.equal(result.structuredContent?.['chatgpt']?.['authentication'], 'OAuth');
        assert.ok('temporaryFallback' in (result.structuredContent ?? {}));
        const permanentTunnel = /** @type {Record<string, unknown>} */ (result.structuredContent?.['permanentTunnel']);
        assert.equal(typeof permanentTunnel['lastSmokeFresh'], 'boolean');
        assert.equal(permanentTunnel['lastSmokeStaleAfterMinutes'], 60);
        assert.ok(
            ['fix-permanent-url', 'run-connector-smoke', 'refresh-connector-smoke', 'use-permanent-hostname'].includes(
                String(permanentTunnel['recommendedAction']),
            ),
        );
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
        assert.equal(validators['mcpFullSuite'], 'npm run copilot:mcp:safe-suite -- mcp-full');
    });
});
