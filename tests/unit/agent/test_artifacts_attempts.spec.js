// @ts-check
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeEach } from 'node:test';

import { ActionCode, ActorRole, MessageType } from '#shared/nerv/constants';
import { createEnvelope } from '#shared/nerv/envelope';

import { getArtifactById } from '#infra/db/artifact_repo';
import { AUTONOMY_MODES, createMission, MISSION_STATUS, updateMission } from '#infra/db/mission_repo';
import { closeDb, getDb } from '#infra/db/sqlite';
import { getAttemptById } from '#infra/db/task_attempt_repo';
import { insertTask, updateTask } from '#infra/db/task_repo';
import { saveResponse } from '#infra/storage/response_adapter';

import { MissionPlannerProcessor } from '../../../src/agent/mission_planner_processor.js';
import { QueueWorker } from '../../../src/agent/queue_worker.js';
import { TaskStateProjector } from '../../../src/agent/task_state_projector.js';

function makeDbPath() {
    const dir = path.join(process.cwd(), 'tmp', 'test-dbs');
    fs.mkdirSync(dir, { recursive: true });
    const name = `maestro-test-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`;
    return path.join(dir, name);
}

function makeArtifactsDir() {
    const dir = path.join(
        process.cwd(),
        'tmp',
        'test-artifacts',
        `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

class MockNERV {
    constructor() {
        /** @type {any[]} */
        this.receiveHandlers = [];
    }
    onReceive(/** @type {any} */ handler) {
        this.receiveHandlers.push(handler);
        return () => {
            const idx = this.receiveHandlers.indexOf(handler);
            if (idx >= 0) this.receiveHandlers.splice(idx, 1);
        };
    }
    receive(/** @type {any} */ envelope) {
        for (const h of this.receiveHandlers) h(envelope);
    }
}

describe('Artifacts + Attempts (attempt = correlationId)', { concurrency: 1 }, () => {
    const dbPath = makeDbPath();
    const artifactsDir = makeArtifactsDir();

    beforeAll(() => {
        process.env.MAESTRO_DB_PATH = dbPath;
        process.env.MAESTRO_ARTIFACTS_DIR = artifactsDir;
        getDb(); // migrations
    });

    afterAll(() => {
        try {
            closeDb();
        } catch (_) {}
        try {
            fs.rmSync(dbPath, { force: true });
        } catch (_) {}
        try {
            fs.rmSync(artifactsDir, { recursive: true, force: true });
        } catch (_) {}
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

    it('QueueWorker cria attempt + prompt_rendered artifact', async () => {
        const db = getDb();
        const taskId = 'task-attempt-1';

        insertTask({
            meta: { id: taskId, version: '5.0', created_at: new Date().toISOString(), priority: 5, source: 'gui' },
            spec: { target: 'chatgpt', payload: { system_message: 'sys', user_message: 'hello' } },
            policy: { dependencies: [], execute_after: null },
            state: { status: 'PENDING' },
            result: {},
        });

        const kernel = {
            async executeTask() {
                return;
            },
        };

        const worker = new QueueWorker({ kernel, workerId: 'w_test', intervalMs: 999999, maxConcurrentTasks: 1 });
        await worker.tick();

        /** @type {any} */
        const taskRow = db
            .prepare('SELECT latest_attempt_id, latest_rendered_prompt_artifact_id FROM tasks WHERE id = ?')
            .get(taskId);
        assert.ok(taskRow.latest_attempt_id, 'latest_attempt_id deve ser preenchido');
        assert.ok(taskRow.latest_rendered_prompt_artifact_id, 'latest_rendered_prompt_artifact_id deve ser preenchido');

        const attempt = getAttemptById(taskRow.latest_attempt_id);
        assert.ok(attempt, 'attempt deve existir');
        assert.strictEqual(attempt.task_id, taskId);
        assert.ok(attempt.rendered_prompt_artifact_id, 'attempt deve referenciar rendered_prompt_artifact_id');

        const art = getArtifactById(attempt.rendered_prompt_artifact_id);
        assert.ok(art && art.storage_uri, 'artifact deve existir e ter storage_uri');

        const content = fs.readFileSync(art.storage_uri, 'utf8');
        assert.ok(content.includes('SYSTEM:'), 'prompt renderizado deve conter SYSTEM');
        assert.ok(content.includes('USER:'), 'prompt renderizado deve conter USER');
        assert.ok(content.includes('hello'), 'prompt renderizado deve conter user_message');
    });

    it('Response store salva respostas attempt-scoped (não sobrescreve)', async () => {
        const taskId = 'task-resp-1';
        const baseTask = { result: {} };

        /** @type {any} */
        const r1 = await saveResponse(taskId, 'first', baseTask, 'att1');
        /** @type {any} */
        const r2 = await saveResponse(taskId, 'second', baseTask, 'att2');

        assert.ok(r1.storage?.textFile?.includes(`${path.sep}${taskId}${path.sep}att1.txt`));
        assert.ok(r2.storage?.textFile?.includes(`${path.sep}${taskId}${path.sep}att2.txt`));
        assert.ok(fs.existsSync(r1.storage.textFile));
        assert.ok(fs.existsSync(r2.storage.textFile));

        const t1 = fs.readFileSync(r1.storage.textFile, 'utf8');
        const t2 = fs.readFileSync(r2.storage.textFile, 'utf8');
        assert.strictEqual(t1, 'first');
        assert.strictEqual(t2, 'second');
    });

    it('Projector fecha attempt e registra response artifacts no COMPLETED', async () => {
        const db = getDb();
        const nerv = new MockNERV();
        const projector = new TaskStateProjector({ nerv, workerId: 'w1' });
        projector.start();

        const taskId = 'task-proj-2';
        insertTask({
            meta: { id: taskId, version: '5.0', created_at: new Date().toISOString(), priority: 5, source: 'gui' },
            spec: { target: 'chatgpt', payload: { system_message: '', user_message: 'hello' } },
            policy: { dependencies: [], execute_after: null },
            state: { status: 'PENDING' },
            result: {},
        });

        const attemptId = 'attempt-proj-2';

        // Create response files for this attempt via adapter/store.
        const tmpTask = { result: {} };
        /** @type {any} */
        const persisted = await saveResponse(taskId, 'ok', tmpTask, attemptId);

        const storage = {
            text_file: persisted.storage.textFile,
            markdown_file: persisted.storage.markdownFile,
            json_file: persisted.storage.jsonFile,
            html_file: persisted.storage.htmlFile,
        };

        const completed = createEnvelope({
            actor: ActorRole.DRIVER,
            messageType: MessageType.EVENT,
            actionCode: ActionCode.DRIVER_TASK_COMPLETED,
            payload: { taskId, result: 'ok', storage },
            correlationId: attemptId,
            target: null,
        });

        nerv.receive(completed);

        /** @type {any} */
        const a = db.prepare('SELECT status, response_text_artifact_id FROM task_attempts WHERE id = ?').get(attemptId);
        assert.strictEqual(a.status, 'DONE');
        assert.ok(a.response_text_artifact_id, 'attempt deve ter response_text_artifact_id');

        /** @type {any} */
        const t = db.prepare('SELECT latest_attempt_id, status FROM tasks WHERE id = ?').get(taskId);
        assert.strictEqual(t.latest_attempt_id, attemptId);
        assert.strictEqual(t.status, 'DONE');

        projector.stop();
    });

    it('MissionPlannerProcessor lê resposta via result_json.storage e cria proposals', async () => {
        const db = getDb();
        /** @type {any} */
        const mission = createMission({
            title: 'm1',
            autonomy_mode: AUTONOMY_MODES.LLM_SUGGEST,
            policy: { allowed_targets: ['auto', 'chatgpt'], max_tasks_total: 10 },
            context: { workflow: null },
        });
        updateMission(mission.id, { status: MISSION_STATUS.RUNNING, started_at_ms: Date.now() });

        const plannerTaskId = 'task-planner-1';
        insertTask(
            {
                meta: {
                    id: plannerTaskId,
                    version: '5.0',
                    created_at: new Date().toISOString(),
                    priority: 9,
                    source: 'self_generated',
                    mission_id: mission.id,
                    tags: ['mission_planner'],
                },
                spec: { target: 'chatgpt', payload: { system_message: '', user_message: 'planner' } },
                policy: { dependencies: [], execute_after: null },
                state: { status: 'DONE' },
                result: {},
            },
            { stage: 'ARCHIVED', status: 'DONE', actor: 'system' },
        );

        const attemptId = 'att-planner-1';
        const responseText = JSON.stringify({
            proposals: [
                {
                    title: 't1',
                    user_message: 'do x',
                    target: 'auto',
                    priority: 3,
                    depends_on: [],
                    tags: ['capitulo-1'],
                },
            ],
            needs_user_input: false,
            questions: [],
            stop_reason: null,
        });
        const tmpTask = { result: {} };
        /** @type {any} */
        const persisted = await saveResponse(plannerTaskId, responseText, tmpTask, attemptId);
        const storage = {
            text_file: persisted.storage.textFile,
            markdown_file: persisted.storage.markdownFile,
            json_file: persisted.storage.jsonFile,
            html_file: persisted.storage.htmlFile,
        };

        updateTask(plannerTaskId, {
            result_json: { storage, preview_text: responseText.slice(0, 200), output_length: responseText.length },
            latest_attempt_id: attemptId,
        });

        const proc = new MissionPlannerProcessor({ intervalMs: 999999 });
        await proc.tick();

        const count =
            /** @type {any} */ (db.prepare('SELECT COUNT(1) AS c FROM tasks WHERE mission_id = ?').get(mission.id))
                ?.c || 0;
        assert.ok(count >= 2, 'deve criar pelo menos uma nova task proposal na missão');

        const rows = db
            .prepare('SELECT stage, status FROM tasks WHERE mission_id = ? AND id != ?')
            .all(mission.id, plannerTaskId);
        assert.ok(
            rows.some((/** @type {any} */ r) => r.stage === 'PROPOSED'),
            'em LLM_SUGGEST, proposals devem entrar como PROPOSED',
        );
    });
});
