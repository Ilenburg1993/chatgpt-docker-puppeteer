// @ts-check
/**
 * Tests for MCP audit persistence.
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'vitest';

import { appendMcpAuditEvent, flushMcpAuditEvents } from '#copilot/mcp/control-plane';

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

    it('preserves logical order when a sync event follows queued async events', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'copilot-mcp-audit-order-'));
        const auditFile = path.join(dir, 'audit.jsonl');
        const previous = process.env['COPILOT_MCP_AUDIT_FILE'];
        const previousSync = process.env['COPILOT_MCP_AUDIT_SYNC'];
        process.env['COPILOT_MCP_AUDIT_FILE'] = auditFile;
        delete process.env['COPILOT_MCP_AUDIT_SYNC'];
        try {
            await appendMcpAuditEvent({ event: 'queued_first' });
            await appendMcpAuditEvent({ event: 'queued_second' });
            process.env['COPILOT_MCP_AUDIT_SYNC'] = 'true';
            await appendMcpAuditEvent({ event: 'sync_last' });
            await flushMcpAuditEvents();

            const rows = (await readFile(auditFile, 'utf8'))
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line));
            assert.deepEqual(
                rows.map((row) => row.event),
                ['queued_first', 'queued_second', 'sync_last'],
            );
        } finally {
            if (previous === undefined) delete process.env['COPILOT_MCP_AUDIT_FILE'];
            else process.env['COPILOT_MCP_AUDIT_FILE'] = previous;
            if (previousSync === undefined) delete process.env['COPILOT_MCP_AUDIT_SYNC'];
            else process.env['COPILOT_MCP_AUDIT_SYNC'] = previousSync;
            await rm(dir, { recursive: true, force: true });
        }
    });
});
