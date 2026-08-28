// @ts-check
/** Tests for explicit process-host-owned MCP audit capabilities. */

import { MCP_WORKSPACE_ROOT } from '#copilot/mcp/public/workspace';
import { createMcpAuditCapability, readMcpAuditProcessConfig } from '#copilot/testing/mcp/observability';
import assert from 'node:assert/strict';
import { appendFile, copyFile, mkdtemp, readFile, rename, rm, truncate, writeFile } from 'node:fs/promises';
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

    it('binds audit slices to content-free continuity anchors across append, physical rebind and truncation', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'copilot-mcp-audit-continuity-'));
        const auditFile = path.join(dir, 'audit.jsonl');
        const replacement = path.join(dir, 'replacement.jsonl');
        const audit = createMcpAuditCapability(
            readMcpAuditProcessConfig({ COPILOT_MCP_AUDIT_FILE: auditFile, COPILOT_MCP_AUDIT_SYNC: 'true' }),
        );
        try {
            await audit.append({ event: 'first', tool: 'repo_status' });
            const first = await audit.readSlice({ offset: 0, maxBytes: 64 * 1024, maxEvents: 100 });
            assert.equal(first.ok, true);
            assert.equal(first.sourcePresent, true);
            assert.equal(first.offsetPastEnd, false);
            assert.equal(typeof first.physicalFileIdentity, 'string');
            assert.equal(first.continuityAtStart?.version, 1);
            assert.equal(first.continuityAtStart?.offset, 0);
            assert.equal(first.continuityAtStart?.windowBytes, 0);
            assert.match(String(first.continuityAtStart?.token), /^[a-f0-9]{64}$/u);
            assert.equal(first.continuityAtNext?.offset, first.nextOffset);
            assert.ok(Number(first.continuityAtNext?.windowBytes) > 0);
            assert.equal(first.sequenceAtStart?.version, 1);
            assert.equal(first.sequenceAtStart?.algorithm, 'sha256-chain');
            assert.match(String(first.sequenceAtStart?.token), /^[a-f0-9]{64}$/u);
            assert.match(String(first.sequenceAtNext?.token), /^[a-f0-9]{64}$/u);
            assert.notEqual(first.sequenceAtNext?.token, first.sequenceAtStart?.token);
            const firstIdentity = first.physicalFileIdentity;
            const firstCheckpoint = first.nextOffset;
            const firstToken = first.continuityAtNext?.token;
            const firstSequenceToken = first.sequenceAtNext?.token;

            await audit.append({ event: 'second', tool: 'repo_status' });
            const appended = await audit.readSlice({
                offset: firstCheckpoint,
                maxBytes: 64 * 1024,
                maxEvents: 100,
                sequenceToken: firstSequenceToken,
            });
            assert.equal(appended.physicalFileIdentity, firstIdentity);
            assert.equal(appended.continuityAtStart?.token, firstToken);
            assert.equal(appended.sequenceAtStart?.token, firstSequenceToken);
            assert.notEqual(appended.sequenceAtNext?.token, firstSequenceToken);
            assert.equal(appended.entries.length, 1);
            assert.equal(appended.entries[0]?.event?.['event'], 'second');
            const prefixProof = await audit.readPrefixProof({ offset: appended.nextOffset });
            assert.equal(prefixProof.ok, true);
            assert.equal(prefixProof.prefixAvailable, true);
            assert.equal(prefixProof.physicalFileIdentity, appended.physicalFileIdentity);
            assert.equal(prefixProof.bytesRead, appended.nextOffset);
            assert.equal(prefixProof.continuityAtOffset?.token, appended.continuityAtNext?.token);
            assert.equal(prefixProof.sequenceAtOffset?.token, appended.sequenceAtNext?.token);

            // Replace the path with a byte-identical copy. dev:ino changes, but the exact checkpoint prefix is the same.
            await copyFile(auditFile, replacement);
            await rename(replacement, auditFile);
            const rebound = await audit.readSlice({
                offset: appended.nextOffset,
                maxBytes: 64 * 1024,
                maxEvents: 100,
                sequenceToken: appended.sequenceAtNext?.token,
            });
            assert.notEqual(rebound.physicalFileIdentity, appended.physicalFileIdentity);
            assert.equal(rebound.continuityAtStart?.token, appended.continuityAtNext?.token);
            assert.equal(rebound.sequenceAtStart?.token, appended.sequenceAtNext?.token);
            assert.equal(rebound.bytesRead, 0);
            assert.equal(rebound.offsetPastEnd, false);
            const reboundProof = await audit.readPrefixProof({ offset: rebound.nextOffset });
            assert.equal(reboundProof.physicalFileIdentity, rebound.physicalFileIdentity);
            assert.equal(reboundProof.continuityAtOffset?.token, appended.continuityAtNext?.token);
            assert.equal(reboundProof.sequenceAtOffset?.token, appended.sequenceAtNext?.token);

            const reboundIdentity = rebound.physicalFileIdentity;
            await truncate(auditFile, 0);
            const truncated = await audit.readSlice({
                offset: rebound.nextOffset,
                maxBytes: 64 * 1024,
                maxEvents: 100,
            });
            assert.equal(truncated.physicalFileIdentity, reboundIdentity);
            assert.equal(truncated.offsetPastEnd, true);
            assert.equal(truncated.bytesRead, 0);
            assert.equal(truncated.entries.length, 0);
            assert.equal(truncated.continuityAtStart, null);
        } finally {
            await audit.flush();
            await rm(dir, { recursive: true, force: true });
        }
    });

    it('distinguishes whole-prefix replacement even when the 4 KiB boundary anchor is unchanged', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'copilot-mcp-audit-prefix-proof-'));
        const auditFile = path.join(dir, 'audit.jsonl');
        const replacement = path.join(dir, 'replacement.jsonl');
        const makeLine = (/** @type {string} */ markerValue, /** @type {number} */ index) =>
            `${JSON.stringify({ event: 'fixture', tool: 'repo_status', marker: markerValue, index, padding: 'x'.repeat(180) })}\n`;
        const originalLines = Array.from({ length: 40 }, (_, index) => makeLine(index === 0 ? 'AAAA' : 'same', index));
        const replacementLines = [...originalLines];
        replacementLines[0] = makeLine('BBBB', 0);
        assert.equal(Buffer.byteLength(replacementLines[0] ?? ''), Buffer.byteLength(originalLines[0] ?? ''));
        await writeFile(auditFile, originalLines.join(''), 'utf8');
        const audit = createMcpAuditCapability(
            readMcpAuditProcessConfig({ COPILOT_MCP_AUDIT_FILE: auditFile, COPILOT_MCP_AUDIT_SYNC: 'true' }),
        );
        try {
            const original = await audit.readSlice({ offset: 0, maxBytes: 64 * 1024, maxEvents: 100 });
            assert.equal(original.ok, true);
            assert.equal(original.complete, true);
            assert.ok(original.nextOffset > 4096);
            const originalProof = await audit.readPrefixProof({ offset: original.nextOffset });
            assert.equal(originalProof.sequenceAtOffset?.token, original.sequenceAtNext?.token);

            await writeFile(replacement, replacementLines.join(''), 'utf8');
            await rename(replacement, auditFile);
            const replacementSlice = await audit.readSlice({
                offset: original.nextOffset,
                maxBytes: 64 * 1024,
                maxEvents: 100,
                sequenceToken: original.sequenceAtNext?.token,
            });
            assert.equal(replacementSlice.ok, true);
            assert.notEqual(replacementSlice.physicalFileIdentity, original.physicalFileIdentity);
            // The mutation is before the last 4 KiB, therefore a boundary-only proof cannot distinguish the files.
            assert.equal(replacementSlice.continuityAtStart?.token, original.continuityAtNext?.token);
            assert.equal(replacementSlice.sequenceAtStart?.token, original.sequenceAtNext?.token);

            const replacementProof = await audit.readPrefixProof({ offset: original.nextOffset });
            assert.equal(replacementProof.ok, true);
            assert.equal(replacementProof.prefixAvailable, true);
            assert.equal(replacementProof.continuityAtOffset?.token, original.continuityAtNext?.token);
            assert.notEqual(replacementProof.sequenceAtOffset?.token, original.sequenceAtNext?.token);
        } finally {
            await audit.flush();
            await rm(dir, { recursive: true, force: true });
        }
    });

    it('stops exactly at maxEvents without skipping later JSONL records', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'copilot-mcp-audit-max-events-'));
        const auditFile = path.join(dir, 'audit.jsonl');
        const audit = createMcpAuditCapability(
            readMcpAuditProcessConfig({ COPILOT_MCP_AUDIT_FILE: auditFile, COPILOT_MCP_AUDIT_SYNC: 'true' }),
        );
        try {
            for (let index = 0; index < 105; index += 1) {
                await audit.append({ event: `event-${String(index)}`, tool: 'repo_status', index });
            }
            const first = await audit.readSlice({ offset: 0, maxBytes: 64 * 1024, maxEvents: 100 });
            assert.equal(first.ok, true);
            assert.equal(first.entries.length, 100);
            assert.equal(first.eventLimitReached, true);
            assert.equal(first.complete, false);
            assert.ok(first.nextOffset < first.fileBytes);
            assert.equal(first.entries[99]?.event?.['index'], 99);

            const second = await audit.readSlice({ offset: first.nextOffset, maxBytes: 64 * 1024, maxEvents: 100 });
            assert.equal(second.ok, true);
            assert.equal(second.entries.length, 5);
            assert.equal(second.entries[0]?.event?.['index'], 100);
            assert.equal(second.entries[4]?.event?.['index'], 104);
            assert.equal(second.eventLimitReached, false);
            assert.equal(second.complete, true);
            assert.equal(second.nextOffset, second.fileBytes);
        } finally {
            await audit.flush();
            await rm(dir, { recursive: true, force: true });
        }
    });

    it('keeps a trailing non-newline JSON fragment pending until the record is committed', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'copilot-mcp-audit-partial-line-'));
        const auditFile = path.join(dir, 'audit.jsonl');
        const firstLine = `${JSON.stringify({ event: 'first', tool: 'repo_status' })}\n`;
        const partial = '{"event":"second"';
        await writeFile(auditFile, firstLine + partial, 'utf8');
        const audit = createMcpAuditCapability(
            readMcpAuditProcessConfig({ COPILOT_MCP_AUDIT_FILE: auditFile, COPILOT_MCP_AUDIT_SYNC: 'true' }),
        );
        try {
            const first = await audit.readSlice({ offset: 0, maxBytes: 64 * 1024, maxEvents: 100 });
            assert.equal(first.ok, true);
            assert.equal(first.entries.length, 1);
            assert.equal(first.entries[0]?.event?.['event'], 'first');
            assert.equal(first.nextOffset, Buffer.byteLength(firstLine));
            assert.equal(first.pendingPartialLineBytes, Buffer.byteLength(partial));
            assert.equal(first.complete, false);
            assert.equal(first.invalidLines, 0);

            await appendFile(auditFile, ',"tool":"repo_status"}\n', 'utf8');
            const second = await audit.readSlice({ offset: first.nextOffset, maxBytes: 64 * 1024, maxEvents: 100 });
            assert.equal(second.ok, true);
            assert.equal(second.entries.length, 1);
            assert.equal(second.entries[0]?.event?.['event'], 'second');
            assert.equal(second.pendingPartialLineBytes, 0);
            assert.equal(second.complete, true);
            assert.equal(second.invalidLines, 0);
        } finally {
            await audit.flush();
            await rm(dir, { recursive: true, force: true });
        }
    });

    it('reports an absent audit source without inventing a cursor reset or logical generation', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'copilot-mcp-audit-absent-'));
        const auditFile = path.join(dir, 'missing.jsonl');
        const audit = createMcpAuditCapability(
            readMcpAuditProcessConfig({ COPILOT_MCP_AUDIT_FILE: auditFile, COPILOT_MCP_AUDIT_SYNC: 'true' }),
        );
        try {
            const slice = await audit.readSlice({ offset: 123, maxBytes: 64 * 1024, maxEvents: 100 });
            assert.equal(slice.ok, true);
            assert.equal(slice.sourcePresent, false);
            assert.equal(slice.physicalFileIdentity, null);
            assert.equal(slice.requestedOffset, 123);
            assert.equal(slice.nextOffset, 123);
            assert.equal(slice.offsetPastEnd, true);
            assert.equal(slice.continuityAtStart, null);
            assert.equal(slice.continuityAtNext, null);
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
                rpcClass: 'subscriptions-listen',
                continuity: 'modern-subscription-open',
                clientId: 'must-never-persist',
                token: 'must-never-persist',
            });
            await audit.recordCompatibility({
                kind: 'oauth-client',
                clientSource: 'cimd',
                hostClass: 'chatgpt',
                actorClass: 'consumer',
                resolution: 'trusted-fallback',
                outcome: 'succeeded',
                redirectUri: 'https://example.invalid/private',
            });
            await audit.recordCompatibility({
                kind: 'oauth-grant',
                grantType: 'refresh_token',
                clientSource: 'cimd',
                hostClass: 'chatgpt',
                actorClass: 'consumer',
                outcome: 'succeeded',
                subject: 'must-never-persist',
            });

            await audit.append({
                event: 'mcp_compat_observation',
                schemaVersion: 1,
                kind: 'protocol-request',
                protocolEra: '2025',
                transportMode: 'stateful',
                rpcClass: 'other',
                continuity: 'stream-resume',
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
            assert.equal(summary.schemaVersion, 2);
            assert.equal(summary.observations, 4);
            assert.equal(summary.protocol.totalRequests, 2);
            assert.equal(summary.protocol.byEra['2026'], 1);
            assert.equal(summary.protocol.byContinuity['modern-subscription-open'], 1);
            assert.equal(summary.protocol.byContinuity['legacy-stream-resume'], 1);
            assert.equal(summary.oauth.clientActivity.bySource.cimd, 1);
            assert.equal(summary.oauth.clientActivity.byHostClass.chatgpt, 1);
            assert.equal(summary.oauth.clientActivity.successfulByHostClass.chatgpt, 1);
            assert.equal(summary.oauth.clientActivity.byOutcome.succeeded, 1);
            assert.equal(summary.oauth.clientActivity.byActorClass.consumer, 1);
            assert.equal(summary.oauth.grants.byGrantType.refresh_token, 1);
            assert.equal(summary.oauth.grants.byOutcome.succeeded, 1);
            assert.equal(summary.oauth.grants.byActorClass.consumer, 1);
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
