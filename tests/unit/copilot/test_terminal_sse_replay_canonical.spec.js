// @ts-check
/**
 * Contrato: SSE do terminal grava replay global uma única vez por broadcast canônico.
 */

import { getSseClients, getTerminalReplayBuffer } from '#copilot/presentation/realtime';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    flushTerminalSseEventArchive,
    readTerminalSseEventArchiveState,
    readTerminalSseEventArchiveTail,
    recordTerminalSseEventArchive,
    resetTerminalSseEventArchiveForTests,
} from '../../../src/copilot/terminal/state/index.js';

/**
 * @returns {Promise<void>}
 */
function nextImmediate() {
    return new Promise((resolve) => setImmediate(resolve));
}

/**
 * @param {string[]} writes
 * @returns {import('node:http').ServerResponse}
 */
function createRawClient(writes) {
    return /** @type {import('node:http').ServerResponse} */ ({
        write(chunk) {
            writes.push(String(chunk));
            return true;
        },
    });
}

describe('terminal SSE replay canonical', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('usa um único replay eventId para raw clients e fanout /events', async () => {
        const previousArchiveDir = process.env['TERMINAL_SSE_EVENT_ARCHIVE_DIR'];
        const archiveDir = await mkdtemp(join(tmpdir(), 'copilot-terminal-sse-archive-'));
        process.env['TERMINAL_SSE_EVENT_ARCHIVE_DIR'] = archiveDir;
        resetTerminalSseEventArchiveForTests();
        try {
            await import('../../../src/copilot/server/routes/sse.js');
            const { broadcastSse } = await import('../../../src/copilot/terminal/dialog/sse.js');

            const clients = getSseClients();
            const writes = /** @type {string[]} */ ([]);
            const clientA = createRawClient(writes);
            const clientB = createRawClient(writes);
            const before = getTerminalReplayBuffer().lastId;

            clients.add(clientA);
            clients.add(clientB);
            try {
                broadcastSse('unit.delta', {
                    content: 'abc',
                    requestId: 'req-unit',
                    toolCallId: 'call_unit',
                });
                await nextImmediate();
            } finally {
                clients.delete(clientA);
                clients.delete(clientB);
            }

            const eventId = before + 1;
            expect(getTerminalReplayBuffer().lastId).toBe(eventId);
            expect(writes).toHaveLength(2);
            expect(writes.every((payload) => payload.startsWith(`id: ${eventId}\n`))).toBe(true);
            expect(writes.join('\n')).not.toContain('__terminalSseEventId');

            const archive = readTerminalSseEventArchiveState();
            expect(archive.events).toBe(1);
            expect(archive.lastEventId).toBe(eventId);
            expect(archive.path).toContain(archiveDir);

            const tail = await readTerminalSseEventArchiveTail({ limit: 5, event: 'unit.delta' });
            expect(tail.entries).toHaveLength(1);
            expect(tail.tailRead).toMatchObject({
                bytesRead: expect.any(Number),
                maxBytes: expect.any(Number),
                truncatedByByteLimit: false,
            });
            expect(tail.entries[0]).toMatchObject({
                event: 'unit.delta',
                eventId,
                payload: {
                    content: 'abc',
                    requestId: 'req-unit',
                    toolCallId: 'call_unit',
                },
            });

            recordTerminalSseEventArchive({
                event: 'unit.tool',
                eventId: eventId + 1,
                data: {
                    hubSessionId: 'hub-unit',
                    requestId: 'req-unit',
                    toolCallId: 'call_unit',
                },
            });
            const byTool = await readTerminalSseEventArchiveTail({
                event: 'unit.tool',
                hubSessionId: 'hub-unit',
                requestId: 'req-unit',
                toolCallId: 'call_unit',
            });
            expect(byTool.entries).toHaveLength(1);
            expect(byTool.entries[0]?.eventId).toBe(eventId + 1);

            const secret = 'sk-supersecret1234567890';
            recordTerminalSseEventArchive({
                event: 'unit.secret',
                eventId: eventId + 2,
                data: {
                    source: 'unit',
                    requestId: 'req-secret',
                    detail: `api_key=${secret}`,
                    headers: { authorization: `Bearer ${secret}` },
                    nested: { token: secret },
                },
            });
            const secretTail = await readTerminalSseEventArchiveTail({ event: 'unit.secret', limit: 1 });
            const serializedTail = JSON.stringify(secretTail.entries);
            const rawArchive = await readFile(String(readTerminalSseEventArchiveState().path), 'utf8');

            expect(secretTail.entries).toHaveLength(1);
            expect(serializedTail).not.toContain(secret);
            expect(rawArchive).not.toContain(secret);
            expect(serializedTail).toContain('api_key=[redacted]');
            expect(rawArchive).toContain('api_key=[redacted]');

            const secretWrites = /** @type {string[]} */ ([]);
            const secretClient = createRawClient(secretWrites);
            const beforeSecretBroadcast = getTerminalReplayBuffer().lastId;
            clients.add(secretClient);
            try {
                broadcastSse('unit.secret.broadcast', {
                    detail: `api_key=${secret}`,
                    headers: { authorization: `Bearer ${secret}` },
                });
                await nextImmediate();
            } finally {
                clients.delete(secretClient);
            }

            const replayPayload = JSON.stringify(getTerminalReplayBuffer().getAfter(beforeSecretBroadcast));
            const rawSsePayload = secretWrites.join('\n');

            expect(getTerminalReplayBuffer().lastId).toBe(beforeSecretBroadcast + 1);
            expect(rawSsePayload).not.toContain(secret);
            expect(replayPayload).not.toContain(secret);
            expect(rawSsePayload).toContain('api_key=[redacted]');
            expect(replayPayload).toContain('api_key=[redacted]');
        } finally {
            resetTerminalSseEventArchiveForTests();
            if (previousArchiveDir === undefined) {
                delete process.env['TERMINAL_SSE_EVENT_ARCHIVE_DIR'];
            } else {
                process.env['TERMINAL_SSE_EVENT_ARCHIVE_DIR'] = previousArchiveDir;
            }
            await rm(archiveDir, { force: true, recursive: true });
        }
    });

    it('rotaciona o arquivo diário quando o processo atravessa meia-noite', async () => {
        const previousArchiveDir = process.env['TERMINAL_SSE_EVENT_ARCHIVE_DIR'];
        const archiveDir = await mkdtemp(join(tmpdir(), 'copilot-terminal-sse-daily-'));
        process.env['TERMINAL_SSE_EVENT_ARCHIVE_DIR'] = archiveDir;
        resetTerminalSseEventArchiveForTests();
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date('2026-06-11T23:59:59.000Z'));
            recordTerminalSseEventArchive({ event: 'day.one', eventId: 1, data: {} });
            await flushTerminalSseEventArchive();

            vi.setSystemTime(new Date('2026-06-12T00:00:01.000Z'));
            recordTerminalSseEventArchive({ event: 'day.two', eventId: 2, data: {} });
            await flushTerminalSseEventArchive();

            expect((await readdir(archiveDir)).sort()).toEqual([
                'terminal-sse-events-2026-06-11.jsonl',
                'terminal-sse-events-2026-06-12.jsonl',
            ]);
        } finally {
            resetTerminalSseEventArchiveForTests();
            vi.useRealTimers();
            if (previousArchiveDir === undefined) delete process.env['TERMINAL_SSE_EVENT_ARCHIVE_DIR'];
            else process.env['TERMINAL_SSE_EVENT_ARCHIVE_DIR'] = previousArchiveDir;
            await rm(archiveDir, { force: true, recursive: true });
        }
    });
});
