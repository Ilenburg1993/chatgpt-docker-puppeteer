import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
    isCloudflaredActionableOriginErrorLine,
    isCloudflaredBenignClientOrStreamCancellationLine,
} from '#copilot/mcp/cloudflare';
import {
    isCloudflaredOriginErrorLine,
    isCloudflaredTunnelTransportErrorLine,
    parseConnectorSmokeJsonOutput,
} from '#copilot/mcp/tools';

describe('cloudflare connector smoke compact mode', () => {
    it('uses compact smoke output when the MCP tool refreshes connector smoke', async () => {
        const source = await readFile('src/copilot/mcp/tools/tunnel-status.js', 'utf8');

        expect(source).toContain("COPILOT_MCP_SMOKE_COMPACT: '1'");
    });

    it('suppresses remote tool names only when compact smoke output is requested', async () => {
        const source = await readFile('src/copilot/mcp/tools/tunnel-status.js', 'utf8');

        expect(source).toContain("delete toolsListRecord['remoteToolNames'];");
        expect(source).toContain("toolsListRecord['remoteToolNamesSuppressed'] = true;");
    });

    it('parses smoke JSON when startup logs are written before the report', () => {
        const parsed = parseConnectorSmokeJsonOutput('[db][INFO] ready\n{"ok":true,"toolsList":{"tools":85}}');

        expect(parsed).toMatchObject({ ok: true, toolsList: { tools: 85 } });
    });

    it('classifies origin errors separately from recovered tunnel transport errors', () => {
        const originLine = '2026-06-10T16:14:19Z ERR failed to serve incoming request error="Failed to proxy HTTP: Unable to reach the origin service: tls: first record does not look like a TLS handshake"';
        const transportLine = '2026-06-10T16:14:19Z ERR failed to accept incoming stream requests error="failed to accept QUIC stream: timeout: no recent network activity" connIndex=0';

        expect(isCloudflaredOriginErrorLine(originLine)).toBe(true);
        expect(isCloudflaredTunnelTransportErrorLine(originLine)).toBe(false);
        expect(isCloudflaredOriginErrorLine(transportLine)).toBe(false);
        expect(isCloudflaredTunnelTransportErrorLine(transportLine)).toBe(true);
    });

    it('keeps benign client cancellation observable without classifying it as an actionable origin failure', () => {
        const cancellation =
            '2026-08-14T18:00:00Z ERR error="context canceled" connIndex=1 event=1 ingressRule=0 originService=https://127.0.0.1:3333';

        expect(isCloudflaredOriginErrorLine(cancellation)).toBe(true);
        expect(isCloudflaredBenignClientOrStreamCancellationLine(cancellation)).toBe(true);
        expect(isCloudflaredActionableOriginErrorLine(cancellation)).toBe(false);
    });
});
