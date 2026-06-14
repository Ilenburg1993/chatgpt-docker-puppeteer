// @ts-check
/**
 * Tests for Faixa 3/P0 MCP Streamable HTTP stateful router wiring.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { handleStatefulMcpHttpRequest } from '#copilot/mcp/adapters';
import { createMcpHttpSessionRuntime, createMcpInMemoryEventStore } from '#copilot/mcp/control-plane';

/**
 * @param {string} method
 * @param {Record<string, string>} [headers]
 * @returns {import('node:http').IncomingMessage}
 */
function fakeReq(method, headers = {}) {
    return /** @type {import('node:http').IncomingMessage} */ ({
        method,
        headers,
        httpVersionMajor: 1,
    });
}

/**
 * @returns {import('node:http').ServerResponse}
 */
function fakeRes() {
    return /** @type {import('node:http').ServerResponse} */ ({
        headersSent: false,
        writableEnded: false,
        setHeader() {},
        end() {},
    });
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {string} name
 * @returns {string | undefined}
 */
function readHeader(req, name) {
    const value = req.headers[name.toLowerCase()];
    return typeof value === 'string' ? value : undefined;
}

/**
 * @param {unknown[]} errors
 * @returns {(res: import('node:http').ServerResponse, statusCode: number, error: { error: string; error_description: string }) => void}
 */
function captureTransportErrors(errors) {
    return (_res, statusCode, error) => {
        errors.push({ statusCode, error });
    };
}

const initializeBody = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'unit-test', version: '1.0.0' },
    },
};

const noneDevBinding = {
    ok: true,
    verified: false,
    binding: {
        mode: 'none-dev',
        issuerHash: '',
        subjectHash: '',
        clientIdHash: '',
        resource: 'https://mcp.aurelin.org/mcp',
        audience: 'https://mcp.aurelin.org',
        scopes: [],
    },
};

/** @returns {typeof noneDevBinding} */
function resolveNoneDevBinding() {
    return noneDevBinding;
}

describe('MCP HTTP stateful router', () => {
    it('initializes a stateful transport and registers it in the runtime', async () => {
        const runtime = createMcpHttpSessionRuntime({ ttlMs: 10_000, maxSessions: 4, store: null });
        const errors = [];
        let connected = false;
        let bodySeen = null;
        const server = {
            async connect() {
                connected = true;
            },
            async close() {},
        };

        await handleStatefulMcpHttpRequest({
            req: fakeReq('POST'),
            res: fakeRes(),
            url: new URL('https://mcp.aurelin.org/mcp'),
            parsedMcpBody: initializeBody,
            authContext: { bearerToken: null, headers: {}, method: 'POST', url: 'https://mcp.aurelin.org/mcp' },
            protocolVersion: '2025-11-25',
            runtime,
            useSqliteStore: false,
            readHeader,
            writeTransportError: captureTransportErrors(errors),
            createServer: () => server,
            createTransport: (transportOptions) =>
                /** @type {import('@modelcontextprotocol/sdk/server/streamableHttp.js').StreamableHTTPServerTransport} */ ({
                    async handleRequest(_req, _res, body) {
                        bodySeen = body;
                        transportOptions.onsessioninitialized?.('session-1');
                    },
                    async close() {},
                }),
        });

        assert.equal(errors.length, 0);
        assert.equal(connected, true);
        assert.equal(bodySeen, initializeBody);
        assert.equal(runtime.snapshot().activeSessions, 1);
        assert.equal(JSON.stringify(runtime.snapshot()).includes('session-1'), false);
    });

    it('rejects initialize with 503 before the SDK when session capacity is exhausted', async () => {
        const runtime = createMcpHttpSessionRuntime({ ttlMs: 10_000, maxSessions: 1, store: null });
        runtime.register({ sessionId: 'session-full', transport: {}, server: {} });
        const errors = [];
        let transportCreated = false;

        await handleStatefulMcpHttpRequest({
            req: fakeReq('POST'),
            res: fakeRes(),
            url: new URL('https://mcp.aurelin.org/mcp'),
            parsedMcpBody: initializeBody,
            authContext: { bearerToken: null, headers: {}, method: 'POST', url: 'https://mcp.aurelin.org/mcp' },
            protocolVersion: '2025-11-25',
            runtime,
            useSqliteStore: false,
            readHeader,
            writeTransportError: captureTransportErrors(errors),
            createServer: () => ({ async connect() {}, async close() {} }),
            createTransport: () => {
                transportCreated = true;
                return /** @type {import('@modelcontextprotocol/sdk/server/streamableHttp.js').StreamableHTTPServerTransport} */ ({
                    async handleRequest() {},
                    async close() {},
                });
            },
        });

        assert.equal(transportCreated, false);
        assert.deepEqual(errors, [
            {
                statusCode: 503,
                error: {
                    error: 'server_overloaded',
                    error_description: 'MCP stateful session capacity reached. Retry after active sessions expire or close.',
                },
            },
        ]);
    });

    it('reuses an existing transport for session-bound POST requests', async () => {
        const runtime = createMcpHttpSessionRuntime({ ttlMs: 10_000, maxSessions: 4, store: null });
        let handled = 0;
        const transport = {
            async handleRequest(_req, _res, body) {
                handled += 1;
                assert.deepEqual(body, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
            },
            async close() {},
        };
        runtime.register({ sessionId: 'session-2', transport, server: {} });

        await handleStatefulMcpHttpRequest({
            req: fakeReq('POST', { 'mcp-session-id': 'session-2' }),
            res: fakeRes(),
            url: new URL('https://mcp.aurelin.org/mcp'),
            parsedMcpBody: { jsonrpc: '2.0', id: 2, method: 'tools/list' },
            authContext: { bearerToken: null, headers: {}, method: 'POST', url: 'https://mcp.aurelin.org/mcp' },
            protocolVersion: '2025-11-25',
            runtime,
            useSqliteStore: false,
            readHeader,
            writeTransportError: captureTransportErrors([]),
        });

        assert.equal(handled, 1);
        assert.equal(runtime.snapshot().activeSessions, 1);
    });

    it('replays later local events on GET with a valid Last-Event-ID', async () => {
        const runtime = createMcpHttpSessionRuntime({ ttlMs: 10_000, maxSessions: 4, store: null });
        const errors = [];
        const eventStore = createMcpInMemoryEventStore({ maxEventsPerStream: 10, eventTtlMs: 10_000 });
        /** @type {unknown[]} */
        const replayed = [];
        /** @type {string | null} */
        let firstEventId = null;

        const transport = {
            async handleRequest(req, _res, body) {
                if (String(req.method ?? '').toUpperCase() === 'POST') {
                    transportOptions.onsessioninitialized?.('session-replay');
                    assert.equal(body, initializeBody);
                    return;
                }
                const lastEventId = readHeader(/** @type {import('node:http').IncomingMessage} */ (req), 'last-event-id');
                assert.equal(lastEventId, firstEventId);
                await eventStore.replayEventsAfter(String(lastEventId), { send: (message) => replayed.push(message) });
            },
            async close() {},
        };
        /** @type {import('@modelcontextprotocol/sdk/server/streamableHttp.js').StreamableHTTPServerTransportOptions} */
        let transportOptions;

        await handleStatefulMcpHttpRequest({
            req: fakeReq('POST'),
            res: fakeRes(),
            url: new URL('https://mcp.aurelin.org/mcp'),
            parsedMcpBody: initializeBody,
            authContext: { bearerToken: null, headers: {}, method: 'POST', url: 'https://mcp.aurelin.org/mcp' },
            protocolVersion: '2025-11-25',
            runtime,
            useSqliteStore: false,
            readHeader,
            writeTransportError: captureTransportErrors(errors),
            createServer: () => ({ async connect() {}, async close() {} }),
            createEventStore: () => eventStore,
            createTransport: (options) => {
                transportOptions = options;
                return /** @type {import('@modelcontextprotocol/sdk/server/streamableHttp.js').StreamableHTTPServerTransport} */ (transport);
            },
        });

        firstEventId = await eventStore.storeEvent('stream-replay', { jsonrpc: '2.0', method: 'first' });
        await eventStore.storeEvent('stream-replay', { jsonrpc: '2.0', method: 'second' });
        await eventStore.storeEvent('stream-other', { jsonrpc: '2.0', method: 'other' });

        await handleStatefulMcpHttpRequest({
            req: fakeReq('GET', {
                accept: 'text/event-stream',
                'mcp-session-id': 'session-replay',
                'last-event-id': firstEventId,
            }),
            res: fakeRes(),
            url: new URL('https://mcp.aurelin.org/mcp'),
            parsedMcpBody: undefined,
            authContext: { bearerToken: null, headers: {}, method: 'GET', url: 'https://mcp.aurelin.org/mcp' },
            protocolVersion: '2025-11-25',
            runtime,
            useSqliteStore: false,
            readHeader,
            writeTransportError: captureTransportErrors(errors),
        });

        assert.equal(errors.length, 0);
        assert.deepEqual(replayed, [{ jsonrpc: '2.0', method: 'second' }]);
    });

    it('seeds the explicit SDK replay diagnostic on the same event store before GET handling', async () => {
        const runtime = createMcpHttpSessionRuntime({ ttlMs: 10_000, maxSessions: 4, store: null });
        const errors = [];
        const eventStore = createMcpInMemoryEventStore({ maxEventsPerStream: 10, eventTtlMs: 10_000 });
        /** @type {unknown[]} */
        const replayed = [];
        /** @type {import('@modelcontextprotocol/sdk/server/streamableHttp.js').StreamableHTTPServerTransportOptions} */
        let transportOptions;
        const transport = {
            async handleRequest(req, _res, body) {
                if (String(req.method ?? '').toUpperCase() === 'POST') {
                    transportOptions.onsessioninitialized?.('session-replay-probe');
                    assert.equal(body, initializeBody);
                    return;
                }
                const lastEventId = readHeader(/** @type {import('node:http').IncomingMessage} */ (req), 'last-event-id');
                assert.ok(lastEventId);
                await eventStore.replayEventsAfter(String(lastEventId), { send: (message) => replayed.push(message) });
            },
            async close() {},
        };

        await handleStatefulMcpHttpRequest({
            req: fakeReq('POST'),
            res: fakeRes(),
            url: new URL('https://mcp.aurelin.org/mcp'),
            parsedMcpBody: initializeBody,
            authContext: { bearerToken: null, headers: {}, method: 'POST', url: 'https://mcp.aurelin.org/mcp' },
            protocolVersion: '2025-11-25',
            runtime,
            useSqliteStore: false,
            readHeader,
            writeTransportError: captureTransportErrors(errors),
            createServer: () => ({ async connect() {}, async close() {} }),
            createEventStore: () => eventStore,
            createTransport: (options) => {
                transportOptions = options;
                return /** @type {import('@modelcontextprotocol/sdk/server/streamableHttp.js').StreamableHTTPServerTransport} */ (transport);
            },
        });

        const headers = {};
        const res = /** @type {import('node:http').ServerResponse} */ ({
            headersSent: false,
            writableEnded: false,
            setHeader(name, value) { headers[String(name).toLowerCase()] = String(value); },
            end() {},
        });
        const firstEventId = await eventStore.storeEvent('stream-replay-probe', { jsonrpc: '2.0', method: 'first' });
        await handleStatefulMcpHttpRequest({
            req: fakeReq('GET', {
                accept: 'text/event-stream',
                'mcp-session-id': 'session-replay-probe',
                'last-event-id': firstEventId,
                'x-copilot-mcp-sdk-replay-probe': '1',
            }),
            res,
            url: new URL('https://mcp.aurelin.org/mcp'),
            parsedMcpBody: undefined,
            authContext: { bearerToken: null, headers: {}, method: 'GET', url: 'https://mcp.aurelin.org/mcp' },
            protocolVersion: '2025-11-25',
            runtime,
            useSqliteStore: false,
            readHeader,
            writeTransportError: captureTransportErrors(errors),
        });

        assert.equal(errors.length, 0);
        assert.equal(headers['x-copilot-mcp-sse-replay-probe'], 'seeded-same-stream');
        assert.deepEqual(replayed, [{
            jsonrpc: '2.0',
            method: 'notifications/message',
            params: { level: 'info', logger: 'copilot-mcp-sdk-replay-probe', data: { sequence: 2 } },
        }]);
    });

    it('answers the explicit SSE diagnostic probe without entering the long-lived SDK stream', async () => {
        const runtime = createMcpHttpSessionRuntime({ ttlMs: 10_000, maxSessions: 4, store: null });
        let handled = 0;
        runtime.register({
            sessionId: 'session-probe',
            transport: { async handleRequest() { handled += 1; } },
            server: {},
        });
        const errors = [];
        const headers = {};
        const res = /** @type {import('node:http').ServerResponse} */ ({
            headersSent: false,
            writableEnded: false,
            statusCode: 0,
            body: '',
            setHeader(name, value) { headers[String(name).toLowerCase()] = String(value); },
            write(chunk) { this.headersSent = true; this.body += String(chunk); },
            end() { this.writableEnded = true; },
        });

        await handleStatefulMcpHttpRequest({
            req: fakeReq('GET', {
                accept: 'text/event-stream',
                'mcp-session-id': 'session-probe',
                'x-copilot-mcp-sse-probe': '1',
            }),
            res,
            url: new URL('https://mcp.aurelin.org/mcp'),
            parsedMcpBody: undefined,
            authContext: { bearerToken: null, headers: {}, method: 'GET', url: 'https://mcp.aurelin.org/mcp' },
            protocolVersion: '2025-11-25',
            runtime,
            useSqliteStore: false,
            readHeader,
            writeTransportError: captureTransportErrors(errors),
        });

        assert.equal(errors.length, 0);
        assert.equal(handled, 0);
        assert.equal(/** @type {{ statusCode: number; body: string; writableEnded: boolean }} */ (res).statusCode, 200);
        assert.equal(headers['x-copilot-mcp-sse-probe'], 'ok');
        assert.match(headers['content-type'], /text\/event-stream/u);
        assert.match(/** @type {{ body: string }} */ (res).body, /copilot-mcp-sse-probe/u);
        assert.equal(/** @type {{ writableEnded: boolean }} */ (res).writableEnded, true);
    });

    it('enters the SDK GET stream path and sends the explicit SDK SSE diagnostic notification', async () => {
        const runtime = createMcpHttpSessionRuntime({ ttlMs: 10_000, maxSessions: 4, store: null });
        let handled = 0;
        const sent = [];
        runtime.register({
            sessionId: 'session-sdk-probe',
            transport: {
                async handleRequest() {
                    handled += 1;
                    await new Promise((resolve) => setTimeout(resolve, 60));
                },
                async send(message) { sent.push(message); },
            },
            server: {},
        });
        const errors = [];

        await handleStatefulMcpHttpRequest({
            req: fakeReq('GET', {
                accept: 'text/event-stream',
                'mcp-session-id': 'session-sdk-probe',
                'x-copilot-mcp-sdk-sse-probe': '1',
            }),
            res: fakeRes(),
            url: new URL('https://mcp.aurelin.org/mcp'),
            parsedMcpBody: undefined,
            authContext: { bearerToken: null, headers: {}, method: 'GET', url: 'https://mcp.aurelin.org/mcp' },
            protocolVersion: '2025-11-25',
            runtime,
            useSqliteStore: false,
            readHeader,
            writeTransportError: captureTransportErrors(errors),
        });

        assert.equal(errors.length, 0);
        assert.equal(handled, 1);
        assert.equal(sent.length, 1);
        assert.equal(sent[0]?.method, 'notifications/message');
        assert.equal(sent[0]?.params?.logger, 'copilot-mcp-sdk-sse-probe');
    });

    it('rejects malformed Last-Event-ID on GET before opening a stream', async () => {
        const runtime = createMcpHttpSessionRuntime({ ttlMs: 10_000, maxSessions: 4, store: null });
        runtime.register({ sessionId: 'session-3', transport: {}, server: {} });
        const errors = [];

        await handleStatefulMcpHttpRequest({
            req: fakeReq('GET', { accept: 'text/event-stream', 'mcp-session-id': 'session-3', 'last-event-id': 'bad id' }),
            res: fakeRes(),
            url: new URL('https://mcp.aurelin.org/mcp'),
            parsedMcpBody: undefined,
            authContext: { bearerToken: null, headers: {}, method: 'GET', url: 'https://mcp.aurelin.org/mcp' },
            protocolVersion: '2025-11-25',
            runtime,
            useSqliteStore: false,
            readHeader,
            writeTransportError: captureTransportErrors(errors),
        });

        assert.equal(/** @type {{ statusCode: number }[]} */ (errors)[0]?.statusCode, 400);
        assert.match(JSON.stringify(errors[0]), /Last-Event-ID/u);
    });

    it('rejects session-bound requests without Mcp-Session-Id', async () => {
        const errors = [];
        await handleStatefulMcpHttpRequest({
            req: fakeReq('POST'),
            res: fakeRes(),
            url: new URL('https://mcp.aurelin.org/mcp'),
            parsedMcpBody: { jsonrpc: '2.0', id: 2, method: 'tools/list' },
            authContext: { bearerToken: null, headers: {}, method: 'POST', url: 'https://mcp.aurelin.org/mcp' },
            protocolVersion: '2025-11-25',
            runtime: createMcpHttpSessionRuntime({ store: null }),
            useSqliteStore: false,
            readHeader,
            writeTransportError: captureTransportErrors(errors),
        });

        assert.deepEqual(errors, [
            {
                statusCode: 400,
                error: {
                    error: 'invalid_request',
                    error_description: 'MCP requests after initialize must include Mcp-Session-Id.',
                },
            },
        ]);
    });

    it('rejects unknown or expired sessions with 404', async () => {
        const errors = [];
        await handleStatefulMcpHttpRequest({
            req: fakeReq('POST', { 'mcp-session-id': 'missing' }),
            res: fakeRes(),
            url: new URL('https://mcp.aurelin.org/mcp'),
            parsedMcpBody: { jsonrpc: '2.0', id: 2, method: 'tools/list' },
            authContext: { bearerToken: null, headers: {}, method: 'POST', url: 'https://mcp.aurelin.org/mcp' },
            protocolVersion: '2025-11-25',
            runtime: createMcpHttpSessionRuntime({ store: null }),
            useSqliteStore: false,
            readHeader,
            writeTransportError: captureTransportErrors(errors),
        });

        assert.equal(/** @type {{ statusCode: number }[]} */ (errors)[0]?.statusCode, 404);
    });
});
