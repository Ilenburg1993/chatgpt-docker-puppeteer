#!/usr/bin/env node
// @ts-check

import { getCanonicalMcpTools } from '../registry.js';
import { buildToolPayloadAudit } from './tool-payload-audit.js';

process.stdout.write(`${JSON.stringify(await buildToolPayloadAudit({ tools: getCanonicalMcpTools() }), null, 2)}\n`);
