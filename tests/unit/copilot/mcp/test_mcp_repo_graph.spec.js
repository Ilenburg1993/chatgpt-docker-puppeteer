// @ts-check

import { configureApplicationInfraSqliteProvider, getApplicationInfraRuntime } from '#copilot/boot';
import { adaptBetterSqliteDatabase, createBetterSqliteProvider } from '#copilot/infra/public/testing/database/sqlite';
import { ensureIoIndexSchema } from '#copilot/infra/public/testing/indexing/sqlite';
import { createComposedMcpProcessHost } from '#copilot/mcp/public/composition/process-host';
import { createMcpToolOperationContext } from '#copilot/mcp/public/protocol/tools';
import { getCanonicalMcpTools } from '#copilot/mcp/public/registry';
import Database from 'better-sqlite3';
import assert from 'node:assert/strict';
import { afterAll, beforeAll, describe, it } from 'vitest';

const PROCESS_HOST = createComposedMcpProcessHost({
    hostId: 'mcp-repo-graph-test',
    backgroundServices: false,
});
/** @type {import('better-sqlite3').Database | null} */
let testInfraDb = null;
/** @type {Awaited<ReturnType<typeof PROCESS_HOST.acquire>> | null} */
let processHostLease = null;

const OPERATION_CONTEXT = createMcpToolOperationContext(
    {
        mcpReq: {
            id: 'mcp-repo-graph-test',
            method: 'tools/call',
            signal: new AbortController().signal,
            _meta: { caller: 'test_mcp_repo_graph' },
            envelope: { protocol: '2026' },
        },
    },
    { workspace: PROCESS_HOST.workspace, config: PROCESS_HOST.processConfig.toolConfig },
);

beforeAll(async () => {
    testInfraDb = new Database(':memory:');
    ensureIoIndexSchema(adaptBetterSqliteDatabase(testInfraDb));
    configureApplicationInfraSqliteProvider(createBetterSqliteProvider(() => /** @type {import('better-sqlite3').Database} */ (testInfraDb)));
    processHostLease = await PROCESS_HOST.acquire({ reason: 'mcp-repo-graph-test' });
});

afterAll(async () => {
    await processHostLease?.release();
    processHostLease = null;
    await PROCESS_HOST.dispose();
    getApplicationInfraRuntime().database.reset();
    if (testInfraDb?.open) testInfraDb.close();
    testInfraDb = null;
});

function tool(name) {
    const definition = getCanonicalMcpTools().find((candidate) => candidate.name === name);
    assert.ok(definition, `missing tool ${name}`);
    return (input) => definition.handler(input, OPERATION_CONTEXT);
}

describe('MCP indexed repository graph', () => {
    it('projects graph summary, dependency traversal and reverse change impact without source reparsing', async () => {
        const scope = 'src/copilot/mcp/indexing/repository';
        const build = await tool('repo_index_build')({ path: scope, recursive: true, maxFiles: 100 });
        assert.equal(build.isError, undefined);
        assert.equal(build.structuredContent?.['success'], true);

        const summary = await tool('repo_graph')({ view: 'summary', path: scope });
        assert.equal(summary.isError, undefined);
        assert.equal(summary.structuredContent?.['success'], true);
        assert.equal(summary.structuredContent?.['engine'], 'indexed-module-graph-v1');
        const summaryBody = /** @type {Record<string, unknown>} */ (summary.structuredContent?.['summary']);
        assert.ok(Number(summaryBody['nodeCount'] ?? 0) >= 3);
        assert.ok(Number(summaryBody['edgeCount'] ?? 0) >= 2);

        const dependencies = await tool('repo_graph')({
            view: 'dependencies',
            path: scope,
            node: `${scope}/graph.js`,
            maxDepth: 1,
            maxResults: 20,
        });
        assert.equal(dependencies.isError, undefined);
        const dependencyRows = /** @type {Record<string, unknown>[]} */ (dependencies.structuredContent?.['nodes']);
        assert.ok(dependencyRows.some((row) => row['path'] === `${scope}/runtime.js`));
        assert.equal(dependencies.structuredContent?.['truncated'], false);

        const impact = await tool('repo_change_impact')({
            path: scope,
            paths: [`${scope}/runtime.js`],
            maxDepth: 2,
            maxResults: 20,
        });
        assert.equal(impact.isError, undefined);
        const impactRows = /** @type {Record<string, unknown>[]} */ (impact.structuredContent?.['impacted']);
        assert.ok(impactRows.some((row) => row['path'] === `${scope}/graph.js`));
        assert.ok(impactRows.some((row) => row['path'] === `${scope}/orphan-imports.js`));
    });

    it('derives change-impact seeds from one governed Git range and rejects ambiguous seed modes', async () => {
        const scope = 'src/copilot/mcp';
        const build = await tool('repo_index_build')({ path: scope, recursive: true, maxFiles: 2500 });
        assert.equal(build.isError, undefined);
        assert.equal(build.structuredContent?.['success'], true);

        const rangeImpact = await tool('repo_change_impact')({
            path: scope,
            gitBase: 'HEAD~1',
            gitHead: 'HEAD',
            maxDepth: 2,
            maxResults: 20,
        });
        assert.equal(rangeImpact.isError, undefined);
        assert.equal(rangeImpact.structuredContent?.['success'], true);
        const seedSource = /** @type {Record<string, unknown>} */ (rangeImpact.structuredContent?.['seedSource']);
        assert.equal(seedSource['mode'], 'git-range');
        assert.equal(seedSource['gitBase'], 'HEAD~1');
        assert.equal(seedSource['gitHead'], 'HEAD');
        assert.ok(Number(rangeImpact.structuredContent?.['requestedSeedCount'] ?? 0) > 0);

        const ambiguous = await tool('repo_change_impact')({
            path: scope,
            paths: [`${scope}/tools/meta.js`],
            gitBase: 'HEAD~1',
            gitHead: 'HEAD',
        });
        assert.equal(ambiguous.isError, true);
        assert.equal(ambiguous.structuredContent?.['code'], 'ERR_CHANGE_IMPACT_SEED_MODE');
    });

    it('returns explicit graph precondition errors instead of false-green empty answers', async () => {
        const result = await tool('repo_graph')({
            view: 'dependencies',
            path: 'src/copilot/mcp/indexing/repository',
        });
        assert.equal(result.isError, true);
        assert.equal(result.structuredContent?.['code'], 'ERR_GRAPH_NODE_REQUIRED');
    });
});
