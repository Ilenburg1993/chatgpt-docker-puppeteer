// @ts-check
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test, after } from 'node:test';

import { closeDb, getDb } from '#infra/db/sqlite';
import { MissionManager } from '#missions/mission_manager';

function makeDbPath() {
    const dir = path.join(process.cwd(), 'tmp', 'test-dbs');
    fs.mkdirSync(dir, { recursive: true });
    return path.join(
        dir,
        `maestro-wave17-owner-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
    );
}

function makeMissionManager(
    /** @type {{ missionState: any; kernelExecuteTask: any }} */ { missionState, kernelExecuteTask },
) {
    const stateRef = { value: JSON.parse(JSON.stringify(missionState)) };
    const stateManager = {
        baseDir: path.join(process.cwd(), 'tmp', 'missions-wave17-owner'),
        async initialize() {},
        async getMission(/** @type {any} */ missionId) {
            return JSON.parse(JSON.stringify(stateRef.value));
        },
        async updateMission(/** @type {any} */ missionId, /** @type {any} */ updates) {
            stateRef.value = { ...stateRef.value, ...updates };
            return JSON.parse(JSON.stringify(stateRef.value));
        },
        async listMissions() {
            return [JSON.parse(JSON.stringify(stateRef.value))];
        },
        async createMission() {
            return JSON.parse(JSON.stringify(stateRef.value));
        },
        async deleteMission() {
            return 1;
        },
        async saveOutput() {},
    };
    const contextManager = {
        initializeContext() {},
        getContextForStep() {
            return { summary: '', steps: [] };
        },
        async addStepOutput() {},
        clearContext() {},
        cleanup() {},
    };
    const feedbackProcessor = {
        processFeedback(/** @type {any} */ text) {
            return {
                id: 'fb',
                original: text,
                normalized: String(text || ''),
                category: 'GENERAL',
                actionItems: [],
                patterns: [],
            };
        },
        injectIntoStep(/** @type {any} */ prompt) {
            return prompt;
        },
    };
    const checkpointManager = {
        async saveCheckpoint() {},
        async hasCheckpoint() {
            return false;
        },
        async loadCheckpoint() {
            return null;
        },
        async listCheckpoints() {
            return [];
        },
        async deleteAllCheckpoints() {},
    };

    return new MissionManager({
        kernel: { executeTask: kernelExecuteTask },
        nerv: { onReceive: () => () => {} },
        stateManager,
        contextManager,
        feedbackProcessor,
        checkpointManager,
    });
}

test('wave17: MissionManager força SSOT quando legacy_direct não está em contingência', async (t) => {
    const dbPath = makeDbPath();
    process.env.MAESTRO_DB_PATH = dbPath;
    process.env.MISSION_STEP_DISPATCH_MODE = 'legacy_direct';
    delete process.env.MISSION_MANAGER_LEGACY_DISPATCH_ENABLED;

    const db = getDb();
    db.exec(`
        DELETE FROM task_dependencies;
        DELETE FROM events;
        DELETE FROM task_attempts;
        DELETE FROM artifacts;
        DELETE FROM tasks;
        DELETE FROM missions;
    `);

    after(() => {
        delete process.env.MISSION_STEP_DISPATCH_MODE;
        delete process.env.MISSION_MANAGER_LEGACY_DISPATCH_ENABLED;
        try {
            closeDb();
        } catch (_) {}
        try {
            fs.rmSync(dbPath, { force: true });
        } catch (_) {}
    });

    let kernelCalls = 0;
    const manager = makeMissionManager({
        missionState: {
            id: 'mission-wave17-owner',
            status: 'running',
            progress: { current_step: 0, completed_tasks: 0, percent: 0 },
            workflow: { id: 'wf-wave17', steps: [{ id: 'step-1', description: 'step' }] },
            feedback: [],
        },
        kernelExecuteTask: async () => {
            kernelCalls += 1;
        },
    });

    manager.activeMissions.set('mission-wave17-owner', {
        currentStepIndex: 0,
        steps: [{ id: 'step-1' }],
        taskIds: [],
    });

    await manager._executeNextStep('mission-wave17-owner');

    assert.equal(kernelCalls, 0);
    const row = /** @type {any} */ (
        db.prepare('SELECT id, mission_id, stage, status FROM tasks WHERE mission_id = ?').get('mission-wave17-owner')
    );
    assert.ok(row);
    assert.equal(row.stage, 'READY');
    assert.equal(row.status, 'PENDING');
});
