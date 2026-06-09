// @ts-check
/**
 * Tests for MCP audit persistence.
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'vitest';

import { appendMcpAuditEvent } from '#copilot/mcp/control-plane';

describe('copilot MCP audit', () => {
    it('appends JSONL events to the configured audit file', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'copilot-mcp-audit-'));
        const auditFile = path.join(dir, 'audit.jsonl');
        const previous = process.env['COPILOT_MCP_AUDIT_FILE'];
        const previousSync = process.env['COPILOT_MCP_AUDIT_SYNC'];
        process.env['COPILOT_MCP_AUDIT_FILE'] = auditFile;
        process.env['COPILOT_MCP_AUDIT_SYNC'] = 'true';
        try {
            await appendMcpAuditEvent({ event: 'test_event', tool: 'repo_status' });
            const text = await readFile(auditFile, 'utf8');
            const row = JSON.parse(text.trim());
            assert.equal(row.event, 'test_event');
            assert.equal(row.tool, 'repo_status');
            assert.equal(row.component, 'copilot-mcp');
        } finally {
            if (previous === undefined) {
                delete process.env['COPILOT_MCP_AUDIT_FILE'];
            } else {
                process.env['COPILOT_MCP_AUDIT_FILE'] = previous;
            }
            if (previousSync === undefined) {
                delete process.env['COPILOT_MCP_AUDIT_SYNC'];
            } else {
                process.env['COPILOT_MCP_AUDIT_SYNC'] = previousSync;
            }
            await rm(dir, { recursive: true, force: true });
        }
    });
});
