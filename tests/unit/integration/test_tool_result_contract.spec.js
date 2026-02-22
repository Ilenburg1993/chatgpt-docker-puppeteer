import assert from 'node:assert';
import { describe, it } from 'node:test';
import express from 'express';
import { ToolRegistry, normalizeToolResultPayload } from '../../../src/integration/tool-registry.mjs';
import { setupMCPHandler } from '../../../src/server/handlers/mcp-handler.js';

describe('Tool Result Contract', () => {
    it('normalizes plain string payloads', () => {
        const normalized = normalizeToolResultPayload('hello');
        assert.strictEqual(normalized.text, 'hello');
        assert.strictEqual(normalized.flags.degraded, false);
    });

    it('preserves structured payload fields', () => {
        const normalized = normalizeToolResultPayload({
            text: 'ok',
            json: { a: 1 },
            flags: { degraded: true, mutating: false, partial: true },
        });
        assert.strictEqual(normalized.text, 'ok');
        assert.deepStrictEqual(normalized.json, { a: 1 });
        assert.strictEqual(normalized.flags.degraded, true);
        assert.strictEqual(normalized.flags.partial, true);
    });

    it('exposes structuredContent via MCP tools/call', async () => {
        const registry = new ToolRegistry();
        registry.register(
            'test_structured',
            {
                description: 'test tool',
                inputSchema: { type: 'object', properties: {} },
            },
            async () => ({
                text: 'structured-ok',
                json: { healthy: true },
                flags: { degraded: false, mutating: false, partial: false },
            })
        );

        const app = express();
        app.use(express.json());
        setupMCPHandler(app, registry);

        const server = await new Promise(resolve => {
            const s = app.listen(0, () => resolve(s));
        });

        try {
            const port = server.address().port;
            const response = await fetch(`http://localhost:${port}/api/mcp`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'tools/call',
                    params: { name: 'test_structured', arguments: {} },
                }),
            });
            const payload = await response.json();
            assert.strictEqual(payload.result.content[0].text, 'structured-ok');
            assert.deepStrictEqual(payload.result.structuredContent.data, { healthy: true });
            assert.strictEqual(payload.result.structuredContent.flags.degraded, false);
        } finally {
            server.close();
        }
    });
});
