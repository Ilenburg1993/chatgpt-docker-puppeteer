// @ts-check
/**
 * Tests for the local Copilot MCP HTTP smoke helpers.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
    buildMcpHttpProtocolReport,
    createMcpHttpProtocolState,
    readMcpHttp2ServerPolicy,
    readMcpHttpServerTimingPolicy,
    recordMcpHttpProtocolRequest,
} from '#copilot/mcp/adapters';
import {
    compareToolNames,
    extractMcpToolNames,
} from '#copilot/mcp/scripts';

describe('copilot MCP local HTTP smoke helpers', () => {
    it('extracts tool names from a JSON-RPC tools/list body', () => {
        const names = extractMcpToolNames({
            jsonrpc: '2.0',
            id: 1,
            result: {
                tools: [{ name: 'repo_status' }, { name: 'mcp_runtime_health' }, { title: 'ignored' }],
            },
        });

        assert.deepEqual(names, ['mcp_runtime_health', 'repo_status']);
    });

    it('compares remote tool names with the local registry expectation', () => {
        const matched = compareToolNames(['a', 'b'], ['a', 'b']);
        assert.equal(matched.matches, true);

        const drift = compareToolNames(['a', 'extra'], ['a', 'b']);
        assert.equal(drift.matches, false);
        assert.deepEqual(drift.missingTools, ['b']);
        assert.deepEqual(drift.unexpectedTools, ['extra']);
    });

    it('normalizes HTTP timing for Cloudflare loopback keep-alive reuse', () => {
        assert.deepEqual(readMcpHttpServerTimingPolicy({}), {
            keepAliveTimeoutMs: 90_000,
            headersTimeoutMs: 95_000,
            requestTimeoutMs: 120_000,
        });
        assert.deepEqual(
            readMcpHttpServerTimingPolicy({
                COPILOT_MCP_HTTP_KEEP_ALIVE_TIMEOUT_MS: '120000',
                COPILOT_MCP_HTTP_HEADERS_TIMEOUT_MS: '121000',
                COPILOT_MCP_HTTP_REQUEST_TIMEOUT_MS: '180000',
            }),
            {
                keepAliveTimeoutMs: 120_000,
                headersTimeoutMs: 121_000,
                requestTimeoutMs: 180_000,
            },
        );
    });

    it('records origin protocol telemetry without inspecting request bodies', () => {
        const state = createMcpHttpProtocolState('http1');
        recordMcpHttpProtocolRequest(
            state,
            /** @type {import('node:http').IncomingMessage} */ ({
                httpVersion: '1.1',
                httpVersionMajor: 1,
                method: 'GET',
                url: '/health?token=redacted',
                headers: {},
                socket: {},
            }),
        );

        const report = buildMcpHttpProtocolReport(state);
        assert.equal(report['protocolMode'], 'http1');
        assert.equal(report['observedRequests'], 1);
        assert.deepEqual(report['httpVersionCounts'], { '1.1': 1 });
        assert.deepEqual(report['alpnCounts'], { none: 1 });
        const lastRequest = /** @type {Record<string, unknown>} */ (report['lastRequest']);
        assert.equal(lastRequest['httpVersion'], '1.1');
        assert.equal(lastRequest['path'], '/health');
        assert.equal(lastRequest['encrypted'], false);
    });

    it('normalizes the opt-in HTTP/2 server policy', () => {
        assert.deepEqual(readMcpHttp2ServerPolicy({}), {
            certFile: 'src/copilot/.ai/cloudflare/origin-cert.pem',
            keyFile: 'src/copilot/.ai/cloudflare/origin-key.pem',
            allowHTTP1: true,
            maxConcurrentStreams: 50,
            maxSessions: 32,
            maxSessionMemoryMb: 16,
            maxHeaderListPairs: 64,
            maxSendHeaderBlockLength: 32768,
            maxSettings: 32,
            maxOutstandingPings: 10,
            maxSessionInvalidFrames: 100,
            maxSessionRejectedStreams: 25,
            streamResetBurst: 100,
            streamResetRate: 33,
            unknownProtocolTimeoutMs: 2000,
            shutdownDestroyAfterMs: 3500,
            sessionIdleTimeoutMs: 95000,
            expectedCertificateHostnames: [],
            allowCertificateHostnameMismatch: false,
            certificateExpiryWarnDays: 14,
            allowNonLoopbackBind: false,
            allowNonLoopbackClients: false,
            minVersion: 'TLSv1.2',
        });
        assert.deepEqual(
            readMcpHttp2ServerPolicy({
                COPILOT_MCP_HTTP2_CERT_FILE: 'cert.pem',
                COPILOT_MCP_HTTP2_KEY_FILE: 'key.pem',
                COPILOT_MCP_HTTP2_ALLOW_HTTP1: 'false',
                COPILOT_MCP_HTTP2_MAX_CONCURRENT_STREAMS: '200',
            }),
            {
                certFile: 'cert.pem',
                keyFile: 'key.pem',
                allowHTTP1: false,
                maxConcurrentStreams: 200,
                maxSessions: 32,
                maxSessionMemoryMb: 16,
                maxHeaderListPairs: 64,
                maxSendHeaderBlockLength: 32768,
                maxSettings: 32,
                maxOutstandingPings: 10,
                maxSessionInvalidFrames: 100,
                maxSessionRejectedStreams: 25,
                streamResetBurst: 100,
                streamResetRate: 33,
                unknownProtocolTimeoutMs: 2000,
                shutdownDestroyAfterMs: 3500,
                sessionIdleTimeoutMs: 95000,
                expectedCertificateHostnames: [],
                allowCertificateHostnameMismatch: false,
                certificateExpiryWarnDays: 14,
                allowNonLoopbackBind: false,
                allowNonLoopbackClients: false,
                minVersion: 'TLSv1.2',
            },
        );
    });
});
