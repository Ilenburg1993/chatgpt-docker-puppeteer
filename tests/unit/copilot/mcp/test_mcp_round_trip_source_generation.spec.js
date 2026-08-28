// @ts-check
/** End-to-end source-generation integrity across the physical audit reader and the derived SQLite index. */

import { adaptBetterSqliteDatabase } from '#copilot/infra/public/testing/database/sqlite';
import { createMcpAuditCapability, readMcpAuditProcessConfig } from '#copilot/mcp/public/observability';
import { createMcpRoundTripAnalytics } from '#copilot/testing/mcp/diagnostics/latency/round-trip';
import Database from 'better-sqlite3';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'vitest';

/** @type {import('better-sqlite3').Database[]} */
const databases = [];
/** @type {string[]} */
const tempDirs = [];

afterEach(async () => {
    while (databases.length > 0) databases.pop()?.close();
    while (tempDirs.length > 0) await rm(tempDirs.pop(), { recursive: true, force: true });
});

/** @param {number} tsMs @param {string} tool @param {string} callId @param {number} [padding] */
function auditLine(tsMs, tool, callId, padding = 0) {
    return `${JSON.stringify({
        ts: new Date(tsMs).toISOString(),
        event: 'tool_call_started',
        tool,
        callId,
        ...(padding > 0 ? { ignoredPadding: 'x'.repeat(padding) } : {}),
    })}\n`;
}

describe('MCP round-trip source-generation integrity v11', () => {
    it('rejects a false rebind when only the 4 KiB boundary matches but an older prefix record changed', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'mcp-round-trip-full-prefix-proof-'));
        tempDirs.push(dir);
        const auditPath = path.join(dir, 'audit.jsonl');
        const replacementPath = path.join(dir, 'replacement.jsonl');
        const makeLine = (/** @type {number} */ index, /** @type {string} */ markerValue) =>
            `${JSON.stringify({
                ts: new Date(90_000 + index).toISOString(),
                event: 'tool_call_started',
                tool: 'repo_read_file',
                callId: `call-${String(index)}`,
                ignoredMarker: markerValue,
                ignoredPadding: 'x'.repeat(220),
            })}\n`;
        const originalLines = Array.from({ length: 30 }, (_, index) => makeLine(index, index === 0 ? 'AAAA' : 'same'));
        const replacementLines = [...originalLines];
        replacementLines[0] = makeLine(0, 'BBBB');
        const originalText = originalLines.join('');
        const replacementText = replacementLines.join('');
        assert.equal(Buffer.byteLength(originalText), Buffer.byteLength(replacementText));
        assert.ok(Buffer.byteLength(originalText) > 4096);
        assert.equal(originalText.slice(-4096), replacementText.slice(-4096));
        await writeFile(auditPath, originalText, 'utf8');

        const sqlite = new Database(':memory:');
        databases.push(sqlite);
        const audit = createMcpAuditCapability(
            readMcpAuditProcessConfig({
                COPILOT_MCP_AUDIT_FILE: auditPath,
                COPILOT_MCP_AUDIT_SYNC: 'true',
            }),
        );
        const analytics = createMcpRoundTripAnalytics({
            db: adaptBetterSqliteDatabase(sqlite),
            readSlice: audit.readSlice,
            readPrefixProof: audit.readPrefixProof,
            now: () => 100_000,
            maxChunks: 4,
        });

        const first = await analytics.summarize({ windowMs: 20_000 });
        assert.equal(first.ingestion?.cursor?.generationSequence, 1);
        assert.equal(first.indexedRows, 30);
        const firstIdentity = first.ingestion?.cursor?.physicalFileIdentity;
        const firstOffset = Number(first.ingestion?.cursor?.byteOffset ?? 0);
        assert.ok(firstOffset > 4096);

        await writeFile(replacementPath, replacementText, 'utf8');
        await rename(replacementPath, auditPath);

        const replaced = await analytics.summarize({ windowMs: 20_000 });
        assert.notEqual(replaced.ingestion?.cursor?.physicalFileIdentity, firstIdentity);
        assert.equal(replaced.ingestion?.reset, true);
        assert.equal(replaced.ingestion?.rebound, false);
        assert.equal(replaced.ingestion?.prefixProofsThisSync, 1);
        assert.equal(replaced.ingestion?.prefixProofBytesThisSync, firstOffset);
        assert.equal(replaced.ingestion?.newGenerationsThisSync, 1);
        assert.equal(replaced.ingestion?.cursor?.generationSequence, 2);
        assert.equal(replaced.ingestion?.cursor?.physicalChangeGenerationCount, 1);
        assert.equal(replaced.ingestion?.cursor?.rewriteGenerationCount, 1);
        assert.equal(replaced.indexedRows, 60);
        assert.deepEqual(
            sqlite
                .prepare(
                    'SELECT source_generation, COUNT(*) AS rows FROM copilot_mcp_round_trip_events GROUP BY source_generation ORDER BY source_generation',
                )
                .all(),
            [
                { source_generation: 'mcp-audit:v11:g1', rows: 30 },
                { source_generation: 'mcp-audit:v11:g2', rows: 30 },
            ],
        );
    });

    it('keeps a prefix-equivalent inode rebind in one generation and starts a new generation for divergent replacement', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'mcp-round-trip-source-generation-'));
        tempDirs.push(dir);
        const auditPath = path.join(dir, 'audit.jsonl');
        const replacementPath = path.join(dir, 'replacement.jsonl');
        await writeFile(auditPath, auditLine(90_000, 'repo_read_file', 'a'), 'utf8');

        const sqlite = new Database(':memory:');
        databases.push(sqlite);
        const audit = createMcpAuditCapability(
            readMcpAuditProcessConfig({
                COPILOT_MCP_AUDIT_FILE: auditPath,
                COPILOT_MCP_AUDIT_SYNC: 'true',
            }),
        );
        const analytics = createMcpRoundTripAnalytics({
            db: adaptBetterSqliteDatabase(sqlite),
            readSlice: audit.readSlice,
            readPrefixProof: audit.readPrefixProof,
            now: () => 100_000,
            maxChunks: 4,
        });

        const first = await analytics.summarize({ windowMs: 20_000 });
        assert.equal(first.indexedRows, 1);
        const firstCursor = first.ingestion?.cursor;
        assert.equal(firstCursor?.generationSequence, 1);
        const firstIdentity = firstCursor?.physicalFileIdentity;
        assert.equal(typeof firstIdentity, 'string');

        // A real path replacement changes dev:ino while preserving every certified prefix byte and appending one row.
        await copyFile(auditPath, replacementPath);
        await writeFile(
            replacementPath,
            Buffer.concat([
                await readFile(replacementPath),
                Buffer.from(auditLine(95_000, 'repo_search_text', 'b'), 'utf8'),
            ]),
        );
        await rename(replacementPath, auditPath);

        const rebound = await analytics.summarize({ windowMs: 20_000 });
        assert.equal(rebound.ingestion?.rebound, true);
        assert.equal(rebound.ingestion?.reset, false);
        assert.equal(rebound.ingestion?.newGenerationsThisSync, 0);
        assert.equal(rebound.ingestion?.cursor?.generationSequence, 1);
        assert.equal(rebound.ingestion?.cursor?.rebindCount, 1);
        assert.notEqual(rebound.ingestion?.cursor?.physicalFileIdentity, firstIdentity);
        assert.equal(rebound.indexedRows, 2);
        assert.deepEqual(rebound.toolStarts.map((row) => row.tool).sort(), ['repo_read_file', 'repo_search_text']);
        assert.equal(
            Number(
                sqlite
                    .prepare('SELECT COUNT(DISTINCT source_generation) AS count FROM copilot_mcp_round_trip_events')
                    .get().count,
            ),
            1,
        );

        const cursorOffset = Number(rebound.ingestion?.cursor?.byteOffset ?? 0);
        // Replace the path again with unrelated bytes. Keep it larger than the old cursor so continuity—not size—must
        // decide the generation transition.
        const divergent = auditLine(97_000, 'repo_symbol_search', 'c', cursorOffset + 256);
        assert.ok(Buffer.byteLength(divergent) > cursorOffset);
        await writeFile(replacementPath, divergent, 'utf8');
        await rename(replacementPath, auditPath);

        const replaced = await analytics.summarize({ windowMs: 20_000 });
        assert.equal(replaced.ingestion?.reset, true);
        assert.equal(replaced.ingestion?.newGenerationsThisSync, 1);
        assert.equal(replaced.ingestion?.cursor?.generationSequence, 2);
        assert.equal(replaced.ingestion?.cursor?.physicalChangeGenerationCount, 1);
        assert.equal(replaced.ingestion?.cursor?.rewriteGenerationCount, 1);
        assert.equal(replaced.indexedRows, 3);
        assert.deepEqual(replaced.toolStarts.map((row) => row.tool).sort(), [
            'repo_read_file',
            'repo_search_text',
            'repo_symbol_search',
        ]);
        assert.deepEqual(
            sqlite
                .prepare(
                    'SELECT source_generation, COUNT(*) AS rows FROM copilot_mcp_round_trip_events GROUP BY source_generation ORDER BY source_generation',
                )
                .all(),
            [
                { source_generation: 'mcp-audit:v11:g1', rows: 2 },
                { source_generation: 'mcp-audit:v11:g2', rows: 1 },
            ],
        );
    });
});
