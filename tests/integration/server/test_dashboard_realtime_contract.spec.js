import assert from 'node:assert';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import { io as ioClient } from 'socket.io-client';
import express from 'express';
import jwt from 'jsonwebtoken';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

import * as socketHub from '#server/engine/socket';
import telemetryAggregator from '#server/dashboard-api/telemetry_aggregator';
import * as ssotEventFeed from '#server/realtime/ssot_event_feed';
import * as schemas from '#core/schemas';
import { insertTask } from '#infra/db/task_repo';
import { recordEvent } from '#infra/db/events_repo';
import { closeDb } from '#infra/db/sqlite';

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

describe('Dashboard realtime contract (Socket.io)', () => {
    /** @type {import('http').Server|null} */
    let httpServer = null;
    /** @type {number|null} */
    let port = null;
    /** @type {ReturnType<typeof ioClient>|null} */
    let client = null;
    /** @type {string|null} */
    let dbPath = null;

    before(async () => {
        process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_dashboard_realtime_contract_jwt_secret_123456789';
        process.env.DASHBOARD_SOCKET_AUTH_REQUIRED = 'true';

        dbPath = path.join(os.tmpdir(), `maestro-test-dashboard-realtime-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`);
        process.env.MAESTRO_DB_PATH = dbPath;
        try {
            fs.rmSync(dbPath, { force: true });
        } catch {}

        const app = express();
        httpServer = http.createServer(app);

        await new Promise((resolve) => {
            httpServer.listen(0, '127.0.0.1', () => resolve());
        });

        // @ts-ignore
        port = httpServer.address().port;
        assert.ok(port, 'server should bind an ephemeral port');

        socketHub.init(httpServer);

        const token = jwt.sign(
            {
                id: 'test-dashboard',
                username: 'test-dashboard',
                role: 'admin',
                jti: `jti-${Date.now()}`,
            },
            process.env.JWT_SECRET,
            { algorithm: 'HS256', expiresIn: '1h' }
        );

        client = ioClient(`http://localhost:${port}`, {
            transports: ['websocket'],
            auth: { token },
            extraHeaders: { origin: 'http://localhost:3008' },
        });

        await waitForEvent(client, 'connect', 15000);

        ssotEventFeed.start({ socketHub, intervalMs: 50, batchLimit: 500 });

        // Seed a first DB event so the feed+hub pipeline is exercised at least once.
        const nowIso = new Date().toISOString();
        const seedTask = schemas.core.TaskSchemaV5.parse({
            meta: { id: 'task-seed', version: '5.0', created_at: nowIso, priority: 5, source: 'api', tags: [] },
            spec: { target: 'chatgpt', payload: { system_message: '', user_message: 'seed' } },
            policy: {},
            state: { status: 'PENDING' },
            result: {},
        });
        insertTask(seedTask, { stage: 'READY', status: 'PENDING', actor: 'system', ifNotExists: true });
        recordEvent({ entityType: 'task', entityId: 'task-seed', eventType: 'TASK_SEEDED', payload: { id: 'task-seed' } });

        await waitForEvent(client, 'task:updates_batch', 8000);
    });

    after(async () => {
        try {
            telemetryAggregator.stop();
        } catch {}

        try {
            ssotEventFeed.stop();
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
            closeDb();
        } catch {}

        try {
            if (dbPath) {
                fs.rmSync(dbPath, { force: true });
            }
        } catch {}

        try {
            if (httpServer) {
                await new Promise((resolve) => httpServer.close(() => resolve()));
                httpServer = null;
            }
        } catch {}
    });

    it('emits task:updates_batch with {taskId,task} entries (SSOT feed)', async () => {
        const nowIso = new Date().toISOString();
        const task = schemas.core.TaskSchemaV5.parse({
            meta: { id: 'task-1', version: '5.0', created_at: nowIso, priority: 5, source: 'api', tags: [] },
            spec: { target: 'chatgpt', payload: { system_message: '', user_message: 'hello' } },
            policy: {},
            state: { status: 'PENDING' },
            result: {},
        });
        insertTask(task, { stage: 'READY', status: 'PENDING', actor: 'system', ifNotExists: true });
        recordEvent({ entityType: 'task', entityId: 'task-1', eventType: 'TASK_UPDATED', payload: { id: 'task-1' } });

        const batch = await waitForEvent(client, 'task:updates_batch', 2000);

        assert.ok(batch, 'batch payload should exist');
        assert.ok(Array.isArray(batch.updates), 'updates should be an array');
        assert.strictEqual(batch.count, batch.updates.length, 'count must equal updates.length');

        const first = batch.updates[0];
        assert.strictEqual(first.taskId, 'task-1');
        assert.ok(first.task);
        assert.strictEqual(first.task.id, 'task-1');
        assert.strictEqual(first.task.unified_status, 'PENDING');
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
