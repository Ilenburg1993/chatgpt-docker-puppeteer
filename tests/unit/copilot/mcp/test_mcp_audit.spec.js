// @ts-check
/** Tests for explicit process-host-owned MCP audit capabilities. */

import { MCP_WORKSPACE_ROOT } from '#copilot/mcp/public/workspace';
import { createMcpAuditCapability, readMcpAuditProcessConfig } from '#copilot/testing/mcp/observability';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'vitest';

describe('copilot MCP audit capability', () => {
    it('keeps the default artifact identity under src/copilot/.ai after owner relocation', () => {
        const config = readMcpAuditProcessConfig({});
        const audit = createMcpAuditCapability(config);
        assert.equal(config.filePath, path.join(MCP_WORKSPACE_ROOT, 'src/copilot/.ai/audit/mcp-tool-calls.jsonl'));
        assert.equal(audit.filePath, config.filePath);
        assert.equal(Object.isFrozen(config), true);
        assert.equal(Object.isFrozen(audit), true);
        assert.equal(
            readMcpAuditProcessConfig({ COPILOT_MCP_AUDIT_FILE: 'src/copilot/.ai/audit/custom.jsonl' }).filePath,
            path.join(MCP_WORKSPACE_ROOT, 'src/copilot/.ai/audit/custom.jsonl'),
        );
    });

    it('appends and bounded-reads JSONL events from one explicit capability', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'copilot-mcp-audit-'));
        const auditFile = path.join(dir, 'audit.jsonl');
        const audit = createMcpAuditCapability(
            readMcpAuditProcessConfig({ COPILOT_MCP_AUDIT_FILE: auditFile, COPILOT_MCP_AUDIT_SYNC: 'true' }),
        );
        try {
            await audit.append({ event: 'test_event', tool: 'repo_status' });
            const row = JSON.parse((await readFile(auditFile, 'utf8')).trim());
            assert.equal(row.event, 'test_event');
            assert.equal(row.tool, 'repo_status');
            assert.equal(row.component, 'copilot-mcp');
            const tail = await audit.readTail({ tailBytes: 64 * 1024, maxEvents: 100 });
            assert.equal(tail.ok, true);
            assert.equal(tail.parsedEvents, 1);
            assert.equal(tail.events[0]?.['event'], 'test_event');
        } finally {
            await audit.flush();
            await rm(dir, { recursive: true, force: true });
        }
    });

    it('persists only a fixed privacy-safe compatibility projection and returns aggregate retirement evidence', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'copilot-mcp-audit-compat-'));
        const auditFile = path.join(dir, 'audit.jsonl');
        const audit = createMcpAuditCapability(
            readMcpAuditProcessConfig({ COPILOT_MCP_AUDIT_FILE: auditFile, COPILOT_MCP_AUDIT_SYNC: 'true' }),
        );
        try {
            await audit.recordCompatibility({
                kind: 'protocol-request',
                protocolEra: '2026',
                transportMode: 'modern-2026',
                rpcClass: 'tools-call',
                continuity: 'stream-resume',
                clientId: 'must-never-persist',
                token: 'must-never-persist',
            });
            await audit.recordCompatibility({
                kind: 'oauth-client',
                clientSource: 'cimd',
                hostClass: 'chatgpt',
                resolution: 'trusted-fallback',
                outcome: 'succeeded',
                redirectUri: 'https://example.invalid/private',
            });
            await audit.recordCompatibility({
                kind: 'oauth-grant',
                grantType: 'refresh_token',
                clientSource: 'cimd',
                hostClass: 'chatgpt',
                outcome: 'succeeded',
                subject: 'must-never-persist',
            });

            const text = await readFile(auditFile, 'utf8');
            assert.doesNotMatch(text, /must-never-persist|example\.invalid/u);
            const rows = text
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line));
            assert.deepEqual(Object.keys(rows[0]).sort(), [
                'component',
                'continuity',
                'event',
                'kind',
                'protocolEra',
                'rpcClass',
                'schemaVersion',
                'transportMode',
                'ts',
            ]);

            const summary = await audit.readCompatibilitySummary({ tailBytes: 64 * 1024, maxEvents: 100 });
            assert.equal(summary.observations, 3);
            assert.equal(summary.protocol.totalRequests, 1);
            assert.equal(summary.protocol.byEra['2026'], 1);
            assert.equal(summary.protocol.byContinuity['stream-resume'], 1);
            assert.equal(summary.oauth.clientActivity.bySource.cimd, 1);
            assert.equal(summary.oauth.clientActivity.byHostClass.chatgpt, 1);
            assert.equal(summary.oauth.clientActivity.successfulByHostClass.chatgpt, 1);
            assert.equal(summary.oauth.clientActivity.byOutcome.succeeded, 1);
            assert.equal(summary.oauth.grants.byGrantType.refresh_token, 1);
            assert.equal(summary.oauth.grants.byOutcome.succeeded, 1);
            assert.ok(summary.window.firstObservedAt);
            assert.ok(summary.window.lastObservedAt);
            await assert.rejects(
                () =>
                    audit.recordCompatibility({
                        kind: 'protocol-request',
                        protocolEra: '2099',
                        transportMode: 'modern-2026',
                        rpcClass: 'tools-call',
                        continuity: 'none',
                    }),
                /Invalid MCP compatibility protocolEra/u,
            );
        } finally {
            await audit.flush();
            await rm(dir, { recursive: true, force: true });
        }
    });

    it('captures disabled/sync/file policy once and does not drift with source environment mutation', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'copilot-mcp-audit-config-'));
        const auditFile = path.join(dir, 'audit.jsonl');
        try {
            const env = {
                COPILOT_MCP_AUDIT_FILE: auditFile,
                COPILOT_MCP_AUDIT_SYNC: 'false',
                COPILOT_MCP_AUDIT_DISABLED: 'false',
            };
            const config = readMcpAuditProcessConfig(env);
            const audit = createMcpAuditCapability(config);
            env.COPILOT_MCP_AUDIT_FILE = path.join(dir, 'mutated.jsonl');
            env.COPILOT_MCP_AUDIT_SYNC = 'true';
            env.COPILOT_MCP_AUDIT_DISABLED = 'true';
            assert.equal(audit.config.filePath, auditFile);
            assert.equal(audit.config.sync, false);
            assert.equal(audit.config.disabled, false);
            await audit.flush();
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    it('preserves logical order within one capability', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'copilot-mcp-audit-order-'));
        const auditFile = path.join(dir, 'audit.jsonl');
        const audit = createMcpAuditCapability(readMcpAuditProcessConfig({ COPILOT_MCP_AUDIT_FILE: auditFile }));
        try {
            await audit.append({ event: 'queued_first' });
            await audit.append({ event: 'queued_second' });
            await audit.append({ event: 'queued_third' });
            await audit.flush();
            const rows = (await readFile(auditFile, 'utf8'))
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line));
            assert.deepEqual(
                rows.map((row) => row.event),
                ['queued_first', 'queued_second', 'queued_third'],
            );
        } finally {
            await audit.flush();
            await rm(dir, { recursive: true, force: true });
        }
    });

    it('allows independent audit generations without mutable module rebinding', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'copilot-mcp-audit-binding-'));
        const firstFile = path.join(dir, 'first.jsonl');
        const secondFile = path.join(dir, 'second.jsonl');
        const first = createMcpAuditCapability(
            readMcpAuditProcessConfig({ COPILOT_MCP_AUDIT_FILE: firstFile, COPILOT_MCP_AUDIT_SYNC: 'true' }),
        );
        const second = createMcpAuditCapability(
            readMcpAuditProcessConfig({ COPILOT_MCP_AUDIT_FILE: secondFile, COPILOT_MCP_AUDIT_SYNC: 'true' }),
        );
        try {
            await first.append({ event: 'first_identity' });
            await second.append({ event: 'second_identity' });
            assert.match(await readFile(firstFile, 'utf8'), /first_identity/u);
            assert.doesNotMatch(await readFile(firstFile, 'utf8'), /second_identity/u);
            assert.match(await readFile(secondFile, 'utf8'), /second_identity/u);
            assert.doesNotMatch(await readFile(secondFile, 'utf8'), /first_identity/u);
        } finally {
            await Promise.all([first.flush(), second.flush()]);
            await rm(dir, { recursive: true, force: true });
        }
    });

    it('suppresses persistence when its immutable generation disables audit', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'copilot-mcp-audit-disabled-'));
        const auditFile = path.join(dir, 'audit.jsonl');
        const audit = createMcpAuditCapability(
            readMcpAuditProcessConfig({
                COPILOT_MCP_AUDIT_FILE: auditFile,
                COPILOT_MCP_AUDIT_DISABLED: 'true',
                COPILOT_MCP_AUDIT_SYNC: 'true',
            }),
        );
        try {
            await audit.append({ event: 'must_not_persist' });
            await audit.flush();
            await assert.rejects(
                () => readFile(auditFile, 'utf8'),
                (error) => /** @type {{ code?: unknown }} */ (error)?.code === 'ENOENT',
            );
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});
