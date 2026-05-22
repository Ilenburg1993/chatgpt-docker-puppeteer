// @ts-check
/**
 * Tests for ChatGPT connector profile helpers.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
    buildChatGptConnectorProfile,
    buildSecureTunnelRunbook,
    normalizeMcpUrl,
    validatePublicConnectorUrl,
} from '../../../../src/copilot/mcp/connection/profile.js';

describe('copilot MCP ChatGPT connection profile', () => {
    it('normalizes connector URLs to /mcp', () => {
        assert.equal(normalizeMcpUrl('https://example.com'), 'https://example.com/mcp');
        assert.equal(normalizeMcpUrl('https://example.com/mcp'), 'https://example.com/mcp');
    });

    it('validates ChatGPT public connector URL requirements', () => {
        assert.deepEqual(validatePublicConnectorUrl('https://example.com/mcp'), { ok: true });
        assert.equal(validatePublicConnectorUrl('http://127.0.0.1:3333/mcp').ok, false);
    });

    it('builds canonical ChatGPT form fields and smoke prompts', () => {
        const profile = buildChatGptConnectorProfile({ publicMcpUrl: 'https://example.com/tunnel' });
        assert.equal(profile.name, 'Repo DevContainer MCP');
        assert.equal(profile.connectorUrl, 'https://example.com/tunnel/mcp');
        assert.ok(profile.description.includes('Dev Container'));
        assert.ok(profile.smokePrompts.some((prompt) => prompt.includes('repo_status')));
    });

    it('builds secure tunnel commands for HTTP and stdio profiles', () => {
        const runbook = buildSecureTunnelRunbook({ tunnelId: 'tunnel_test', localMcpUrl: 'http://127.0.0.1:3333' });
        assert.ok(runbook.httpTunnelCommands.join('\n').includes('--mcp-server-url http://127.0.0.1:3333/mcp'));
        assert.ok(runbook.stdioTunnelCommands.join('\n').includes('--mcp-command'));
        assert.equal(runbook.chatgptUrl, 'https://<endpoint-do-tunel>/mcp');
    });
});

