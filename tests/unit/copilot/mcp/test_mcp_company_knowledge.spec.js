// @ts-check
/**
 * Tests for Company Knowledge MCP tools and Apps SDK resource metadata.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'vitest';

import { readCompanyKnowledgeProcessConfig } from '#copilot/mcp/public/company-knowledge';
import { createComposedMcpProcessHost } from '#copilot/mcp/public/composition/process-host';
import {
    buildCompanyKnowledgeWidgetResource,
    COMPANY_KNOWLEDGE_WIDGET_URI,
} from '#copilot/mcp/public/protocol/apps-sdk';
import { createMcpToolOperationContext } from '#copilot/mcp/public/protocol/tools';
import { getCanonicalMcpTools } from '#copilot/mcp/public/registry';
import {
    decodeCompanyKnowledgeDocumentId,
    encodeCompanyKnowledgeDocumentId,
    resetCompanyKnowledgeCorpusCacheForTests,
} from '#copilot/testing/mcp/company-knowledge';
import {
    COMPANY_KNOWLEDGE_FETCH_TOOL_NAME,
    COMPANY_KNOWLEDGE_SEARCH_TOOL_NAME,
    companyKnowledgeTools,
} from '#copilot/testing/mcp/tools/company-knowledge';

const COMPANY_KNOWLEDGE_HOST = createComposedMcpProcessHost({
    hostId: 'company-knowledge-test-host',
    backgroundServices: false,
});
const COMPANY_KNOWLEDGE_WORKSPACE = COMPANY_KNOWLEDGE_HOST.workspace;

/** @param {import('#copilot/mcp/public/company-knowledge').CompanyKnowledgeProcessConfig} [companyKnowledgeConfig] */
function createCompanyKnowledgeOperationContext(
    companyKnowledgeConfig = COMPANY_KNOWLEDGE_HOST.processConfig.companyKnowledge,
) {
    return createMcpToolOperationContext(
        {
            mcpReq: {
                id: 'company-knowledge-test',
                method: 'tools/call',
                signal: new AbortController().signal,
                _meta: { caller: 'unit-test' },
            },
        },
        {
            workspace: COMPANY_KNOWLEDGE_WORKSPACE,
            config: { companyKnowledge: companyKnowledgeConfig },
        },
    );
}

describe('MCP Company Knowledge tools', () => {
    beforeEach(() => {
        resetCompanyKnowledgeCorpusCacheForTests();
    });

    it('exposes exact read-only search/fetch tools required by Company Knowledge', () => {
        const search = companyKnowledgeTools.find((tool) => tool.name === COMPANY_KNOWLEDGE_SEARCH_TOOL_NAME);
        const fetch = companyKnowledgeTools.find((tool) => tool.name === COMPANY_KNOWLEDGE_FETCH_TOOL_NAME);

        assert.ok(search);
        assert.ok(fetch);
        assert.equal('annotations' in search, false);
        assert.equal('annotations' in fetch, false);
        const canonicalSearch = getCanonicalMcpTools().find((tool) => tool.name === COMPANY_KNOWLEDGE_SEARCH_TOOL_NAME);
        const canonicalFetch = getCanonicalMcpTools().find((tool) => tool.name === COMPANY_KNOWLEDGE_FETCH_TOOL_NAME);
        assert.ok(canonicalSearch);
        assert.ok(canonicalFetch);
        assert.equal(canonicalSearch.annotations.readOnlyHint, true);
        assert.equal(canonicalFetch.annotations.readOnlyHint, true);
        assert.equal(canonicalSearch.annotations.openWorldHint, false);
        assert.equal(canonicalFetch.annotations.openWorldHint, false);
        assert.equal(canonicalSearch.contract.effects.mutation, 'none');
        assert.equal(canonicalFetch.contract.effects.mutation, 'none');
        assert.equal(canonicalSearch.contract.authority.network, 'local');
        assert.equal(canonicalFetch.contract.authority.network, 'local');
        const searchUi = /** @type {Record<string, unknown>} */ (search._meta?.['ui'] ?? {});
        const fetchUi = /** @type {Record<string, unknown>} */ (fetch._meta?.['ui'] ?? {});
        assert.equal(searchUi['resourceUri'], COMPANY_KNOWLEDGE_WIDGET_URI);
        assert.equal(fetchUi['resourceUri'], COMPANY_KNOWLEDGE_WIDGET_URI);
        assert.equal(search._meta?.['openai/outputTemplate'], COMPANY_KNOWLEDGE_WIDGET_URI);
        assert.equal(fetch._meta?.['openai/outputTemplate'], COMPANY_KNOWLEDGE_WIDGET_URI);
    });

    it('returns structuredContent and JSON content text from search and fetch', async () => {
        const search = companyKnowledgeTools.find((tool) => tool.name === COMPANY_KNOWLEDGE_SEARCH_TOOL_NAME);
        assert.ok(search);

        const searchResult = await search.handler(
            { query: 'MCP OAuth workspace' },
            createCompanyKnowledgeOperationContext(),
        );
        const parsedSearchText = JSON.parse(searchResult.content[0]?.text ?? '{}');
        const results = /** @type {{ id: string; title: string; url: string }[]} */ (
            searchResult.structuredContent['results']
        );

        assert.deepEqual(parsedSearchText, searchResult.structuredContent);
        assert.ok(Array.isArray(results));
        assert.ok(results.length > 0);
        assert.ok(results[0]?.id.startsWith('repo:'));
        assert.ok(results[0]?.title);
        assert.ok(results[0]?.url.startsWith('https://github.com/'));

        const fetch = companyKnowledgeTools.find((tool) => tool.name === COMPANY_KNOWLEDGE_FETCH_TOOL_NAME);
        assert.ok(fetch);
        const fetchResult = await fetch.handler({ id: results[0]?.id }, createCompanyKnowledgeOperationContext());
        const parsedFetchText = JSON.parse(fetchResult.content[0]?.text ?? '{}');

        assert.deepEqual(parsedFetchText, fetchResult.structuredContent);
        assert.equal(fetchResult.structuredContent['id'], results[0]?.id);
        assert.equal(typeof fetchResult.structuredContent['title'], 'string');
        assert.equal(typeof fetchResult.structuredContent['text'], 'string');
        assert.equal(typeof fetchResult.structuredContent['url'], 'string');
        assert.ok(String(fetchResult.structuredContent['text']).length > 0);
    });

    it('rejects arbitrary fetch ids not issued by the search corpus', async () => {
        const fetch = companyKnowledgeTools.find((tool) => tool.name === COMPANY_KNOWLEDGE_FETCH_TOOL_NAME);
        assert.ok(fetch);

        const result = await fetch.handler(
            { id: 'repo:not-a-real-document' },
            createCompanyKnowledgeOperationContext(),
        );

        assert.equal(result.isError, true);
        assert.equal(result.structuredContent['code'], 'COMPANY_KNOWLEDGE_DOCUMENT_NOT_FOUND');
    });

    it('keeps Company Knowledge process generations immutable and independent from source env mutation', () => {
        const env = {
            COPILOT_MCP_COMPANY_KNOWLEDGE_ROOTS: 'README.md,src/copilot/mcp/README.md',
            COPILOT_MCP_COMPANY_KNOWLEDGE_REPOSITORY_WEB_BASE: 'https://example.test/repo',
            COPILOT_MCP_COMPANY_KNOWLEDGE_CACHE_TTL_MS: '12345',
            COPILOT_MCP_COMPANY_KNOWLEDGE_MAX_DOCUMENTS: '7',
            COPILOT_MCP_WIDGET_DOMAIN: 'https://widget.example.test',
        };
        const config = readCompanyKnowledgeProcessConfig(env);
        env.COPILOT_MCP_COMPANY_KNOWLEDGE_ROOTS = 'CHANGELOG.md';
        env.COPILOT_MCP_COMPANY_KNOWLEDGE_REPOSITORY_WEB_BASE = 'https://mutated.example.test';

        assert.deepEqual(config.corpusRoots, ['README.md', 'src/copilot/mcp/README.md']);
        assert.equal(config.repositoryWebBase, 'https://example.test/repo');
        assert.equal(config.cacheTtlMs, 12_345);
        assert.equal(config.maxDocuments, 7);
        assert.equal(config.widgetDomain, 'https://widget.example.test');
        assert.equal(Object.isFrozen(config), true);
        assert.equal(Object.isFrozen(config.corpusRoots), true);
    });

    it('isolates corpus cache entries by immutable configuration generation', async () => {
        const search = companyKnowledgeTools.find((tool) => tool.name === COMPANY_KNOWLEDGE_SEARCH_TOOL_NAME);
        assert.ok(search);
        const baseEnv = {
            COPILOT_MCP_COMPANY_KNOWLEDGE_ROOTS: 'README.md',
            COPILOT_MCP_COMPANY_KNOWLEDGE_CACHE_TTL_MS: '600000',
        };
        const firstConfig = readCompanyKnowledgeProcessConfig({
            ...baseEnv,
            COPILOT_MCP_COMPANY_KNOWLEDGE_REPOSITORY_WEB_BASE: 'https://first.example.test/repo',
        });
        const secondConfig = readCompanyKnowledgeProcessConfig({
            ...baseEnv,
            COPILOT_MCP_COMPANY_KNOWLEDGE_REPOSITORY_WEB_BASE: 'https://second.example.test/repo',
        });

        const first = await search.handler({ query: 'MCP' }, createCompanyKnowledgeOperationContext(firstConfig));
        const second = await search.handler({ query: 'MCP' }, createCompanyKnowledgeOperationContext(secondConfig));
        const firstResults = /** @type {{ url: string }[]} */ (first.structuredContent['results']);
        const secondResults = /** @type {{ url: string }[]} */ (second.structuredContent['results']);
        assert.ok(firstResults.length > 0);
        assert.ok(secondResults.length > 0);
        assert.ok(firstResults.every((entry) => entry.url.startsWith('https://first.example.test/repo/')));
        assert.ok(secondResults.every((entry) => entry.url.startsWith('https://second.example.test/repo/')));
    });

    it('uses deterministic repo document ids without leaking absolute paths', () => {
        const id = encodeCompanyKnowledgeDocumentId('src/copilot/mcp/README.md');

        assert.equal(id.startsWith('repo:'), true);
        assert.equal(id.includes('/workspaces/'), false);
        assert.equal(decodeCompanyKnowledgeDocumentId(id), 'src/copilot/mcp/README.md');
    });

    it('registers a versioned MCP Apps widget with dedicated domain, standard CSP and bridge rendering', () => {
        const resource = buildCompanyKnowledgeWidgetResource({
            COPILOT_MCP_WIDGET_DOMAIN: 'https://workspace-widget.example.com',
        });
        const meta = /** @type {Record<string, any>} */ (resource._meta);
        const ui = /** @type {Record<string, any>} */ (meta['ui']);
        const csp = /** @type {Record<string, unknown[]>} */ (ui['csp']);
        const legacyCsp = /** @type {Record<string, unknown[]>} */ (meta['openai/widgetCSP']);

        assert.equal(resource.uri, COMPANY_KNOWLEDGE_WIDGET_URI);
        assert.equal(COMPANY_KNOWLEDGE_WIDGET_URI, 'ui://copilot/company-knowledge/v2.html');
        assert.equal(resource.mimeType, 'text/html;profile=mcp-app');
        assert.equal(
            meta['openai/widgetDescription'],
            'Renders read-only Company Knowledge search and fetch results from the current workspace corpus.',
        );
        assert.equal(ui['domain'], 'https://workspace-widget.example.com');
        assert.equal(meta['openai/widgetDomain'], ui['domain']);
        assert.deepEqual(csp['connectDomains'], []);
        assert.deepEqual(csp['resourceDomains'], []);
        assert.deepEqual(csp['frameDomains'], []);
        assert.equal(csp['redirectDomains'], undefined);
        assert.deepEqual(legacyCsp['redirect_domains'], ['https://github.com']);
        assert.match(resource.text, /ui\/notifications\/tool-result/u);
        assert.match(resource.text, /\.textContent\s*=/u);
        assert.doesNotMatch(resource.text, /\.innerHTML\s*=/u);
    });

    it('rejects an explicit widget domain that is not a dedicated HTTPS origin', () => {
        assert.throws(
            () => buildCompanyKnowledgeWidgetResource({ COPILOT_MCP_WIDGET_DOMAIN: 'http://example.com' }),
            /Invalid COPILOT_MCP_WIDGET_DOMAIN/u,
        );
        assert.throws(
            () => buildCompanyKnowledgeWidgetResource({ COPILOT_MCP_WIDGET_DOMAIN: 'https://example.com/widget' }),
            /Invalid COPILOT_MCP_WIDGET_DOMAIN/u,
        );
    });
});
