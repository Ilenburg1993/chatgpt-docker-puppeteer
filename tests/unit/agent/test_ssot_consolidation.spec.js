// @ts-check
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import { ActionCode, ActorRole, MessageType } from '#shared/nerv/constants';
import { createEnvelope } from '#shared/nerv/envelope';

import { shutdown as shutdownDriverFactory } from '#driver/factory';
import { closeDb, getDb } from '#infra/db/sqlite';
import { insertTask } from '#infra/db/task_repo';
import { AttemptWatchdog } from '../../../src/agent/attempt_watchdog.js';
import { QueueWorker } from '../../../src/agent/queue_worker.js';
import { TaskControlWatcher } from '../../../src/agent/task_control_watcher.js';
import { TaskStateProjector } from '../../../src/agent/task_state_projector.js';
import { DriverNERVAdapter } from '../../../src/driver/nerv_adapter/driver_nerv_adapter.js';

/**
 * Poll simples para testes `node:test` sem depender de helpers do Vitest.
 *
 * @param {() => void} assertion
 * @param {{ timeoutMs?: number; intervalMs?: number }} [opts]
 * @returns {Promise<void>}
 */
async function waitForAssertion(assertion, opts = {}) {
    const timeoutMs = opts.timeoutMs ?? 2000;
    const intervalMs = opts.intervalMs ?? 10;
    const deadline = Date.now() + timeoutMs;
    /** @type {unknown} */
    let lastError = null;

    while (Date.now() < deadline) {
        try {
            assertion();
            return;
        } catch (error) {
            lastError = error;
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    if (lastError instanceof Error) throw lastError;
    throw new Error('waitForAssertion timeout');
}

function makeDbPath() {
    const dir = path.join(process.cwd(), 'tmp', 'test-dbs');
    fs.mkdirSync(dir, { recursive: true });
    const name = `maestro-test-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`;
    return path.join(dir, name);
}

class MockNERV {
    constructor() {
        /** @type {any[]} */ this.emittedCommands = [];
        /** @type {any[]} */ this.emittedEvents = [];
        /** @type {any[]} */ this.receiveHandlers = [];
    }
    onReceive(/** @type {any} */ handler) {
        this.receiveHandlers.push(handler);
        return () => {
            const idx = this.receiveHandlers.indexOf(handler);
            if (idx >= 0) this.receiveHandlers.splice(idx, 1);
        };
    }
    emitCommand(/** @type {any} */ envelope) {
        this.emittedCommands.push(envelope);
    }
    emitEvent(/** @type {any} */ envelope) {
        this.emittedEvents.push(envelope);
    }
    receive(/** @type {any} */ envelope) {
        for (const h of this.receiveHandlers) h(envelope);
    }
}

describe('SSOT Consolidation (DB retry + msg_id idempotency + re-control)', { concurrency: 1 }, () => {
    const dbPath = makeDbPath();

    before(() => {
        process.env.MAESTRO_DB_PATH = dbPath;
        getDb(); // migrations
    });

    after(() => {
        try {
            closeDb();
        } catch (_) {}
        try {
            fs.rmSync(dbPath, { force: true });
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

    it('TaskStateProjector deduplica por msg_id (não reaplica projeção)', () => {
        const db = getDb();
        const taskId = 'task-proj-1';
        insertTask({
            meta: {
                id: taskId,
                version: '5.0',
                created_at: new Date().toISOString(),
                priority: 5,
                source: 'gui',
            },
            spec: {
                target: 'chatgpt',
                payload: { system_message: '', user_message: 'hello' },
            },
            policy: { dependencies: [], execute_after: null },
            state: { status: 'PENDING' },
            result: {},
        });

        const nerv = new MockNERV();
        const projector = new TaskStateProjector({ nerv, workerId: 'w1' });
        projector.start();

        const envelope = createEnvelope({
            actor: ActorRole.DRIVER,
            messageType: MessageType.EVENT,
            actionCode: ActionCode.DRIVER_TASK_STARTED,
            payload: { taskId },
            correlationId: 'corr-proj-1',
            target: null,
        });

        nerv.receive(envelope);
        nerv.receive(envelope); // same envelope (same msg_id)

        /** @type {any} */ const row = db.prepare('SELECT attempts, status FROM tasks WHERE id = ?').get(taskId);
        assert.strictEqual(
            row.attempts,
            0,
            'attempts não deve ser incrementado por STARTED (attempts contam falhas "counted")',
        );
        assert.strictEqual(row.status, 'RUNNING', 'status deve ser projetado para RUNNING');

        const evCount =
            /** @type {any} */ (
                db
                    .prepare(
                        'SELECT COUNT(1) AS c FROM events WHERE entity_type = ? AND entity_id = ? AND event_type = ?',
                    )
                    .get('task', taskId, ActionCode.DRIVER_TASK_STARTED)
            )?.c || 0;
        assert.strictEqual(evCount, 1, 'evento deve ser registrado uma única vez para o mesmo msg_id');

        projector.stop();
    });

    it('QueueWorker reprograma retry no DB quando kernel.executeTask falha com retryable', async () => {
        const db = getDb();
        const taskId = 'task-qw-1';
        insertTask({
            meta: {
                id: taskId,
                version: '5.0',
                created_at: new Date().toISOString(),
                priority: 5,
                source: 'gui',
            },
            spec: {
                target: 'chatgpt',
                payload: { system_message: '', user_message: 'hello' },
            },
            policy: { dependencies: [], execute_after: null },
            state: { status: 'PENDING' },
            result: {},
        });

        const kernel = {
            async executeTask() {
                const e = /** @type {any} */ (new Error('nerv bridge down'));
                e.retryable = true;
                e.delayMs = 500;
                e.reason = 'EMIT_COMMAND_FAILED';
                throw e;
            },
        };

        const worker = new QueueWorker({
            kernel,
            workerId: 'worker-test',
            intervalMs: 999999, // won't be used
            lockTtlMs: 60000,
            maxConcurrentTasks: 1,
        });

        /** @type {any} */ const beforeRow = db
            .prepare('SELECT status, stage, execute_after_ms, locked_by FROM tasks WHERE id = ?')
            .get(taskId);
        assert.strictEqual(beforeRow.status, 'PENDING');
        assert.strictEqual(beforeRow.stage, 'READY');

        await worker.tick();

        /** @type {any} */ const row = db
            .prepare('SELECT status, stage, execute_after_ms, locked_by, last_error FROM tasks WHERE id = ?')
            .get(taskId);
        assert.strictEqual(row.status, 'PENDING', 'task deve voltar para PENDING (reschedule)');
        assert.strictEqual(row.stage, 'READY', 'stage deve permanecer READY');
        assert.ok(
            typeof row.execute_after_ms === 'number' && row.execute_after_ms > Date.now(),
            'execute_after_ms deve ser no futuro',
        );
        assert.strictEqual(row.locked_by, null, 'lock deve ser liberado');
        assert.ok(
            String(row.last_error || '').includes('DISPATCH_RETRY_SCHEDULED'),
            'last_error deve registrar reschedule',
        );
    });

    it('QueueWorker respeita policy.max_attempts (SSOT gate)', async () => {
        const db = getDb();
        const taskId = 'task-max-attempts-1';

        insertTask({
            meta: {
                id: taskId,
                version: '5.0',
                created_at: new Date().toISOString(),
                priority: 5,
                source: 'gui',
            },
            spec: {
                target: 'chatgpt',
                payload: { system_message: '', user_message: 'hello' },
            },
            policy: { dependencies: [], execute_after: null, max_attempts: 2 },
            state: { status: 'PENDING' },
            result: {},
        });

        // Simula que já atingiu o limite de attempts no SSOT.
        db.prepare('UPDATE tasks SET attempts = 2 WHERE id = ?').run(taskId);

        let executed = 0;
        const kernel = {
            async executeTask() {
                executed++;
            },
        };

        const worker = new QueueWorker({
            kernel,
            workerId: 'worker-test',
            intervalMs: 999999,
            lockTtlMs: 60000,
            maxConcurrentTasks: 1,
        });

        await worker.tick();

        assert.strictEqual(executed, 0, 'não deve dispatchar se max_attempts já foi atingido');

        /** @type {any} */ const row = db
            .prepare('SELECT status, stage, locked_by, last_error FROM tasks WHERE id = ?')
            .get(taskId);
        assert.strictEqual(row.status, 'FAILED');
        assert.strictEqual(row.stage, 'ARCHIVED');
        assert.strictEqual(row.locked_by, null, 'lock deve ser liberado');
        assert.ok(String(row.last_error || '').includes('MAX_ATTEMPTS_REACHED'));
    });

    it('USER_ACTION_REQUIRED vira BLOCKED e não consome attempts', () => {
        const db = getDb();
        const taskId = 'task-blocked-1';
        insertTask({
            meta: {
                id: taskId,
                version: '5.0',
                created_at: new Date().toISOString(),
                priority: 5,
                source: 'gui',
            },
            spec: {
                target: 'chatgpt',
                payload: { system_message: '', user_message: 'hello' },
            },
            policy: { dependencies: [], execute_after: null, max_attempts: 3 },
            state: { status: 'PENDING' },
            result: {},
        });

        db.prepare(
            `
            UPDATE tasks
            SET locked_by = 'worker-x',
                locked_at_ms = @now,
                lock_expires_at_ms = @exp,
                last_correlation_id = @corr,
                latest_attempt_id = @corr
            WHERE id = @id
        `,
        ).run({ id: taskId, now: Date.now(), exp: Date.now() + 60000, corr: 'corr-blocked-1' });

        const nerv = new MockNERV();
        const projector = new TaskStateProjector({ nerv, workerId: 'w1' });
        projector.start();

        const env = createEnvelope({
            actor: ActorRole.DRIVER,
            messageType: MessageType.EVENT,
            actionCode: ActionCode.DRIVER_TASK_FAILED,
            payload: {
                taskId,
                reason: 'LOGIN_REQUIRED',
                reason_class: 'USER_ACTION_REQUIRED',
                next_action: 'BLOCK',
                retryable: true,
                count_attempt: false,
                details: { hint: 'please login' },
            },
            correlationId: 'corr-blocked-1',
            target: null,
        });

        nerv.receive(env);

        /** @type {any} */ const row = db
            .prepare(
                'SELECT status, blocked_reason, blocked_at_ms, blocked_details_json, attempts, locked_by FROM tasks WHERE id = ?',
            )
            .get(taskId);
        assert.strictEqual(row.status, 'BLOCKED');
        assert.strictEqual(row.blocked_reason, 'LOGIN_REQUIRED');
        assert.ok(Number(row.blocked_at_ms) > 0);
        assert.ok(String(row.blocked_details_json || '').includes('please login'));
        assert.strictEqual(row.attempts, 0);
        assert.strictEqual(row.locked_by, null, 'lock deve ser liberado ao bloquear');

        projector.stop();
    });

    it('ENV_UNAVAILABLE reschedule não consome attempts', () => {
        const db = getDb();
        const taskId = 'task-env-1';
        insertTask({
            meta: {
                id: taskId,
                version: '5.0',
                created_at: new Date().toISOString(),
                priority: 5,
                source: 'gui',
            },
            spec: {
                target: 'chatgpt',
                payload: { system_message: '', user_message: 'hello' },
            },
            policy: { dependencies: [], execute_after: null, max_attempts: 3 },
            state: { status: 'PENDING' },
            result: {},
        });

        db.prepare(
            `
            UPDATE tasks
            SET locked_by = 'worker-x',
                locked_at_ms = @now,
                lock_expires_at_ms = @exp,
                last_correlation_id = @corr,
                latest_attempt_id = @corr
            WHERE id = @id
        `,
        ).run({ id: taskId, now: Date.now(), exp: Date.now() + 60000, corr: 'corr-env-1' });

        const nerv = new MockNERV();
        const projector = new TaskStateProjector({ nerv, workerId: 'w1' });
        projector.start();

        const env = createEnvelope({
            actor: ActorRole.DRIVER,
            messageType: MessageType.EVENT,
            actionCode: ActionCode.DRIVER_TASK_FAILED,
            payload: {
                taskId,
                reason: 'BROWSER_DISCONNECTED',
                reason_class: 'ENV_UNAVAILABLE',
                next_action: 'RETRY_LATER',
                retryable: true,
                suggestedDelayMs: 500,
                count_attempt: false,
            },
            correlationId: 'corr-env-1',
            target: null,
        });

        nerv.receive(env);

        /** @type {any} */ const row = db
            .prepare('SELECT status, stage, execute_after_ms, attempts, locked_by FROM tasks WHERE id = ?')
            .get(taskId);
        assert.strictEqual(row.status, 'PENDING');
        assert.strictEqual(row.stage, 'READY');
        assert.ok(Number(row.execute_after_ms) > Date.now());
        assert.strictEqual(row.attempts, 0);
        assert.strictEqual(row.locked_by, null);

        projector.stop();
    });

    it('LLM_TIMEOUT (operacional) reschedule não consome attempts', () => {
        const db = getDb();
        const taskId = 'task-llm-timeout-1';
        insertTask({
            meta: {
                id: taskId,
                version: '5.0',
                created_at: new Date().toISOString(),
                priority: 5,
                source: 'gui',
            },
            spec: {
                target: 'chatgpt',
                payload: { system_message: '', user_message: 'hello' },
            },
            policy: { dependencies: [], execute_after: null, max_attempts: 3 },
            state: { status: 'PENDING' },
            result: {},
        });

        const corr = 'corr-llm-timeout-1';
        const now = Date.now();
        db.prepare(
            `
            UPDATE tasks
            SET locked_by = 'worker-x',
                locked_at_ms = @now,
                lock_expires_at_ms = @exp,
                last_correlation_id = @corr,
                latest_attempt_id = @corr
            WHERE id = @id
        `,
        ).run({ id: taskId, now, exp: now + 60000, corr });

        const nerv = new MockNERV();
        const projector = new TaskStateProjector({ nerv, workerId: 'w1' });
        projector.start();

        const env = createEnvelope({
            actor: ActorRole.DRIVER,
            messageType: MessageType.EVENT,
            actionCode: ActionCode.DRIVER_TASK_FAILED,
            payload: {
                taskId,
                reason: 'LLM_TIMEOUT',
                reason_code: 'LLM_TIMEOUT',
                cause_layer: 'LLM',
                reason_class: 'TASK_ERROR',
                next_action: 'RETRY_LATER',
                retryable: true,
                suggestedDelayMs: 30000,
                count_attempt: false,
            },
            correlationId: corr,
            target: null,
        });

        nerv.receive(env);

        /** @type {any} */ const row = db
            .prepare('SELECT status, stage, execute_after_ms, attempts, locked_by FROM tasks WHERE id = ?')
            .get(taskId);
        assert.strictEqual(row.status, 'PENDING');
        assert.strictEqual(row.stage, 'READY');
        assert.ok(
            Number(row.execute_after_ms) >= now + 30000,
            'execute_after_ms deve respeitar backoff operacional (>=30s)',
        );
        assert.strictEqual(row.attempts, 0, 'LLM_TIMEOUT não consome attempts estratégicos');
        assert.strictEqual(row.locked_by, null, 'lock deve ser liberado no reschedule');

        projector.stop();
    });

    it('Falha inclui evidências: projector registra artifacts diagnósticos no attempt', () => {
        const db = getDb();
        const taskId = 'task-diag-1';
        insertTask({
            meta: {
                id: taskId,
                version: '5.0',
                created_at: new Date().toISOString(),
                priority: 5,
                source: 'gui',
            },
            spec: {
                target: 'chatgpt',
                payload: { system_message: '', user_message: 'hello' },
            },
            policy: { dependencies: [], execute_after: null, max_attempts: 3 },
            state: { status: 'PENDING' },
            result: {},
        });

        const corr = 'corr-diag-1';
        const now = Date.now();
        db.prepare(
            `
            UPDATE tasks
            SET locked_by = 'worker-x',
                locked_at_ms = @now,
                lock_expires_at_ms = @exp,
                last_correlation_id = @corr,
                latest_attempt_id = @corr
            WHERE id = @id
        `,
        ).run({ id: taskId, now, exp: now + 60000, corr });

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-diag-'));
        const screenshotFile = path.join(tmpDir, 'screenshot.png');
        const htmlFile = path.join(tmpDir, 'page.html');
        const metaFile = path.join(tmpDir, 'meta.json');
        fs.writeFileSync(screenshotFile, Buffer.from([0x89, 0x50, 0x4e, 0x47])); // PNG header prefix (tiny)
        fs.writeFileSync(htmlFile, '<html><body>hi</body></html>', 'utf8');
        fs.writeFileSync(metaFile, JSON.stringify({ url: 'https://example.com', title: 'x' }), 'utf8');

        const nerv = new MockNERV();
        const projector = new TaskStateProjector({ nerv, workerId: 'w1' });
        projector.start();

        const env = createEnvelope({
            actor: ActorRole.DRIVER,
            messageType: MessageType.EVENT,
            actionCode: ActionCode.DRIVER_TASK_FAILED,
            payload: {
                taskId,
                reason: 'UI_NOT_FOUND',
                reason_code: 'UI_NOT_FOUND',
                cause_layer: 'UI',
                reason_class: 'TASK_ERROR',
                next_action: 'RETRY_LATER',
                retryable: true,
                suggestedDelayMs: 500,
                count_attempt: true,
                details: {
                    diagnostic_storage: {
                        screenshot_file: screenshotFile,
                        html_file: htmlFile,
                        meta_json_file: metaFile,
                    },
                    diagnosis_summary: { ok: false, note: 'test' },
                },
            },
            correlationId: corr,
            target: null,
        });

        nerv.receive(env);

        /** @type {any} */ const attempt = db
            .prepare('SELECT diagnostic_artifacts_json FROM task_attempts WHERE id = ?')
            .get(corr);
        assert.ok(attempt && attempt.diagnostic_artifacts_json, 'attempt deve conter diagnostic_artifacts_json');
        const ids = JSON.parse(attempt.diagnostic_artifacts_json);
        assert.ok(ids.screenshot, 'screenshot artifact id deve existir');
        assert.ok(ids.html, 'html artifact id deve existir');
        assert.ok(ids.meta, 'meta artifact id deve existir');

        const artifactCount = /** @type {any} */ (
            db
                .prepare('SELECT COUNT(1) AS c FROM artifacts WHERE id IN (?, ?, ?)')
                .get(ids.screenshot, ids.html, ids.meta)
        )?.c;
        assert.strictEqual(artifactCount, 3, 'todos os artifacts devem estar registrados na tabela artifacts');

        projector.stop();

        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch (_) {}
    });

    it('ACCEPTED/HEARTBEAT estendem lock e atualizam last_heartbeat', () => {
        const db = getDb();
        const taskId = 'task-hb-1';
        insertTask({
            meta: {
                id: taskId,
                version: '5.0',
                created_at: new Date().toISOString(),
                priority: 5,
                source: 'gui',
            },
            spec: {
                target: 'chatgpt',
                payload: { system_message: '', user_message: 'hello' },
            },
            policy: { dependencies: [], execute_after: null, max_attempts: 3 },
            state: { status: 'PENDING' },
            result: {},
        });

        const now = Date.now();
        db.prepare(
            `
            UPDATE tasks
            SET locked_by = 'worker-x',
                locked_at_ms = @now,
                lock_expires_at_ms = @exp,
                last_correlation_id = @corr,
                latest_attempt_id = @corr
            WHERE id = @id
        `,
        ).run({ id: taskId, now, exp: now + 5000, corr: 'corr-hb-1' });

        const nerv = new MockNERV();
        const projector = new TaskStateProjector({ nerv, workerId: 'w1' });
        projector.start();

        const accepted = createEnvelope({
            actor: ActorRole.DRIVER,
            messageType: MessageType.EVENT,
            actionCode: ActionCode.DRIVER_TASK_ACCEPTED,
            payload: { taskId },
            correlationId: 'corr-hb-1',
            target: null,
        });
        nerv.receive(accepted);

        /** @type {any} */ const row1 = db.prepare('SELECT lock_expires_at_ms FROM tasks WHERE id = ?').get(taskId);
        assert.ok(Number(row1.lock_expires_at_ms) >= now + 240000, 'lock deve ser estendido no ACCEPTED');

        const hb = createEnvelope({
            actor: ActorRole.DRIVER,
            messageType: MessageType.EVENT,
            actionCode: ActionCode.DRIVER_TASK_HEARTBEAT,
            payload: { taskId },
            correlationId: 'corr-hb-1',
            target: null,
        });
        nerv.receive(hb);

        /** @type {any} */ const attempt = db
            .prepare('SELECT last_heartbeat_at_ms FROM task_attempts WHERE id = ?')
            .get('corr-hb-1');
        assert.ok(Number(attempt.last_heartbeat_at_ms) > 0);

        projector.stop();
    });

    it('TaskControlWatcher deduplica por intenção (updated/paused/cancelled) e re-emite abort', async () => {
        const db = getDb();
        const taskId = 'task-ctrl-1';
        insertTask({
            meta: {
                id: taskId,
                version: '5.0',
                created_at: new Date().toISOString(),
                priority: 5,
                source: 'gui',
            },
            spec: {
                target: 'chatgpt',
                payload: { system_message: '', user_message: 'hello' },
            },
            policy: { dependencies: [], execute_after: null },
            state: { status: 'PENDING' },
            result: {},
        });

        // Simula task em execução e usuário pausou (status=PAUSED + lock presente)
        db.prepare(
            `
            UPDATE tasks
            SET status = 'PAUSED',
                paused_at_ms = @t,
                locked_by = 'worker-x',
                locked_at_ms = @t,
                lock_expires_at_ms = @t2,
                updated_at_ms = @t
            WHERE id = @id
        `,
        ).run({ id: taskId, t: Date.now(), t2: Date.now() + 60000 });

        const nerv = new MockNERV();
        const watcher = new TaskControlWatcher({ nerv, intervalMs: 999999 });

        await watcher.tick();
        assert.strictEqual(nerv.emittedCommands.length, 1, 'primeiro PAUSE deve emitir um abort');
        assert.strictEqual(nerv.emittedCommands[0].type.action_code, ActionCode.DRIVER_ABORT);

        // Simula uma nova intenção de pausa em outro momento (lock voltou a existir)
        db.prepare(
            `
            UPDATE tasks
            SET status = 'PAUSED',
                paused_at_ms = @t,
                locked_by = 'worker-x',
                locked_at_ms = @t,
                lock_expires_at_ms = @t2,
                updated_at_ms = @t
            WHERE id = @id
        `,
        ).run({ id: taskId, t: Date.now() + 5, t2: Date.now() + 60000 });

        await watcher.tick();
        assert.strictEqual(nerv.emittedCommands.length, 2, 'segunda PAUSE (nova intenção) deve emitir outro abort');
    });

    it('DriverNERVAdapter sempre responde em duplicate dispatch (activeDrivers)', async () => {
        const nerv = new MockNERV();
        const browserPool = {
            initialized: true,
            shuttingDown: false,
            circuitBreaker: null,
            allocate: async () => null,
            release: async () => null,
            getHealth: async () => ({ status: 'OK' }),
        };

        const adapter = new DriverNERVAdapter(nerv, browserPool, { saveResponse: null });

        const taskId = 'task-dup-1';
        adapter.activeDrivers.set(taskId, { correlationId: 'c_active' });

        const cmd = createEnvelope({
            actor: ActorRole.KERNEL,
            messageType: MessageType.COMMAND,
            actionCode: ActionCode.DRIVER_EXECUTE_TASK,
            payload: {
                task: {
                    meta: { id: taskId },
                    spec: { payload: { system_message: '', user_message: 'hi' }, target: 'chatgpt' },
                },
            },
            correlationId: 'c_dup',
            target: null,
        });

        nerv.receive(cmd);
        // handler é async e passa por vários awaits internos (_emitBoth → _emitEvent → nerv.emitEvent)
        await waitForAssertion(() => {
            assert.strictEqual(
                nerv.emittedEvents.length,
                1,
                'deve emitir ao menos 1 evento de falha (resposta ao comando)',
            );
        });
        assert.strictEqual(nerv.emittedEvents[0].type.action_code, ActionCode.DRIVER_TASK_FAILED);
        assert.strictEqual(nerv.emittedEvents[0].payload.taskId, taskId);
        assert.strictEqual(nerv.emittedEvents[0].payload.reason, 'TASK_ALREADY_RUNNING');
        assert.strictEqual(Boolean(nerv.emittedEvents[0].payload.do_not_unlock), true);

        await adapter.shutdown({ timeout: 50 });
        await shutdownDriverFactory();
    });

    it('AttemptWatchdog escala ENV_UNAVAILABLE persistente para BLOCKED', async () => {
        const db = getDb();
        const taskId = 'task-escalate-env-1';
        insertTask({
            meta: {
                id: taskId,
                version: '5.0',
                created_at: new Date().toISOString(),
                priority: 5,
                source: 'gui',
            },
            spec: {
                target: 'chatgpt',
                payload: { system_message: '', user_message: 'hello' },
            },
            policy: { dependencies: [], execute_after: null, max_attempts: 3 },
            state: { status: 'PENDING' },
            result: {},
        });

        const now = Date.now();
        for (let i = 0; i < 10; i++) {
            db.prepare(
                `
                INSERT INTO task_attempts (
                    id, task_id, mission_id, status, worker_id, created_at_ms, ended_at_ms, error,
                    reason_class, count_attempt, reason_code, cause_layer
                ) VALUES (
                    @id, @task_id, NULL, 'FAILED', NULL, @created_at_ms, @ended_at_ms, @error,
                    'ENV_UNAVAILABLE', 0, @reason_code, 'BROWSER_POOL'
                )
            `,
            ).run({
                id: `corr-env-escalate-${i}`,
                task_id: taskId,
                created_at_ms: now - 1000 - i,
                ended_at_ms: now - i,
                error: `ENV failure ${i}`,
                reason_code: i === 0 ? 'BROWSER_DISCONNECTED' : 'ENV_UNAVAILABLE',
            });
        }

        const watchdog = new AttemptWatchdog({ nerv: null, intervalMs: 999999 });
        await watchdog.tick();

        /** @type {any} */ const row = db
            .prepare('SELECT status, blocked_reason, blocked_details_json FROM tasks WHERE id = ?')
            .get(taskId);
        assert.strictEqual(row.status, 'BLOCKED');
        assert.strictEqual(row.blocked_reason, 'ENV_UNAVAILABLE_LONG');
        assert.ok(String(row.blocked_details_json || '').includes('ENV failure'));
    });

    it('AttemptWatchdog escala LLM_TIMEOUT persistente para BLOCKED', async () => {
        const db = getDb();
        const taskId = 'task-escalate-llm-1';
        insertTask({
            meta: {
                id: taskId,
                version: '5.0',
                created_at: new Date().toISOString(),
                priority: 5,
                source: 'gui',
            },
            spec: {
                target: 'chatgpt',
                payload: { system_message: '', user_message: 'hello' },
            },
            policy: { dependencies: [], execute_after: null, max_attempts: 3 },
            state: { status: 'PENDING' },
            result: {},
        });

        const now = Date.now();
        for (let i = 0; i < 10; i++) {
            db.prepare(
                `
                INSERT INTO task_attempts (
                    id, task_id, mission_id, status, worker_id, created_at_ms, ended_at_ms, error,
                    reason_class, count_attempt, reason_code, cause_layer
                ) VALUES (
                    @id, @task_id, NULL, 'FAILED', NULL, @created_at_ms, @ended_at_ms, @error,
                    'TASK_ERROR', 0, 'LLM_TIMEOUT', 'LLM'
                )
            `,
            ).run({
                id: `corr-llm-escalate-${i}`,
                task_id: taskId,
                created_at_ms: now - 1000 - i,
                ended_at_ms: now - i,
                error: `LLM timeout ${i}`,
            });
        }

        const watchdog = new AttemptWatchdog({ nerv: null, intervalMs: 999999 });
        await watchdog.tick();

        /** @type {any} */ const row = db
            .prepare('SELECT status, blocked_reason, blocked_details_json FROM tasks WHERE id = ?')
            .get(taskId);
        assert.strictEqual(row.status, 'BLOCKED');
        assert.strictEqual(row.blocked_reason, 'LLM_TIMEOUT_PERSISTENT');
        assert.ok(String(row.blocked_details_json || '').includes('LLM timeout'));
    });
});
