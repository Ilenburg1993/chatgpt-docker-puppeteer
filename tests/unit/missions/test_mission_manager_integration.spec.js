/**
 * @file tests/unit/missions/test_mission_manager_integration.spec.js
 * Testes de integração Mission Manager + MissionStateManager + WorkflowGenerator
 * FASE 4 - Mission Orchestration Platform V2.0
 */

// Activate module aliases FIRST
require('module-alias/register');

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs/promises');
const path = require('path');
const EventEmitter = require('events');
const { MissionStateManager, MISSION_STATUS } = require('../../../src/missions/mission_state_manager');
const { WorkflowGenerator } = require('../../../src/missions/workflow_generator');
const { MissionManager } = require('../../../src/missions/mission_manager');
const { ActionCode, MessageType } = require('../../../src/shared/nerv/constants');

// Diretórios de teste
const TEST_MISSIONS_DIR = path.join(__dirname, '../../tmp/missions');
const TEST_TEMPLATES_DIR = path.join(__dirname, '../../../src/missions/templates');

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

describe('MissionStateManager (filesystem persistence)', () => {
    let stateManager;

    beforeEach(async () => {
        stateManager = new MissionStateManager({ baseDir: TEST_MISSIONS_DIR });
        await stateManager.initialize();
    });

    afterEach(async () => {
        // Limpa diretório de teste
        try {
            await fs.rm(TEST_MISSIONS_DIR, { recursive: true, force: true });
        } catch (err) {
            // Ignora se não existir
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

            // Verifica estrutura de diretórios
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
            // Cria 3 missões
            await stateManager.createMission({
                id: 'mission-a',
                title: 'A',
                description: 'A',
                workflow: { steps: [] },
                config: {}
            });

            await stateManager.createMission({
                id: 'mission-b',
                title: 'B',
                description: 'B',
                workflow: { steps: [] },
                config: {}
            });

            // Atualiza uma para RUNNING
            await stateManager.updateMission('mission-b', {
                status: MISSION_STATUS.RUNNING
            });

            // Lista todas
            const all = await stateManager.listMissions();
            assert.strictEqual(all.length, 2);

            // Filtra por status
            const running = await stateManager.listMissions({ status: MISSION_STATUS.RUNNING });
            assert.strictEqual(running.length, 1);
            assert.strictEqual(running[0].id, 'mission-b');
        });

        it('should update mission and add history event', async () => {
            await stateManager.createMission({
                id: 'mission-update',
                title: 'Test',
                description: 'Test',
                workflow: { steps: [] },
                config: {}
            });

            const updated = await stateManager.updateMission('mission-update', {
                status: MISSION_STATUS.RUNNING
            });

            assert.strictEqual(updated.status, MISSION_STATUS.RUNNING);
            assert.ok(updated.updated_at !== updated.created_at);

            // Verifica histórico
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
                workflow: { steps: [] },
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
                workflow: { steps: [] },
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
                workflow: { steps: [] },
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
                workflow: { steps: [] },
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
                workflow: { steps: [] },
                config: {}
            });

            await stateManager.addFeedback('mission-feedback', 'Please add more examples');

            const state = await stateManager.getMission('mission-feedback');
            assert.strictEqual(state.feedback.length, 1);
            assert.strictEqual(state.feedback[0].content, 'Please add more examples');

            // Verifica histórico
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
            await assert.rejects(
                generator.loadTemplate('does_not_exist'),
                /ENOENT/
            );
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

            // Valida que steps foram expandidos
            // Template tem repeat_for_each para chapters → deve expandir para num_chapters
            // Default: 15 chapters + outline + consistency = 17 steps
            assert.strictEqual(workflow.steps.length, 17, 'Workflow deve ter 17 steps');
        });

        it('should expand repeat_for_each steps', async () => {
            const workflow = await generator.generateWorkflow('book_writing', {
                topic: 'Python',
                num_chapters: 5 // Sobrescreve default de 15
            });

            // 5 chapters + outline + consistency = 7 steps
            assert.strictEqual(workflow.steps.length, 7);
        });

        it('should replace placeholders in prompts', async () => {
            const workflow = await generator.generateWorkflow('book_writing', {
                topic: 'JavaScript',
                num_chapters: 5,
                target_audience: 'beginners'
            });

            // Verifica step 0 (outline)
            const outlineStep = workflow.steps[0];
            assert.ok(outlineStep.prompt_template.includes('JavaScript'), 'Prompt deve conter topic');
            assert.ok(outlineStep.prompt_template.includes('beginners'), 'Prompt deve conter target_audience');
        });

        it('should validate required params', async () => {
            await assert.rejects(
                generator.generateWorkflow('book_writing', {}), // Falta 'topic' que é required
                /Parâmetro obrigatório ausente: topic/
            );
        });

        it('should validate param ranges', async () => {
            await assert.rejects(
                generator.generateWorkflow('book_writing', {
                    topic: 'Rust',
                    num_chapters: 100 // Excede max: 50
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

    beforeEach(async () => {
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
        missionManager.cleanup();

        try {
            await fs.rm(TEST_MISSIONS_DIR, { recursive: true, force: true });
        } catch (err) {
            // Ignora
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
            assert.strictEqual(mission.workflow.steps.length, 7); // 5 chapters + outline + consistency
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

            // Aguarda processamento assíncrono
            await new Promise(resolve => setTimeout(resolve, 50));

            // Verifica que task foi enviada ao Kernel
            assert.strictEqual(kernel.executedTasks.length, 1);

            const executedTask = kernel.executedTasks[0].task;
            assert.strictEqual(executedTask.meta.mission_id, created.id);
            assert.strictEqual(executedTask.meta.step_id, 'step-1-outline'); // Primeiro step

            // Verifica que status foi atualizado para RUNNING
            const state = await missionManager.getMission(created.id);
            assert.strictEqual(state.status, MISSION_STATUS.RUNNING);
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
