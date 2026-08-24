// @ts-check
/** Tests for the bootstrap-bound MCP audit runtime. */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, vi } from 'vitest';

const AUDIT_FILE_ENV = 'COPILOT_MCP_AUDIT_FILE';
const AUDIT_SYNC_ENV = 'COPILOT_MCP_AUDIT_SYNC';
const AUDIT_DISABLED_ENV = 'COPILOT_MCP_AUDIT_DISABLED';

/** @param {string} auditFile */
async function loadAuditModule(auditFile) {
    process.env[AUDIT_FILE_ENV] = auditFile;
    vi.resetModules();
    return import('#copilot/testing/mcp/observability');
}

function captureAuditEnv() {
    return {
        file: process.env[AUDIT_FILE_ENV],
        sync: process.env[AUDIT_SYNC_ENV],
        disabled: process.env[AUDIT_DISABLED_ENV],
    };
}

/** @param {ReturnType<typeof captureAuditEnv>} previous */
function restoreAuditEnv(previous) {
    if (previous.file === undefined) delete process.env[AUDIT_FILE_ENV];
    else process.env[AUDIT_FILE_ENV] = previous.file;
    if (previous.sync === undefined) delete process.env[AUDIT_SYNC_ENV];
    else process.env[AUDIT_SYNC_ENV] = previous.sync;
    if (previous.disabled === undefined) delete process.env[AUDIT_DISABLED_ENV];
    else process.env[AUDIT_DISABLED_ENV] = previous.disabled;
}

describe('copilot MCP audit', () => {
    it('default artifact identity remains under src/copilot/.ai after owner relocation', async () => {
        const previous = captureAuditEnv();
        try {
            delete process.env[AUDIT_FILE_ENV];
            vi.resetModules();
            const audit = await import('#copilot/testing/mcp/observability');
            assert.equal(
                audit.getMcpAuditFileForTests(),
                path.join(process.cwd(), 'src/copilot/.ai/audit/mcp-tool-calls.jsonl'),
            );
        } finally {
            restoreAuditEnv(previous);
        }
    });
    it('appends and bounded-reads JSONL events from one bootstrap-bound audit file', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'copilot-mcp-audit-'));
        const auditFile = path.join(dir, 'audit.jsonl');
        const previous = captureAuditEnv();
        process.env[AUDIT_SYNC_ENV] = 'true';
        delete process.env[AUDIT_DISABLED_ENV];
        try {
            const audit = await loadAuditModule(auditFile);
            await audit.appendMcpAuditEvent({ event: 'test_event', tool: 'repo_status' });
            const text = await readFile(auditFile, 'utf8');
            const row = JSON.parse(text.trim());
            assert.equal(row.event, 'test_event');
            assert.equal(row.tool, 'repo_status');
            assert.equal(row.component, 'copilot-mcp');

            const tail = await audit.readMcpAuditEventTail({ tailBytes: 64 * 1024, maxEvents: 100 });
            assert.equal(tail.ok, true);
            assert.equal(tail.parsedEvents, 1);
            assert.equal(tail.events[0]?.['event'], 'test_event');
        } finally {
            restoreAuditEnv(previous);
            await rm(dir, { recursive: true, force: true });
        }
    });

    it('preserves logical order when strict sync is enabled after queued async events', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'copilot-mcp-audit-order-'));
        const auditFile = path.join(dir, 'audit.jsonl');
        const previous = captureAuditEnv();
        delete process.env[AUDIT_SYNC_ENV];
        delete process.env[AUDIT_DISABLED_ENV];
        try {
            const audit = await loadAuditModule(auditFile);
            await audit.appendMcpAuditEvent({ event: 'queued_first' });
            await audit.appendMcpAuditEvent({ event: 'queued_second' });
            process.env[AUDIT_SYNC_ENV] = 'true';
            await audit.appendMcpAuditEvent({ event: 'sync_last' });
            await audit.flushMcpAuditEvents();

            const rows = (await readFile(auditFile, 'utf8'))
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line));
            assert.deepEqual(
                rows.map((row) => row.event),
                ['queued_first', 'queued_second', 'sync_last'],
            );
        } finally {
            restoreAuditEnv(previous);
            await rm(dir, { recursive: true, force: true });
        }
    });

    it('does not retarget writer or reader when COPILOT_MCP_AUDIT_FILE changes after bootstrap binding', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'copilot-mcp-audit-binding-'));
        const boundFile = path.join(dir, 'bound.jsonl');
        const retargetFile = path.join(dir, 'retarget.jsonl');
        const previous = captureAuditEnv();
        process.env[AUDIT_SYNC_ENV] = 'true';
        delete process.env[AUDIT_DISABLED_ENV];
        try {
            const audit = await loadAuditModule(boundFile);
            process.env[AUDIT_FILE_ENV] = retargetFile;
            await audit.appendMcpAuditEvent({ event: 'bound_identity' });
            await audit.flushMcpAuditEvents();

            assert.match(await readFile(boundFile, 'utf8'), /bound_identity/u);
            await assert.rejects(
                () => readFile(retargetFile, 'utf8'),
                (error) => /** @type {{ code?: unknown }} */ (error)?.code === 'ENOENT',
            );
            const tail = await audit.readMcpAuditEventTail({ tailBytes: 64 * 1024, maxEvents: 100 });
            assert.equal(tail.events.at(-1)?.['event'], 'bound_identity');
        } finally {
            restoreAuditEnv(previous);
            await rm(dir, { recursive: true, force: true });
        }
    });
});
