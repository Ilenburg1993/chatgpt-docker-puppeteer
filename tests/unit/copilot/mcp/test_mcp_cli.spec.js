// @ts-check
/**
 * Tests for the MCP CLI transport parser.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { parseTransport } from '#copilot/mcp/cli';

describe('copilot MCP CLI', () => {
    it('defaults to HTTP/2+ transport for remote HTTP mode', () => {
        assert.equal(parseTransport([]), 'http2');
    });

    it('keeps explicit transport overrides', () => {
        assert.equal(parseTransport(['--stdio']), 'stdio');
        assert.equal(parseTransport(['--http']), 'http');
        assert.equal(parseTransport(['--http2']), 'http2');
        assert.equal(parseTransport(['--transport', 'h2']), 'http2');
        assert.equal(parseTransport(['--transport=http']), 'http');
    });
});
