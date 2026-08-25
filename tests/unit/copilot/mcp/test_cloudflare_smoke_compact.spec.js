import {
    isCloudflaredActionableOriginErrorLine,
    isCloudflaredBenignClientOrStreamCancellationLine,
} from '#copilot/mcp/public/cloudflare/errors';
import {
    parseConnectorSmokeJsonOutput,
    summarizeConnectorSmokeReport,
} from '#copilot/testing/mcp/cloudflare/observability';
import {
    isCloudflaredOriginErrorLine,
    isCloudflaredTunnelTransportErrorLine,
} from '#copilot/testing/mcp/cloudflare/process';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('cloudflare connector smoke compact mode', () => {
    it('runs the canonical connector smoke in-process instead of paying child-process lifetime overhead', async () => {
        const source = await readFile('src/copilot/mcp/connection/connector-smoke.js', 'utf8');

        expect(source).toContain('runCanonicalConnectorSmoke({');
        expect(source).not.toContain("spawn(process.execPath, ['src/copilot/mcp/cloudflare/cli.js', 'smoke']");
    });

    it('suppresses remote tool names from both legacy and authenticated tool-list projections', async () => {
        const source = await readFile('src/copilot/mcp/cloudflare/observability/smoke-report.js', 'utf8');

        expect(source).toContain("delete toolsListRecord['remoteToolNames'];");
        expect(source).toContain("delete authenticatedToolsList['remoteToolNames'];");
        expect(source).toContain("authenticatedToolsList['remoteToolNamesSuppressed'] = true;");
    });

    it('parses smoke JSON when startup logs are written before the report', () => {
        const parsed = parseConnectorSmokeJsonOutput('[db][INFO] ready\n{"ok":true,"toolsList":{"tools":85}}');

        expect(parsed).toMatchObject({ ok: true, toolsList: { tools: 85 } });
    });

    it('projects a compact decision summary without losing OAuth, tools parity or SSE readiness', () => {
        const summary = summarizeConnectorSmokeReport({
            ok: true,
            protocolVersion: '2025-11-25',
            authMode: 'oauth',
            orchestrationTimings: { totalMs: 1044, unauthenticatedMs: 234, authenticatedOauthMs: 1035 },
            health: { ok: true, status: 200 },
            oauth: {
                protectedResource: { ok: true, status: 200 },
                authorizationServer: { ok: true, status: 200 },
            },
            authChallenge: { ok: true, status: 401 },
            authenticatedOAuthSmoke: {
                ok: true,
                durationMs: 1035,
                phaseTimings: { publicDiscovery: 149, tokenLifecycle: 211 },
                failedChecks: [],
                runtimeHealth: { ok: true, status: 200 },
                authenticatedToolsList: {
                    ok: true,
                    status: 200,
                    responseBytes: 117809,
                    tools: 119,
                    expectedLocalTools: 119,
                    toolsMatchLocalRegistry: true,
                    missingLocalTools: [],
                    unexpectedRemoteTools: [],
                    remoteToolNames: ['a', 'b'],
                },
                authenticatedSse: {
                    ok: true,
                    status: 200,
                    durationMs: 159,
                    initialOk: true,
                    reconnectOk: true,
                    lastEventIdAccepted: true,
                },
            },
        });

        expect(summary).toMatchObject({
            ok: true,
            protocolVersion: '2025-11-25',
            authenticated: {
                ok: true,
                toolsList: { tools: 119, expectedLocalTools: 119, toolsMatchLocalRegistry: true },
                sse: { ok: true, initialOk: true, reconnectOk: true, lastEventIdAccepted: true },
            },
        });
        expect(JSON.stringify(summary)).not.toContain('phaseTimings');
        expect(JSON.stringify(summary)).not.toContain('remoteToolNames');
        expect(Buffer.byteLength(JSON.stringify(summary))).toBeLessThan(2 * 1024);
    });

    it('classifies origin errors separately from recovered tunnel transport errors', () => {
        const originLine =
            '2026-06-10T16:14:19Z ERR failed to serve incoming request error="Failed to proxy HTTP: Unable to reach the origin service: tls: first record does not look like a TLS handshake"';
        const transportLine =
            '2026-06-10T16:14:19Z ERR failed to accept incoming stream requests error="failed to accept QUIC stream: timeout: no recent network activity" connIndex=0';

        expect(isCloudflaredOriginErrorLine(originLine)).toBe(true);
        expect(isCloudflaredTunnelTransportErrorLine(originLine)).toBe(false);
        expect(isCloudflaredOriginErrorLine(transportLine)).toBe(false);
        expect(isCloudflaredTunnelTransportErrorLine(transportLine)).toBe(true);
    });

    it('keeps benign client/stream closures observable without classifying them as actionable origin failures', () => {
        const cancellation =
            '2026-08-14T18:00:00Z ERR error="context canceled" connIndex=1 event=1 ingressRule=0 originService=https://127.0.0.1:3333';
        const gracefulHttp2StreamClose =
            '2026-08-14T18:00:01Z ERR error="stream error: stream ID 7; NO_ERROR; received from peer" connIndex=3 event=1 ingressRule=0 originService=https://127.0.0.1:3333';

        for (const line of [cancellation, gracefulHttp2StreamClose]) {
            expect(isCloudflaredOriginErrorLine(line)).toBe(true);
            expect(isCloudflaredBenignClientOrStreamCancellationLine(line)).toBe(true);
            expect(isCloudflaredActionableOriginErrorLine(line)).toBe(false);
        }
    });
});
