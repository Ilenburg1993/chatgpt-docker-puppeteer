// @ts-check
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import path from 'node:path';
import EventEmitter from 'node:events';
import { MissionStateManager, MISSION_STATUS } from '#missions/mission_state_manager';
import { WorkflowGenerator } from '#missions/workflow_generator';
import { MissionManager } from '#missions/mission_manager';
import { ActionCode, MessageType } from '#shared/nerv/constants';

// Diretórios de teste
const TEST_MISSIONS_DIR = path.join(import.meta.dirname, '../../tmp/missions');
const TEST_TEMPLATES_DIR = path.join(import.meta.dirname, '../../../src/missions/templates');

// Mock NERV simples
class MockNERV extends EventEmitter {
    constructor() {
        super();
        this.receiveHandlers = [];
        this.emittedCommands = [];
        this.emittedEvents = [];
    }

    onReceive(handler) {
        this.receiveHandlers.push(handler);
        return () => {
            const index = this.receiveHandlers.indexOf(handler);
            if (index > -1) this.receiveHandlers.splice(index, 1);
        };
    }

    receive(envelope) {
        this.receiveHandlers.forEach(h => h(envelope));
    }

    emitCommand(envelope) {
        this.emittedCommands.push(envelope);
    }

    emitEvent(envelope) {
        this.emittedEvents.push(envelope);
    }
}

// Mock Kernel simples
class MockKernel {
    constructor() {
        this.executedTasks = [];
    }

    async executeTask(task, correlationId) {
        this.executedTasks.push({ task, correlationId });
    }
}

// Helper: envelope do driver → mission manager (formato resiliente)
function buildTaskEnvelope({ actionCode, missionId, taskId, stepId, result = null, error = null, correlationId = null }) {
    return {
        // aceita os dois nomes (alguns consumidores usam kind; outros messageType)
        kind: MessageType.EVENT,
        messageType: MessageType.EVENT,
        actionCode,
        correlationId,
        payload: {
            task: {
                meta: {
                    mission_id: missionId,
                    id: taskId,
                    step_id: stepId
                }
            },
            result,
            error
        }
    };
}

// Helper anti-flake: espera condição com timeout
async function waitForCondition(predicate, { timeoutMs = 1500, intervalMs = 10 } = {}) {
    const start = Date.now();
    while (true) {
        if (predicate()) return;
        if (Date.now() - start >= timeoutMs) {
            throw new Error('Timed out waiting for condition');
        }
        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
}

describe('MissionStateManager (filesystem persistence)', () => {
    let stateManager;

    beforeEach(async () => {
        stateManager = new MissionStateManager({ baseDir: TEST_MISSIONS_DIR });
        await stateManager.initialize();
    });

    afterEach(async () => {
        try {
            await fs.rm(TEST_MISSIONS_DIR, { recursive: true, force: true });
        } catch (_) {
            // ignore
        }
    });

    describe('1. CRUD Operations', () => {
        it('should create mission with filesystem structure', async () => {
            const mission = {
                id: 'test-mission-001',
                title: 'Test Mission',
                description: 'Test description',
                workflow: {
                    id: 'workflow-001',
                    steps: [
                        { id: 'step-1', name: 'Step 1' },
                        { id: 'step-2', name: 'Step 2' }
                    ]
                },
                config: { template: 'test_template' }
            };

            const state = await stateManager.createMission(mission);

            assert.ok(state, 'State foi criado');
            assert.strictEqual(state.id, 'test-mission-001');
            assert.strictEqual(state.status, MISSION_STATUS.PENDING);
            assert.strictEqual(state.progress.total_steps, 2);

            const missionDir = path.join(TEST_MISSIONS_DIR, 'test-mission-001');
            const statePath = path.join(missionDir, 'state.json');
            const outputsDir = path.join(missionDir, 'outputs');
            const checkpointsDir = path.join(missionDir, 'checkpoints');

            await assert.doesNotReject(fs.access(statePath));
            await assert.doesNotReject(fs.access(outputsDir));
            await assert.doesNotReject(fs.access(checkpointsDir));
        });

        it('should read mission from filesystem', async () => {
            const mission = {
                id: 'test-mission-002',
                title: 'Test',
                description: 'Desc',
                workflow: { id: 'wf', steps: [] },
                config: {}
            };

            await stateManager.createMission(mission);

            const retrieved = await stateManager.getMission('test-mission-002');

            assert.ok(retrieved);
            assert.strictEqual(retrieved.id, 'test-mission-002');
            assert.strictEqual(retrieved.title, 'Test');
        });

        it('should return null for non-existent mission', async () => {
            const result = await stateManager.getMission('does-not-exist');
            assert.strictEqual(result, null);
        });

        it('should list missions with filters', async () => {
            await stateManager.createMission({
                id: 'mission-a',
                title: 'A',
                description: 'A',
                workflow: { id: 'wf-a', steps: [] },
                config: {}
            });

            await stateManager.createMission({
                id: 'mission-b',
                title: 'B',
                description: 'B',
                workflow: { id: 'wf-b', steps: [] },
                config: {}
            });

            await stateManager.updateMission('mission-b', {
                status: MISSION_STATUS.RUNNING
            });

            const all = await stateManager.listMissions();
            assert.strictEqual(all.length, 2);

            const running = await stateManager.listMissions({ status: MISSION_STATUS.RUNNING });
            assert.strictEqual(running.length, 1);
            assert.strictEqual(running[0].id, 'mission-b');
        });

        it('should update mission and add history event', async () => {
            await stateManager.createMission({
                id: 'mission-update',
                title: 'Test',
                description: 'Test',
                workflow: { id: 'wf-update', steps: [] },
                config: {}
            });

            const updated = await stateManager.updateMission('mission-update', {
                status: MISSION_STATUS.RUNNING
            });

            assert.strictEqual(updated.status, MISSION_STATUS.RUNNING);
            assert.ok(updated.updated_at !== updated.created_at);

            const hasStatusChange = updated.history.some(
                h => h.event === 'STATUS_CHANGED' && h.msg.includes('pending → running')
            );
            assert.ok(hasStatusChange, 'Histórico contém mudança de status');
        });

        it('should delete mission completely', async () => {
            await stateManager.createMission({
                id: 'mission-delete',
                title: 'Delete me',
                description: 'Test',
                workflow: { id: 'wf-delete', steps: [] },
                config: {}
            });

            await stateManager.deleteMission('mission-delete');

            const result = await stateManager.getMission('mission-delete');
            assert.strictEqual(result, null);
        });
    });

    describe('2. Outputs & Checkpoints', () => {
        it('should save and retrieve step output', async () => {
            await stateManager.createMission({
                id: 'mission-output',
                title: 'Test',
                description: 'Test',
                workflow: { id: 'wf-output', steps: [] },
                config: {}
            });

            const output = 'This is the output of step 1';
            await stateManager.saveOutput('mission-output', 'step-1', output);

            const retrieved = await stateManager.getOutput('mission-output', 'step-1');
            assert.strictEqual(retrieved, output);
        });

        it('should return null for non-existent output', async () => {
            await stateManager.createMission({
                id: 'mission-no-output',
                title: 'Test',
                description: 'Test',
                workflow: { id: 'wf-no-output', steps: [] },
                config: {}
            });

            const result = await stateManager.getOutput('mission-no-output', 'step-999');
            assert.strictEqual(result, null);
        });

        it('should save and load checkpoint', async () => {
            await stateManager.createMission({
                id: 'mission-checkpoint',
                title: 'Test',
                description: 'Test',
                workflow: { id: 'wf-checkpoint', steps: [] },
                config: {}
            });

            const checkpoint = {
                ts: new Date().toISOString(),
                step_index: 5,
                data: { some: 'data' }
            };

            await stateManager.saveCheckpoint('mission-checkpoint', checkpoint);

            const loaded = await stateManager.loadCheckpoint('mission-checkpoint');
            assert.ok(loaded);
            assert.strictEqual(loaded.step_index, 5);
            assert.deepStrictEqual(loaded.data, { some: 'data' });
        });

        it('should add feedback to mission', async () => {
            await stateManager.createMission({
                id: 'mission-feedback',
                title: 'Test',
                description: 'Test',
                workflow: { id: 'wf-feedback', steps: [] },
                config: {}
            });

            await stateManager.addFeedback('mission-feedback', 'Please add more examples');

            const state = await stateManager.getMission('mission-feedback');
            assert.strictEqual(state.feedback.length, 1);
            assert.strictEqual(state.feedback[0].content, 'Please add more examples');

            const hasFeedback = state.history.some(h => h.event === 'FEEDBACK_ADDED');
            assert.ok(hasFeedback);
        });
    });
});

describe('WorkflowGenerator (template → workflow)', () => {
    let generator;

    beforeEach(() => {
        generator = new WorkflowGenerator({ templatesDir: TEST_TEMPLATES_DIR });
    });

    describe('1. Template Loading', () => {
        it('should load book_writing template', async () => {
            const template = await generator.loadTemplate('book_writing');

            assert.ok(template);
            assert.strictEqual(template.id, 'book_writing');
            assert.ok(template.workflow_template);
            assert.ok(template.params);
        });

        it('should throw error for non-existent template', async () => {
            await assert.rejects(generator.loadTemplate('does_not_exist'), /ENOENT/);
        });
    });

    describe('2. Workflow Generation', () => {
        it('should generate workflow with default params', async () => {
            const workflow = await generator.generateWorkflow('book_writing', {
                topic: 'Rust Programming'
            });

            assert.ok(workflow);
            assert.ok(workflow.id);
            assert.strictEqual(workflow.template_id, 'book_writing');

            assert.strictEqual(workflow.steps.length, 17, 'Workflow deve ter 17 steps');
        });

        it('should expand repeat_for_each steps', async () => {
            const workflow = await generator.generateWorkflow('book_writing', {
                topic: 'Python',
                num_chapters: 5
            });

            assert.strictEqual(workflow.steps.length, 7);
        });

        it('should replace placeholders in prompts', async () => {
            const workflow = await generator.generateWorkflow('book_writing', {
                topic: 'JavaScript',
                num_chapters: 5,
                target_audience: 'beginners'
            });

            const outlineStep = workflow.steps[0];
            assert.ok(outlineStep.prompt_template.includes('JavaScript'), 'Prompt deve conter topic');
            assert.ok(outlineStep.prompt_template.includes('beginners'), 'Prompt deve conter target_audience');
        });

        it('should validate required params', async () => {
            await assert.rejects(generator.generateWorkflow('book_writing', {}), /Parâmetro obrigatório ausente: topic/);
        });

        it('should validate param ranges', async () => {
            await assert.rejects(
                generator.generateWorkflow('book_writing', {
                    topic: 'Rust',
                    num_chapters: 100
                }),
                /deve ser <= 50/
            );
        });
    });

    describe('3. Template Listing', () => {
        it('should list available templates', async () => {
            const templates = await generator.listTemplates();

            assert.ok(Array.isArray(templates));
            assert.ok(templates.includes('book_writing'));
        });
    });
});

describe('MissionManager (end-to-end)', () => {
    let missionManager;
    let kernel;
    let nerv;
    let prevMissionDispatchMode;
    let prevMissionLegacyDispatchEnabled;

    beforeEach(async () => {
        // Este suite valida integração histórica com mock de kernel (dispatch direto).
        // No runtime real o default é SSOT-first; aqui ativamos contingência explicitamente.
        prevMissionDispatchMode = process.env.MISSION_STEP_DISPATCH_MODE;
        prevMissionLegacyDispatchEnabled = process.env.MISSION_MANAGER_LEGACY_DISPATCH_ENABLED;
        process.env.MISSION_STEP_DISPATCH_MODE = 'legacy_direct';
        process.env.MISSION_MANAGER_LEGACY_DISPATCH_ENABLED = 'true';

        kernel = new MockKernel();
        nerv = new MockNERV();

        const stateManager = new MissionStateManager({ baseDir: TEST_MISSIONS_DIR });
        const workflowGenerator = new WorkflowGenerator({ templatesDir: TEST_TEMPLATES_DIR });

        missionManager = new MissionManager({
            kernel,
            nerv,
            stateManager,
            workflowGenerator
        });

        await missionManager.initialize();
    });

    afterEach(async () => {
        try {
            missionManager.cleanup();
        } catch (_) {}

        if (typeof prevMissionDispatchMode === 'undefined') {
            delete process.env.MISSION_STEP_DISPATCH_MODE;
        } else {
            process.env.MISSION_STEP_DISPATCH_MODE = prevMissionDispatchMode;
        }
        if (typeof prevMissionLegacyDispatchEnabled === 'undefined') {
            delete process.env.MISSION_MANAGER_LEGACY_DISPATCH_ENABLED;
        } else {
            process.env.MISSION_MANAGER_LEGACY_DISPATCH_ENABLED = prevMissionLegacyDispatchEnabled;
        }

        try {
            await fs.rm(TEST_MISSIONS_DIR, { recursive: true, force: true });
        } catch (_) {
            // ignore
        }
    });

    describe('1. Mission Creation', () => {
        it('should create mission with workflow', async () => {
            const mission = await missionManager.createMission({
                title: 'Write Rust Book',
                description: 'A technical book on Rust',
                templateId: 'book_writing',
                params: {
                    topic: 'Rust',
                    num_chapters: 5,
                    target_pages: 200
                }
            });

            assert.ok(mission);
            assert.ok(mission.id.startsWith('mission-'));
            assert.strictEqual(mission.status, MISSION_STATUS.PENDING);
            assert.strictEqual(mission.workflow.steps.length, 7);
        });
    });

    describe('2. Mission CRUD', () => {
        it('should read created mission', async () => {
            const created = await missionManager.createMission({
                title: 'Test',
                description: 'Desc',
                templateId: 'book_writing',
                params: { topic: 'Go', num_chapters: 5 }
            });

            const retrieved = await missionManager.getMission(created.id);

            assert.ok(retrieved);
            assert.strictEqual(retrieved.id, created.id);
        });

        it('should list missions', async () => {
            await missionManager.createMission({
                title: 'Mission 1',
                description: 'Desc',
                templateId: 'book_writing',
                params: { topic: 'Topic1', num_chapters: 5 }
            });

            await missionManager.createMission({
                title: 'Mission 2',
                description: 'Desc',
                templateId: 'book_writing',
                params: { topic: 'Topic2', num_chapters: 5 }
            });

            const missions = await missionManager.listMissions();
            assert.strictEqual(missions.length, 2);
        });

        it('should delete mission', async () => {
            const created = await missionManager.createMission({
                title: 'Delete me',
                description: 'Desc',
                templateId: 'book_writing',
                params: { topic: 'DeleteTopic', num_chapters: 5 }
            });

            await missionManager.deleteMission(created.id);

            const retrieved = await missionManager.getMission(created.id);
            assert.strictEqual(retrieved, null);
        });
    });

    describe('3. Mission Execution', () => {
        it('should execute mission and send first task to kernel', async () => {
            const created = await missionManager.createMission({
                title: 'Execute Test',
                description: 'Test execution',
                templateId: 'book_writing',
                params: { topic: 'Python', num_chapters: 5 }
            });

            await missionManager.executeMission(created.id);

            await waitForCondition(() => kernel.executedTasks.length >= 1, { timeoutMs: 2000 });

            assert.strictEqual(kernel.executedTasks.length, 1);

            const executedTask = kernel.executedTasks[0].task;
            assert.strictEqual(executedTask.meta.mission_id, created.id);
            assert.strictEqual(executedTask.meta.step_id, 'step-1-outline');

            const state = await missionManager.getMission(created.id);
            assert.strictEqual(state.status, MISSION_STATUS.RUNNING);
        });

        it('should ignore duplicate completion events for same task', async () => {
            const created = await missionManager.createMission({
                title: 'Dedup Test',
                description: 'Ensure same event is processed once',
                templateId: 'book_writing',
                params: { topic: 'Node.js', num_chapters: 5 }
            });

            await missionManager.executeMission(created.id);

            await waitForCondition(() => kernel.executedTasks.length >= 1, { timeoutMs: 2000 });

            const firstTask = kernel.executedTasks[0].task;

            const envelope = buildTaskEnvelope({
                actionCode: ActionCode.DRIVER_TASK_COMPLETED,
                missionId: created.id,
                taskId: firstTask.meta.id,
                stepId: firstTask.meta.step_id,
                result: { output: 'step result' }
            });

            nerv.receive(envelope);
            nerv.receive(envelope); // duplicado

            // Espera o próximo step disparar (apenas 1 vez)
            await waitForCondition(() => kernel.executedTasks.length >= 2, { timeoutMs: 2000 });

            const state = await missionManager.getMission(created.id);
            assert.strictEqual(state.progress.current_step, 1, 'Step deve avançar apenas uma vez');
            assert.strictEqual(state.progress.completed_tasks, 1, 'Task completada contabilizada apenas uma vez');
            assert.strictEqual(kernel.executedTasks.length, 2, 'Somente próximo step deve ser disparado uma vez');
        });

        it('should ignore late events after mission is paused', async () => {
            const created = await missionManager.createMission({
                title: 'Late Event Test',
                description: 'Ignore events when inactive',
                templateId: 'book_writing',
                params: { topic: 'Kotlin', num_chapters: 5 }
            });

            await missionManager.executeMission(created.id);

            await waitForCondition(() => kernel.executedTasks.length >= 1, { timeoutMs: 2000 });

            const firstTask = kernel.executedTasks[0].task;

            await missionManager.pauseMission(created.id);

            nerv.receive(
                buildTaskEnvelope({
                    actionCode: ActionCode.DRIVER_TASK_COMPLETED,
                    missionId: created.id,
                    taskId: firstTask.meta.id,
                    stepId: firstTask.meta.step_id,
                    result: { output: 'should be ignored' }
                })
            );

            await new Promise(resolve => setTimeout(resolve, 50));

            const state = await missionManager.getMission(created.id);
            assert.strictEqual(state.progress.current_step, 0, 'Progresso não deve avançar com missão pausada');
            assert.strictEqual(kernel.executedTasks.length, 1, 'Nenhum novo step deve ser disparado');
        });
    });

    describe('4. Pause & Resume', () => {
        it('should pause mission', async () => {
            const created = await missionManager.createMission({
                title: 'Pause Test',
                description: 'Test',
                templateId: 'book_writing',
                params: { topic: 'Java', num_chapters: 5 }
            });

            await missionManager.executeMission(created.id);
            await missionManager.pauseMission(created.id);

            const state = await missionManager.getMission(created.id);
            assert.strictEqual(state.status, MISSION_STATUS.PAUSED);
        });

        it('should resume paused mission', async () => {
            const created = await missionManager.createMission({
                title: 'Resume Test',
                description: 'Test',
                templateId: 'book_writing',
                params: { topic: 'C++', num_chapters: 5 }
            });

            await missionManager.executeMission(created.id);
            await missionManager.pauseMission(created.id);
            await missionManager.resumeMission(created.id);

            const state = await missionManager.getMission(created.id);
            assert.strictEqual(state.status, MISSION_STATUS.RUNNING);
        });
    });

    describe('5. Feedback Injection', () => {
        it('should add feedback to mission', async () => {
            const created = await missionManager.createMission({
                title: 'Feedback Test',
                description: 'Test',
                templateId: 'book_writing',
                params: { topic: 'Ruby', num_chapters: 5 }
            });

            await missionManager.addFeedback(created.id, 'Please add more code examples');

            const state = await missionManager.getMission(created.id);
            assert.strictEqual(state.feedback.length, 1);
            assert.strictEqual(state.feedback[0].content, 'Please add more code examples');
        });
    });

    describe('6. Progress Tracking', () => {
        it('should return mission progress', async () => {
            const created = await missionManager.createMission({
                title: 'Progress Test',
                description: 'Test',
                templateId: 'book_writing',
                params: { topic: 'Swift', num_chapters: 5 }
            });

            const progress = await missionManager.getMissionProgress(created.id);

            assert.ok(progress);
            assert.strictEqual(progress.mission_id, created.id);
            assert.strictEqual(progress.status, MISSION_STATUS.PENDING);
            assert.strictEqual(progress.progress.percent, 0);
        });
    });
});
