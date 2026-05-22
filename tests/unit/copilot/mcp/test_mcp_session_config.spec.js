// @ts-check
/**
 * Tests for optional Copilot SDK MCP configuration.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { buildMcpConfig, listAvailableMcpServers } from '../../../../src/copilot/config/mcp-servers.js';

describe('copilot MCP session config', () => {
    it('registers the local Copilot MCP server as opt-in', () => {
        assert.ok(listAvailableMcpServers().includes('copilot-local'));

        const config = buildMcpConfig(['copilot-local']);
        assert.deepEqual(config, {
            'copilot-local': {
                type: 'stdio',
                command: 'node',
                args: ['src/copilot/mcp/index.js', '--transport', 'stdio'],
                timeout: 30_000,
            },
        });
    });

    it('keeps MCP disabled when no server is explicitly enabled', () => {
        assert.equal(buildMcpConfig([]), undefined);
    });
});
