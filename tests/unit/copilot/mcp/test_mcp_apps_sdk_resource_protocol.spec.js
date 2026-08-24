// @ts-check
/**
 * Protocol-level proof for MCP Apps resource registration.
 */
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'vitest';

import { COMPANY_KNOWLEDGE_WIDGET_URI } from '#copilot/mcp/public/protocol/apps-sdk';
import { createCopilotMcpServer } from '#copilot/mcp/public/server';

/** @type {{ close: () => Promise<void> | void }[]} */
const closeables = [];

afterEach(async () => {
    while (closeables.length > 0) {
        const item = closeables.pop();
        if (item) await item.close();
    }
});

describe('MCP Apps resource protocol', () => {
    it('lists and reads the versioned widget with submission metadata over MCP resources protocol', async () => {
        const server = createCopilotMcpServer();
        const client = new Client({ name: 'workspace-app-resource-test', version: '1.0.0' });
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        closeables.push(client, server);

        await server.connect(serverTransport);
        await client.connect(clientTransport);

        const listed = await client.listResources();
        const descriptor = listed.resources.find((resource) => resource.uri === COMPANY_KNOWLEDGE_WIDGET_URI);
        assert.ok(descriptor);
        assert.equal(descriptor.mimeType, 'text/html;profile=mcp-app');
        const descriptorMeta = /** @type {Record<string, any>} */ (descriptor._meta ?? {});
        assert.equal(descriptorMeta['openai/widgetDomain'], descriptorMeta['ui']?.['domain']);
        assert.match(String(descriptorMeta['ui']?.['domain'] ?? ''), /^https:\/\//u);

        const read = await client.readResource({ uri: COMPANY_KNOWLEDGE_WIDGET_URI });
        assert.equal(read.contents.length, 1);
        const content = read.contents[0];
        assert.ok(content && 'text' in content);
        assert.equal(content?.uri, COMPANY_KNOWLEDGE_WIDGET_URI);
        assert.equal(content?.mimeType, 'text/html;profile=mcp-app');
        assert.equal(typeof content.text, 'string');
        assert.match(String(content.text ?? ''), /ui\/notifications\/tool-result/u);
        const contentMeta = /** @type {Record<string, any>} */ (content?._meta ?? {});
        assert.equal(contentMeta['openai/widgetDomain'], contentMeta['ui']?.['domain']);
        assert.match(String(contentMeta['ui']?.['domain'] ?? ''), /^https:\/\//u);
    });
});
