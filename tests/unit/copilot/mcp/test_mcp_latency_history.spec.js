// @ts-check

import { createConfiguredFsGrant, createConfiguredFsIo } from '#copilot/infra/public/composition/filesystem/configured';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'vitest';

import { createMcpLatencyHistoryRuntime } from '#copilot/testing/mcp/diagnostics/latency';

describe('MCP latency history persistence', () => {
    it('serializes concurrent append/trim cycles through one bound configured store', async () => {
        const id = randomUUID();
        const filePath = path.join(process.cwd(), 'src/copilot/.ai/mcp', `latency-history-test-${id}.jsonl`);
        const io = createConfiguredFsIo(
            createConfiguredFsGrant({
                id: `test.mcp.latency-history.${id}`,
                exactPaths: [filePath],
                operations: ['append', 'read', 'write'],
                symlinkPolicy: 'deny',
                durability: ['file-and-directory'],
            }),
        );
        const runtime = createMcpLatencyHistoryRuntime({ filePath, io });
        try {
            const writes = await Promise.all(
                Array.from({ length: 20 }, (_, index) =>
                    runtime.appendSnapshot(
                        {
                            timestamp: `2026-06-12T00:00:${String(index).padStart(2, '0')}.000Z`,
                            status: `sample-${index}`,
                            summary: { totalCalls: index },
                        },
                        { maxSnapshots: 7 },
                    ),
                ),
            );

            assert.ok(writes.every((result) => result.persisted));
            assert.ok(writes.every((result) => !result.persisted || result.retainedSnapshots <= 7));

            const history = await runtime.readHistory({ limit: 20 });
            assert.equal(history.ok, true);
            assert.equal(history.entries.length, 7);
            assert.equal(new Set(history.entries.map((entry) => entry.snapshot.status)).size, 7);

            const siblingNames = await readdir(path.dirname(filePath));
            assert.equal(
                siblingNames.some((name) => name.startsWith(`${path.basename(filePath)}.`) && name.endsWith('.tmp')),
                false,
            );
        } finally {
            await rm(filePath, { force: true });
        }
    });
});
