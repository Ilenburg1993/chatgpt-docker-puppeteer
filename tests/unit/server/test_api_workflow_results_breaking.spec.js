// @ts-check
// @ts-nocheck
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';

import dashboardController from '#server/api/controllers/dashboard';
import tasksController from '#server/api/controllers/tasks';
import resultsController from '#server/api/controllers/results';
import * as schemas from '#core/schemas';
import { getDb, closeDb } from '#infra/db/sqlite';
import { insertTask, updateTask } from '#infra/db/task_repo';

function makeTmpDir(name) {
    const dir = path.join(process.cwd(), 'tmp', name);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function makeDbPath() {
    const dir = makeTmpDir('test-dbs');
    return path.join(dir, `maestro-test-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`);
}

function makeArtifactsDir() {
    const dir = path.join(
        makeTmpDir('test-artifacts'),
        `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
    );
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

describe('Server API - workflow empty + results controller + breaking /api/tasks/:id', { concurrency: 1 }, () => {
    const dbPath = makeDbPath();
    const artifactsDir = makeArtifactsDir();

    before(() => {
        process.env.MAESTRO_DB_PATH = dbPath;
        process.env.MAESTRO_ARTIFACTS_DIR = artifactsDir;
        getDb(); // migrations
    });

    after(() => {
        try {
            closeDb();
        } catch {}
        try {
            fs.rmSync(dbPath, { force: true });
        } catch {}
        try {
            fs.rmSync(artifactsDir, { recursive: true, force: true });
        } catch {}
    });

    beforeEach(() => {
        const db = getDb();
        db.exec(`
            DELETE FROM task_dependencies;
            DELETE FROM events;
            DELETE FROM task_attempts;
            DELETE FROM artifacts;
            DELETE FROM tasks;
            DELETE FROM missions;
        `);
    });

    it('GET /api/dashboard/workflows/:workflow_id returns empty payload when no tasks', async () => {
        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => {
            req.id = 'test';
            next();
        });
        app.use('/api/dashboard', dashboardController);

        const res = await request(app).get('/api/dashboard/workflows/wf-empty').expect(200);

        assert.strictEqual(res.body.success, true);
        assert.strictEqual(res.body.data.workflow_id, 'wf-empty');
        assert.ok(Array.isArray(res.body.data.tasks));
        assert.ok(Array.isArray(res.body.data.edges));
        assert.strictEqual(res.body.data.tasks.length, 0);
        assert.strictEqual(res.body.data.edges.length, 0);
    });

    it('breaking: GET /api/tasks/:id returns JSON (not results) and /api/tasks/results redirects', async () => {
        const nowIso = new Date().toISOString();
        const task = schemas.core.TaskSchemaV5.parse({
            meta: { id: 'task-json-1', version: '5.0', created_at: nowIso, priority: 5, source: 'api', tags: [] },
            spec: { target: 'chatgpt', payload: { system_message: '', user_message: 'hello' } },
            policy: {},
            state: { status: 'PENDING' },
            result: {},
        });
        insertTask(task, { stage: 'READY', status: 'PENDING', actor: 'system' });

        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => {
            req.id = 'test';
            next();
        });
        app.use('/api/tasks', tasksController);
        app.use('/api/results', resultsController);

        const got = await request(app).get('/api/tasks/task-json-1').expect(200);
        assert.strictEqual(got.body.success, true);
        assert.strictEqual(got.body.data.task.meta.id, 'task-json-1');

        const redir = await request(app).get('/api/tasks/results/task-json-1').expect(302);
        assert.ok(String(redir.headers.location || '').startsWith('/api/results/task-json-1'));
    });

    it('updateTask(dependencies) keeps task_json.policy.dependencies mirrored to task_dependencies table', () => {
        const nowIso = new Date().toISOString();
        const parent = schemas.core.TaskSchemaV5.parse({
            meta: { id: 'task-parent', version: '5.0', created_at: nowIso, priority: 5, source: 'api', tags: [] },
            spec: { target: 'chatgpt', payload: { system_message: '', user_message: 'parent' } },
            policy: {},
            state: { status: 'DONE' },
            result: {},
        });
        const child = schemas.core.TaskSchemaV5.parse({
            meta: { id: 'task-child', version: '5.0', created_at: nowIso, priority: 5, source: 'api', tags: [] },
            spec: { target: 'chatgpt', payload: { system_message: '', user_message: 'child' } },
            policy: {},
            state: { status: 'PENDING' },
            result: {},
        });
        insertTask(parent, { stage: 'ARCHIVED', status: 'DONE', actor: 'system' });
        insertTask(child, { stage: 'READY', status: 'PENDING', actor: 'system' });

        const updated = updateTask('task-child', { dependencies: ['task-parent'] });
        assert.ok(updated);
        assert.deepStrictEqual(updated.policy.dependencies, ['task-parent']);

        const db = getDb();
        const rows = db.prepare('SELECT depends_on_task_id FROM task_dependencies WHERE task_id = ?').all('task-child');
        assert.deepStrictEqual(
            rows.map(r => r.depends_on_task_id),
            ['task-parent']
        );
    });
});
