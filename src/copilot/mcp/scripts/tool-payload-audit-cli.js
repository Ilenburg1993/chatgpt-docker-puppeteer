#!/usr/bin/env node
// @ts-check

import { buildToolPayloadAudit } from '#copilot/mcp/public/diagnostics/tool-payload';
import { getCanonicalMcpTools } from '#copilot/mcp/public/registry';

process.stdout.write(`${JSON.stringify(await buildToolPayloadAudit({ tools: getCanonicalMcpTools() }), null, 2)}\n`);
