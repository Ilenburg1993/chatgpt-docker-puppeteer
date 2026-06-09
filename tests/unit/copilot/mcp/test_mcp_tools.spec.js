// @ts-check
/**
 * Tests for first-band Copilot MCP tools.
 */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { describe, it } from 'vitest';

import { invalidateIoCachePath } from '#copilot/infra/io-cache.js';
import { resolveReadPath } from '#copilot/mcp/control-plane';
import { getCanonicalMcpTools } from '#copilot/mcp';

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

    it('repo_read_file returns identical results for repeated same-window reads', async () => {
        const tool = findTool('repo_read_file');
        const args = {
            path: 'src/copilot/mcp/README.md',
            startLine: 1,
            endLine: 8,
        };
        const first = await tool.handler(args);
        const second = await tool.handler(args);

        assert.deepEqual(second.structuredContent, first.structuredContent);
        assert.deepEqual(second.content, first.content);
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
        assert.equal(/** @type {string[]} */ (structured['rememberApprovalCandidates']).includes('job_cancel'), false);
        assert.ok(/** @type {string[]} */ (structured['destructiveTools']).includes('repo_remove_file'));
        const approvalFrictionProfile = /** @type {Record<string, unknown>} */ (structured['approvalFrictionProfile']);
        assert.equal(
            /** @type {string[]} */ (approvalFrictionProfile['rememberApprovalCandidates']).includes('job_cancel'),
            false,
        );
        assert.ok(/** @type {string[]} */ (approvalFrictionProfile['neverRememberApproval']).includes('job_cancel'));
        const tools = /**
         * @type {{
         *     name?: string;
         *     annotations?: { idempotentHint?: boolean };
         *     hasOutputSchema?: boolean;
         *     securitySchemes?: { type?: string }[];
         * }[]}
         */ (structured['tools']);
        assert.equal(tools.find((candidate) => candidate.name === 'repo_status')?.annotations?.idempotentHint, true);
        assert.equal(tools.find((candidate) => candidate.name === 'repo_status')?.hasOutputSchema, true);
        assert.ok(
            tools
                .find((candidate) => candidate.name === 'repo_status')
                ?.securitySchemes?.some((scheme) => scheme.type === 'oauth2'),
        );
        const hostApprovalProfile = /** @type {Record<string, unknown>} */ (structured['hostApprovalProfile']);
        assert.equal(hostApprovalProfile['oauthGrantsAllRepoScopesByDefault'], true);
    });

    it('mcp_session_profile returns the recommended ChatGPT autonomy profile', async () => {
        const tool = findTool('mcp_session_profile');
        const result = await tool.handler({});
        assert.equal(result.isError, undefined);
        const structured = /** @type {Record<string, unknown>} */ (result.structuredContent);
        assert.equal(structured['success'], true);
        assert.equal(structured['profile'], 'chatgpt-max-autonomy-permanent-cloudflare-oauth');
        assert.ok(/** @type {string[]} */ (structured['recommendedFirstCalls']).includes('mcp_tools_status'));
        const approvalGuidance = /** @type {Record<string, unknown>} */ (structured['approvalGuidance']);
        assert.ok(
            /** @type {string[]} */ (approvalGuidance['avoidUnlessExplicitlyNeeded']).includes('repo_remove_file'),
        );
        const tunnelGuidance = /** @type {Record<string, unknown>} */ (structured['tunnelGuidance']);
        assert.equal(tunnelGuidance['mode'], 'Cloudflare named permanent tunnel');
        assert.equal(tunnelGuidance['expectedUrlShape'], 'https://mcp.aurelin.org/mcp');
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

        const applyTool = findTool('mcp_maintenance_apply_safe_fixes');
        const dryRun = await applyTool.handler({
            fixes: ['workspace-status', 'summarize-tools', 'run-mcp-smoke', 'refresh-index'],
            dryRun: true,
        });
        assert.equal(dryRun.isError, undefined);
        assert.equal(dryRun.structuredContent?.['success'], true);
        assert.equal(dryRun.structuredContent?.['dryRun'], true);
        const results = /** @type {{ fix?: string; dryRun?: boolean; plannedPath?: string }[]} */ (
            dryRun.structuredContent?.['results']
        );
        assert.ok(results.some((result) => result.fix === 'refresh-index' && result.plannedPath === 'src/copilot'));
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
        assert.equal(appsSdk['cspApplicable'], false);
        assert.equal(appsSdk['hasWidgetResource'], false);
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

        const createPlanTool = findTool('repo_create_file_plan');
        const createPlan = await createPlanTool.handler({
            path: 'src/copilot/.ai/jobs/plan-only-created.txt',
            content: 'planned\n',
        });
        assert.equal(createPlan.isError, undefined);
        assert.equal(createPlan.structuredContent?.['plannedTool'], 'repo_create_file');

        const validationPlanTool = findTool('mcp_validation_plan');
        const validationPlan = await validationPlanTool.handler({ suite: 'mcp-fast' });
        assert.equal(validationPlan.isError, undefined);
        assert.equal(validationPlan.structuredContent?.['validator'], 'suite-mcp-fast');
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
