#!/usr/bin/env node
// @ts-check

import { buildToolPayloadAudit, readMcpToolPayloadAuditConfig } from '#copilot/mcp/public/diagnostics/tool-payload';
import { getCanonicalMcpTools } from '#copilot/mcp/public/registry';

const config = readMcpToolPayloadAuditConfig();
process.stdout.write(
    `${JSON.stringify(await buildToolPayloadAudit({ tools: getCanonicalMcpTools(), config }), null, 2)}\n`,
);
