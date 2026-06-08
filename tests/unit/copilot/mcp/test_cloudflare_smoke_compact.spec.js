import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { parseConnectorSmokeJsonOutput } from '#copilot/mcp/tools';

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
});
