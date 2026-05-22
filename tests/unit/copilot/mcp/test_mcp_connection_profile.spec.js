// @ts-check
/**
 * Tests for ChatGPT connector profile helpers.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
    buildChatGptConnectorProfile,
    buildCloudflareTunnelRunbook,
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
        assert.equal(profile.authMode, 'none-dev');
        assert.equal(profile.chatgptFormFields.mcpServerUrl, 'https://example.com/tunnel/mcp');
        assert.match(profile.chatgptFormFields.authentication, /Sem autenticacao/);
        assert.ok(profile.description.includes('Dev Container'));
        assert.ok(profile.smokePrompts.some((prompt) => prompt.includes('repo_status')));
        assert.ok(profile.smokePrompts.some((prompt) => prompt.includes('lastSmokeOk')));
    });

    it('builds secure tunnel commands for HTTP and stdio profiles', () => {
        const runbook = buildSecureTunnelRunbook({ tunnelId: 'tunnel_test', localMcpUrl: 'http://127.0.0.1:3333' });
        assert.ok(runbook.httpTunnelCommands.join('\n').includes('--mcp-server-url http://127.0.0.1:3333/mcp'));
        assert.ok(runbook.stdioTunnelCommands.join('\n').includes('--mcp-command'));
        assert.equal(runbook.chatgptUrl, 'https://<endpoint-do-tunel>/mcp');
    });

    it('builds Cloudflare tunnel commands around the MCP origin root', () => {
        const runbook = buildCloudflareTunnelRunbook({
            publicMcpUrl: 'https://repo-mcp.example.com',
            originUrl: 'http://127.0.0.1:3333',
        });
        assert.equal(runbook.originUrl, 'http://127.0.0.1:3333');
        assert.equal(runbook.chatgptUrl, 'https://repo-mcp.example.com/mcp');
        assert.ok(runbook.quickTunnelCommands.includes('npm run copilot:mcp:cloudflare:quick'));
        assert.ok(runbook.quickTunnelCommands.includes('npm run copilot:mcp:cloudflare:smoke'));
        assert.ok(runbook.notes.some((note) => note.includes('trycloudflare.com')));
        assert.ok(runbook.notes.some((note) => note.includes('lastSmokeOk')));
        assert.ok(runbook.notes.some((note) => note.includes('origin HTTP raiz')));
    });
});
