// @ts-check

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'vitest';

import { appendMcpLatencyDashboardSnapshot, readMcpLatencyDashboardHistory } from '#copilot/mcp/control-plane';

describe('MCP latency history persistence', () => {
    it('serializes concurrent append/trim cycles without losing the retained tail', async () => {
        const id = randomUUID();
        const filePath = path.join(process.cwd(), 'src/copilot/.ai/mcp', `latency-history-test-${id}.jsonl`);
        try {
            const writes = await Promise.all(
                Array.from({ length: 20 }, (_, index) =>
                    appendMcpLatencyDashboardSnapshot(
                        {
                            timestamp: `2026-06-12T00:00:${String(index).padStart(2, '0')}.000Z`,
                            status: `sample-${index}`,
                            summary: { totalCalls: index },
                        },
                        { filePath, maxSnapshots: 7 },
                    ),
                ),
            );

            assert.ok(writes.every((result) => result.persisted));
            assert.ok(writes.every((result) => !result.persisted || result.retainedSnapshots <= 7));

            const history = await readMcpLatencyDashboardHistory({ filePath, limit: 20 });
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
