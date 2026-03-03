// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { closeDb, getDb } from '#infra/db/sqlite';
import { MissionManager } from '#missions/mission_manager';

function makeDbPath() {
    const dir = path.join(process.cwd(), 'tmp', 'test-dbs');
    fs.mkdirSync(dir, { recursive: true });
    return path.join(
        dir,
        `maestro-wave15-mission-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`
    );
}

function makeMissionManager({ missionState, kernelExecuteTask }) {
    const stateRef = { value: JSON.parse(JSON.stringify(missionState)) };

    const stateManager = {
        baseDir: path.join(process.cwd(), 'tmp', 'missions-wave15'),
        async initialize() {},
        async getMission(missionId) {
            return stateRef.value?.id === missionId ? JSON.parse(JSON.stringify(stateRef.value)) : null;
        },
        async updateMission(missionId, updates) {
            if (stateRef.value?.id !== missionId) return null;
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
        processFeedback(text) {
            return {
                id: 'fb',
                original: text,
                normalized: String(text || ''),
                category: 'GENERAL',
                actionItems: [],
                patterns: [],
            };
        },
        injectIntoStep(prompt) {
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

test('wave15: MissionManager usa enqueue SSOT por padrão (sem dispatch direto)', async t => {
    const dbPath = makeDbPath();
    process.env.MAESTRO_DB_PATH = dbPath;
    process.env.MISSION_STEP_DISPATCH_MODE = 'ssot_queue';

    const db = getDb();
    db.exec(`
        DELETE FROM task_dependencies;
        DELETE FROM events;
        DELETE FROM task_attempts;
        DELETE FROM artifacts;
        DELETE FROM tasks;
        DELETE FROM missions;
    `);

    t.after(() => {
        delete process.env.MISSION_STEP_DISPATCH_MODE;
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
            id: 'mission-wave15-ssot',
            status: 'running',
            progress: { current_step: 0, completed_tasks: 0, percent: 0 },
            workflow: {
                id: 'wf-wave15',
                steps: [{ id: 'step-1', description: 'Primeiro step' }],
            },
            feedback: [],
        },
        kernelExecuteTask: async () => {
            kernelCalls++;
        },
    });

    manager.activeMissions.set('mission-wave15-ssot', {
        currentStepIndex: 0,
        steps: [{ id: 'step-1' }],
        taskIds: [],
    });

    await manager._executeNextStep('mission-wave15-ssot');

    assert.equal(kernelCalls, 0, 'modo ssot_queue não pode chamar kernel.executeTask diretamente');

    const row = db
        .prepare('SELECT id, mission_id, workflow_id, parent_id, stage, status FROM tasks WHERE mission_id = ?')
        .get('mission-wave15-ssot');
    assert.ok(row, 'task da missão deve ser enfileirada em tasks');
    assert.equal(row.workflow_id, 'wf-wave15');
    assert.equal(row.stage, 'READY');
    assert.equal(row.status, 'PENDING');
});

test('wave15: MissionManager mantém fallback legacy_direct por env', async t => {
    process.env.MISSION_STEP_DISPATCH_MODE = 'legacy_direct';
    process.env.MISSION_MANAGER_LEGACY_DISPATCH_ENABLED = 'true';

    t.after(() => {
        delete process.env.MISSION_STEP_DISPATCH_MODE;
        delete process.env.MISSION_MANAGER_LEGACY_DISPATCH_ENABLED;
    });

    let kernelCalls = 0;
    const manager = makeMissionManager({
        missionState: {
            id: 'mission-wave15-legacy',
            status: 'running',
            progress: { current_step: 0, completed_tasks: 0, percent: 0 },
            workflow: {
                id: 'wf-wave15-legacy',
                steps: [{ id: 'step-legacy', description: 'Step legado' }],
            },
            feedback: [],
        },
        kernelExecuteTask: async () => {
            kernelCalls++;
        },
    });

    manager.activeMissions.set('mission-wave15-legacy', {
        currentStepIndex: 0,
        steps: [{ id: 'step-legacy' }],
        taskIds: [],
    });

    await manager._executeNextStep('mission-wave15-legacy');
    assert.equal(kernelCalls, 1, 'fallback legacy_direct deve preservar dispatch direto temporário');
});
