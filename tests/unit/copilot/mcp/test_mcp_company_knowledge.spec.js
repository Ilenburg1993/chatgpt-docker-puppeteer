// @ts-check
/**
 * Tests for Company Knowledge MCP tools and Apps SDK resource metadata.
 */

import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'vitest';

import {
    COMPANY_KNOWLEDGE_FETCH_TOOL_NAME,
    COMPANY_KNOWLEDGE_SEARCH_TOOL_NAME,
    COMPANY_KNOWLEDGE_WIDGET_URI,
    buildCompanyKnowledgeWidgetResource,
    companyKnowledgeTestHarness,
    companyKnowledgeTools,
} from '#copilot/mcp/tools';

describe('MCP Company Knowledge tools', () => {
    beforeEach(() => {
        companyKnowledgeTestHarness.resetCompanyKnowledgeCorpusCacheForTests();
    });

    it('exposes exact read-only search/fetch tools required by Company Knowledge', () => {
        const search = companyKnowledgeTools.find((tool) => tool.name === COMPANY_KNOWLEDGE_SEARCH_TOOL_NAME);
        const fetch = companyKnowledgeTools.find((tool) => tool.name === COMPANY_KNOWLEDGE_FETCH_TOOL_NAME);

        assert.ok(search);
        assert.ok(fetch);
        assert.equal(search.annotations.readOnlyHint, true);
        assert.equal(fetch.annotations.readOnlyHint, true);
        assert.equal(search.annotations.openWorldHint, false);
        assert.equal(fetch.annotations.openWorldHint, false);
        assert.equal(search._meta?.['ui']?.['resourceUri'], COMPANY_KNOWLEDGE_WIDGET_URI);
        assert.equal(fetch._meta?.['ui']?.['resourceUri'], COMPANY_KNOWLEDGE_WIDGET_URI);
        assert.equal(search._meta?.['openai/outputTemplate'], COMPANY_KNOWLEDGE_WIDGET_URI);
        assert.equal(fetch._meta?.['openai/outputTemplate'], COMPANY_KNOWLEDGE_WIDGET_URI);
    });

    it('returns structuredContent and JSON content text from search and fetch', async () => {
        const search = companyKnowledgeTools.find((tool) => tool.name === COMPANY_KNOWLEDGE_SEARCH_TOOL_NAME);
        assert.ok(search);

        const searchResult = await search.handler({ query: 'MCP OAuth workspace' });
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
        const fetchResult = await fetch.handler({ id: results[0]?.id });
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

        const result = await fetch.handler({ id: 'repo:not-a-real-document' });

        assert.equal(result.isError, true);
        assert.equal(result.structuredContent['code'], 'COMPANY_KNOWLEDGE_DOCUMENT_NOT_FOUND');
    });

    it('uses deterministic repo document ids without leaking absolute paths', () => {
        const id = companyKnowledgeTestHarness.encodeCompanyKnowledgeDocumentId('src/copilot/mcp/README.md');

        assert.equal(id.startsWith('repo:'), true);
        assert.equal(id.includes('/workspaces/'), false);
        assert.equal(companyKnowledgeTestHarness.decodeCompanyKnowledgeDocumentId(id), 'src/copilot/mcp/README.md');
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
        assert.equal(meta['openai/widgetDescription'], 'Renders read-only Company Knowledge search and fetch results from the current workspace corpus.');
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
