import assert from 'node:assert';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import { io as ioClient } from 'socket.io-client';
import express from 'express';

import { ActionCode, ActorRole, MessageType } from '#shared/nerv/constants';
import { createEnvelope } from '#shared/nerv/envelope';

import * as socketHub from '#server/engine/socket';
import taskSyncBridge from '#server/dashboard-api/task_sync_bridge';
import telemetryAggregator from '#server/dashboard-api/telemetry_aggregator';

function waitForEvent(socket, eventName, timeoutMs = 1500) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error(`Timeout waiting for ${eventName}`));
        }, timeoutMs);

        socket.once(eventName, (data) => {
            clearTimeout(timeout);
            resolve(data);
        });
    });
}

function createMockNerv() {
    /** @type {Set<Function>} */
    const handlers = new Set();

    return {
        onReceive(handler) {
            handlers.add(handler);
            return () => handlers.delete(handler);
        },
        receive(envelope) {
            handlers.forEach(h => h(envelope));
        }
    };
}

describe('Dashboard realtime contract (Socket.io)', () => {
    /** @type {import('http').Server|null} */
    let httpServer = null;
    /** @type {number|null} */
    let port = null;
    /** @type {ReturnType<typeof ioClient>|null} */
    let client = null;

    before(async () => {
        const app = express();
        httpServer = http.createServer(app);

        await new Promise((resolve) => {
            httpServer.listen(0, '127.0.0.1', () => resolve());
        });

        // @ts-ignore
        port = httpServer.address().port;
        assert.ok(port, 'server should bind an ephemeral port');

        socketHub.init(httpServer);

        client = ioClient(`http://localhost:${port}`, {
            transports: ['websocket']
        });

        await waitForEvent(client, 'connect', 1500);

        const nerv = createMockNerv();

        taskSyncBridge.initialize({
            force: true,
            socketHub,
            nervClient: nerv
        });

        // Seed a first event so the bridge+hub pipeline is exercised at least once.
        const envelope = createEnvelope({
            actor: ActorRole.DRIVER,
            target: null,
            messageType: MessageType.EVENT,
            actionCode: ActionCode.DRIVER_TASK_STARTED,
            payload: { taskId: 'task-seed', target: 'chatgpt' },
            correlationId: 'corr-seed'
        });

        nerv.receive(envelope);
        await waitForEvent(client, 'task:updates_batch', 2000);
    });

    after(async () => {
        try {
            telemetryAggregator.stop();
        } catch {}

        try {
            taskSyncBridge.clearAll();
        } catch {}

        try {
            if (client) {
                client.disconnect();
                client = null;
            }
        } catch {}

        try {
            await socketHub.stop();
        } catch {}

        try {
            if (httpServer) {
                await new Promise((resolve) => httpServer.close(() => resolve()));
                httpServer = null;
            }
        } catch {}
    });

    it('emits task:updates_batch with {taskId,state} entries', async () => {
        const nerv = createMockNerv();

        taskSyncBridge.initialize({
            force: true,
            socketHub,
            nervClient: nerv
        });

        const envelope = createEnvelope({
            actor: ActorRole.DRIVER,
            target: null,
            messageType: MessageType.EVENT,
            actionCode: ActionCode.DRIVER_TASK_STARTED,
            payload: { taskId: 'task-1', target: 'chatgpt' },
            correlationId: 'corr-1'
        });

        nerv.receive(envelope);

        const batch = await waitForEvent(client, 'task:updates_batch', 2000);

        assert.ok(batch, 'batch payload should exist');
        assert.ok(Array.isArray(batch.updates), 'updates should be an array');
        assert.strictEqual(batch.count, batch.updates.length, 'count must equal updates.length');

        const first = batch.updates[0];
        assert.strictEqual(first.taskId, 'task-1');
        assert.ok(first.state);
        assert.strictEqual(first.state.status, 'RUNNING');
    });

    it('emits telemetry:metrics after TelemetryAggregator.start()', async () => {
        assert.ok(httpServer, 'server must be initialized');
        assert.ok(port, 'port must be initialized');
        assert.ok(client, 'client must be initialized');

        telemetryAggregator.start({ socketHub, intervalMs: 50 });

        const metrics = await waitForEvent(client, 'telemetry:metrics', 2000);

        assert.ok(metrics);
        assert.strictEqual(typeof metrics.timestamp, 'number');
        assert.ok(metrics.cpu);
        assert.ok(metrics.memory);
        assert.ok(metrics.heap);
        assert.ok(metrics.queue);
    });
});
