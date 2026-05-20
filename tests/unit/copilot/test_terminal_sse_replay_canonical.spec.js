// @ts-check
/**
 * Contrato: SSE do terminal grava replay global uma única vez por broadcast canônico.
 */

import { describe, expect, it } from 'vitest';
import { getSseClients, getTerminalReplayBuffer } from '../../../src/copilot/infra/sse/state.js';
import {
    readTerminalSseEventArchiveState,
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
    it('usa um único replay eventId para raw clients e fanout /events', async () => {
        resetTerminalSseEventArchiveForTests();
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
            broadcastSse('unit.delta', { content: 'abc' });
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
        expect(archive.path).toContain('terminal-sse-events-');
    });
});
