// @ts-check
/**
 * Tests for MCP HTTP stream registry and stateful GET/DELETE routing cleanup.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { handleStatefulMcpHttpRequest, readMcpHttpSessionRuntimeState } from '#copilot/mcp/adapters';
import { createMcpHttpSessionRuntime, createMcpHttpStreamRegistry } from '#copilot/mcp/control-plane';
import {
    createMcpTransportErrorCollector,
    fakeMcpTransport,
    fakeMcpRequest as fakeReq,
    fakeMcpResponse as fakeRes,
    readFakeMcpHeader as readHeader,
} from './helpers/http-fakes.js';

describe('MCP HTTP stream registry', () => {
    it('exposes stream registry metrics in the HTTP runtime snapshot', () => {
        const snapshot = readMcpHttpSessionRuntimeState();
        assert.equal(typeof snapshot['streamRegistry'], 'object');
    });

    it('tracks streams with redacted session metadata only', () => {
        const registry = createMcpHttpStreamRegistry({ now: () => 1_000 });
        const stream = registry.open({ sessionId: 'session-stream-secret', kind: 'standalone-get-sse' });

        assert.equal(stream.kind, 'standalone-get-sse');
        assert.equal(Object.hasOwn(stream, 'sessionId'), false);
        assert.equal(JSON.stringify(registry.snapshot()).includes('session-stream-secret'), false);
        assert.equal(registry.snapshot()['activeStreams'], 1);
        assert.equal(registry.touch(stream.streamKey), true);
        assert.equal(registry.close(stream.streamKey, 'unit-test'), true);
        assert.equal(registry.snapshot()['activeStreams'], 0);
    });

    it('rejects GET requests that do not accept text/event-stream', async () => {
        const runtime = createMcpHttpSessionRuntime({ ttlMs: 10_000, maxSessions: 4, store: null });
        const { errors, writeTransportError } = createMcpTransportErrorCollector();
        let handled = 0;
        runtime.register({
            sessionId: 'session-get-no-accept',
            server: {},
            transport: fakeMcpTransport({
                handleRequest() {
                    handled += 1;
                },
            }),
        });

        await handleStatefulMcpHttpRequest({
            req: fakeReq('GET', { 'mcp-session-id': 'session-get-no-accept' }),
            res: fakeRes(),
            url: new URL('https://mcp.aurelin.org/mcp'),
            parsedMcpBody: undefined,
            authContext: { bearerToken: null, headers: {}, method: 'GET', url: 'https://mcp.aurelin.org/mcp' },
            protocolVersion: '2025-11-25',
            runtime,
            useSqliteStore: false,
            readHeader,
            writeTransportError,
        });

        assert.equal(handled, 0);
        assert.equal(errors.at(-1)?.statusCode, 406);
    });

    it('opens and closes stream registry entries around GET handling', async () => {
        const runtime = createMcpHttpSessionRuntime({ ttlMs: 10_000, maxSessions: 4, store: null });
        const registry = createMcpHttpStreamRegistry({ now: () => 1_000 });
        let handled = 0;
        runtime.register({
            sessionId: 'session-get',
            server: {},
            transport: fakeMcpTransport({
                handleRequest() {
                    handled += 1;
                    assert.equal(registry.snapshot()['activeStreams'], 1);
                },
            }),
        });

        await handleStatefulMcpHttpRequest({
            req: fakeReq('GET', { 'mcp-session-id': 'session-get', accept: 'text/event-stream' }),
            res: fakeRes(),
            url: new URL('https://mcp.aurelin.org/mcp'),
            parsedMcpBody: undefined,
            authContext: { bearerToken: null, headers: {}, method: 'GET', url: 'https://mcp.aurelin.org/mcp' },
            protocolVersion: '2025-11-25',
            runtime,
            streamRegistry: registry,
            useSqliteStore: false,
            readHeader,
            writeTransportError: createMcpTransportErrorCollector().writeTransportError,
        });

        assert.equal(handled, 1);
        assert.equal(registry.snapshot()['activeStreams'], 0);
        assert.equal(/** @type {{ closed?: number }} */ (registry.snapshot()['counters']).closed, 1);
    });

    it('terminates the session after DELETE is delegated to the transport', async () => {
        const runtime = createMcpHttpSessionRuntime({ ttlMs: 10_000, maxSessions: 4, store: null });
        const registry = createMcpHttpStreamRegistry({ now: () => 1_000 });
        registry.open({ sessionId: 'session-delete', kind: 'standalone-get-sse' });
        const res = fakeRes();
        let handled = 0;
        let closed = 0;
        runtime.register({
            sessionId: 'session-delete',
            server: {},
            transport: fakeMcpTransport({
                handleRequest() {
                    handled += 1;
                },
                close() {
                    closed += 1;
                },
            }),
        });

        await handleStatefulMcpHttpRequest({
            req: fakeReq('DELETE', { 'mcp-session-id': 'session-delete' }),
            res,
            url: new URL('https://mcp.aurelin.org/mcp'),
            parsedMcpBody: undefined,
            authContext: { bearerToken: null, headers: {}, method: 'DELETE', url: 'https://mcp.aurelin.org/mcp' },
            protocolVersion: '2025-11-25',
            runtime,
            streamRegistry: registry,
            useSqliteStore: false,
            readHeader,
            writeTransportError: createMcpTransportErrorCollector().writeTransportError,
        });

        assert.equal(handled, 1);
        assert.equal(closed, 1);
        assert.equal(runtime.get('session-delete'), null);
        assert.equal(res.statusCode, 204);
        assert.equal(res.writableEnded, true);
        assert.equal(registry.snapshot()['activeStreams'], 0);
        assert.equal(/** @type {{ closedBySession?: number }} */ (registry.snapshot()['counters']).closedBySession, 1);

        const { errors, writeTransportError } = createMcpTransportErrorCollector();
        await handleStatefulMcpHttpRequest({
            req: fakeReq('DELETE', { 'mcp-session-id': 'session-delete' }),
            res: fakeRes(),
            url: new URL('https://mcp.aurelin.org/mcp'),
            parsedMcpBody: undefined,
            authContext: { bearerToken: null, headers: {}, method: 'DELETE', url: 'https://mcp.aurelin.org/mcp' },
            protocolVersion: '2025-11-25',
            runtime,
            streamRegistry: registry,
            useSqliteStore: false,
            readHeader,
            writeTransportError,
        });
        assert.equal(errors.at(-1)?.statusCode, 404);
    });
});
