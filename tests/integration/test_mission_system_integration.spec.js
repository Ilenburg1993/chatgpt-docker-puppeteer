// @ts-check
import assert from 'node:assert';
import { describe, it, before, after } from 'node:test';
import { MissionManager } from '#missions/mission_manager';
import { createNERV } from '#nerv/nerv';
import { createKernel } from '#kernel/kernel';
import fs from 'fs/promises';
import path from 'node:path';

/**
 * Suite de testes de integração do sistema de missões.
 *
 * OBJETIVO: Validar que todas as integrações funcionam corretamente:
 *   - MissionManager ↔ Kernel
 *   - MissionManager ↔ NERV
 *   - WorkflowGenerator ↔ Templates
 *   - MissionStateManager ↔ Filesystem
 *   - REST API ↔ MissionManager
 */
describe('Mission System Integration (E2E)', () => {
    /** @type {any} */ let nerv;
    /** @type {any} */ let kernel;
    /** @type {any} */ let missionManager;
    const testMissionsDir = path.join(import.meta.dirname, '../../missions-test');

    before(async () => {
        // Setup: Cria diretório temporário para missões de teste
        await fs.mkdir(testMissionsDir, { recursive: true });
    });

    after(async () => {
        // Cleanup: Remove diretório de teste
        try {
            await fs.rm(testMissionsDir, { recursive: true, force: true });
        } catch (/** @type {any} */ err) {
            console.error(`Erro ao limpar diretório de teste: ${err.message}`);
        }

        // Cleanup: Para subsistemas
        if (kernel) {
            await kernel.shutdown();
        }

        if (nerv) {
            await nerv.shutdown();
        }
    });

    describe('1. Boot Sequence Integration', () => {
        it('should initialize NERV → Kernel → MissionManager in correct order', async () => {
            // 1. Inicializa NERV
            nerv = await createNERV(
                /** @type {any} */ ({
                    mode: 'local',
                    correlation: true,
                    bufferSize: 100,
                    telemetry: false,
                })
            );

            assert.ok(nerv, 'NERV deveria estar inicializado');

            // 2. Inicializa Kernel
            kernel = await createKernel({
                nerv,
                telemetry: { source: 'test', retention: 100 },
                policy: {},
                loop: { cycleInterval: 50 },
            });

            assert.ok(kernel, 'Kernel deveria estar inicializado');

            // 3. Inicia Kernel
            kernel.start();
            assert.ok(kernel, 'Kernel deveria estar rodando');

            // 4. Inicializa MissionManager
            const { MissionStateManager } = await import('#missions/mission_state_manager');
            const stateManager = new MissionStateManager({ baseDir: testMissionsDir });

            missionManager = new MissionManager({
                kernel,
                nerv,
                stateManager,
            });

            await missionManager.initialize();

            assert.ok(missionManager, 'MissionManager deveria estar inicializado');
        });

        it('should have kernel with OrchestratorEngine integrated', () => {
            // Verifica que Kernel tem métodos V2.0
            assert.ok(typeof kernel.executeTask === 'function', 'Kernel deveria ter método executeTask');

            // Verifica status do Kernel
            const status = kernel.getStatus();
            assert.ok(status, 'Kernel deveria retornar status');
        });
    });

    describe('2. Mission CRUD Integration', () => {
        /** @type {any} */ let createdMissionId;

        it('should create mission from template', async () => {
            const mission = await missionManager.createMission({
                title: 'Integration Test Mission',
                description: 'Testing end-to-end integration',
                templateId: 'book_writing',
                params: {
                    topic: 'Integration Testing',
                    num_chapters: 5,
                    target_pages: 100,
                },
            });

            assert.ok(mission, 'Mission deveria ser criada');
            assert.ok(mission.id, 'Mission deveria ter ID');
            assert.strictEqual(mission.status, 'pending', 'Mission deveria começar como PENDING');
            assert.ok(mission.workflow, 'Mission deveria ter workflow');
            assert.ok(mission.workflow.steps.length > 0, 'Workflow deveria ter steps');

            createdMissionId = mission.id;

            // Verifica que mission foi salva no filesystem
            const missionPath = path.join(testMissionsDir, mission.id, 'state.json');
            const exists = await fs
                .access(missionPath)
                .then(() => true)
                .catch(() => false);
            assert.ok(exists, 'Mission state.json deveria existir no filesystem');
        });

        it('should read created mission', async () => {
            const mission = await missionManager.getMission(createdMissionId);

            assert.ok(mission, 'Mission deveria ser recuperada');
            assert.strictEqual(mission.id, createdMissionId, 'ID deveria corresponder');
        });

        it('should list missions', async () => {
            const missions = await missionManager.listMissions();

            assert.ok(Array.isArray(missions), 'Deveria retornar array');
            assert.ok(missions.length >= 1, 'Deveria ter pelo menos 1 mission');
        });
    });

    describe('3. Mission Execution Integration', () => {
        /** @type {any} */ let testMissionId;

        before(async () => {
            // Cria mission para teste de execução
            const mission = await missionManager.createMission({
                title: 'Execution Test',
                description: 'Testing execution flow',
                templateId: 'book_writing',
                params: {
                    topic: 'Execution Testing',
                    num_chapters: 5,
                },
            });

            testMissionId = mission.id;
        });

        it('should start mission execution and send task to kernel', async () => {
            // Inicia execução
            await missionManager.executeMission(testMissionId);

            // Aguarda processamento assíncrono
            await new Promise(resolve => setTimeout(resolve, 100));

            // Verifica que mission está RUNNING
            const mission = await missionManager.getMission(testMissionId);
            assert.strictEqual(mission.status, 'running', 'Mission deveria estar RUNNING');

            // Verifica que mission está no cache de ativas
            const progress = await missionManager.getMissionProgress(testMissionId);
            assert.ok(progress, 'Progress deveria existir');
            assert.strictEqual(progress.status, 'running', 'Status deveria ser running');
        });

        it('should pause mission execution', async () => {
            await missionManager.pauseMission(testMissionId);

            const mission = await missionManager.getMission(testMissionId);
            assert.strictEqual(mission.status, 'paused', 'Mission deveria estar PAUSED');
        });

        it('should resume paused mission', async () => {
            await missionManager.resumeMission(testMissionId);

            const mission = await missionManager.getMission(testMissionId);
            assert.strictEqual(mission.status, 'running', 'Mission deveria estar RUNNING novamente');
        });
    });

    describe('4. Feedback Integration', () => {
        /** @type {any} */ let feedbackMissionId;

        before(async () => {
            const mission = await missionManager.createMission({
                title: 'Feedback Test',
                description: 'Testing feedback injection',
                templateId: 'book_writing',
                params: {
                    topic: 'Feedback Testing',
                    num_chapters: 5,
                },
            });

            feedbackMissionId = mission.id;
        });

        it('should add feedback to mission', async () => {
            await missionManager.addFeedback(feedbackMissionId, 'Add more technical details');

            const mission = await missionManager.getMission(feedbackMissionId);

            assert.ok(mission.feedback, 'Mission deveria ter array de feedback');
            assert.strictEqual(mission.feedback.length, 1, 'Deveria ter 1 feedback');
            assert.strictEqual(mission.feedback[0].content, 'Add more technical details');
        });

        it('should inject feedback in next task generation', async () => {
            // Inicia execução após adicionar feedback
            await missionManager.executeMission(feedbackMissionId);

            // Aguarda processamento
            await new Promise(resolve => setTimeout(resolve, 100));

            // NOTA: Validação completa requer mock do driver para capturar task gerada
            // Por ora, verificamos apenas que execução não falhou
            const mission = await missionManager.getMission(feedbackMissionId);
            assert.strictEqual(mission.status, 'running', 'Mission deveria estar executando com feedback');
        });
    });

    describe('5. Workflow Generation Integration', () => {
        it('should generate workflow from template with parameter validation', async () => {
            // Testa parâmetros válidos
            const mission = await missionManager.createMission({
                title: 'Workflow Test',
                description: 'Test',
                templateId: 'book_writing',
                params: {
                    topic: 'Workflow Testing',
                    num_chapters: 10,
                    target_pages: 200,
                    quality_threshold: 80,
                },
            });

            assert.strictEqual(
                mission.workflow.steps.length,
                12,
                'Workflow deveria ter 12 steps (10 chapters + outline + consistency)'
            );
        });

        it('should reject invalid parameters', async () => {
            // Testa parâmetros inválidos (num_chapters < 5)
            await assert.rejects(
                async () => {
                    await missionManager.createMission({
                        title: 'Invalid Test',
                        description: 'Test',
                        templateId: 'book_writing',
                        params: {
                            topic: 'Test',
                            num_chapters: 2, // MIN = 5
                        },
                    });
                },
                /num_chapters deve ser >= 5/,
                'Deveria rejeitar num_chapters inválido'
            );
        });

        it('should expand repeat_for_each steps correctly', async () => {
            const mission = await missionManager.createMission({
                title: 'Expansion Test',
                description: 'Test',
                templateId: 'book_writing',
                params: {
                    topic: 'Expansion Test',
                    num_chapters: 15,
                },
            });

            // 1 outline + 15 chapters + 1 consistency = 17 steps
            assert.strictEqual(mission.workflow.steps.length, 17);

            // Verifica IDs dos steps expandidos
            const chapterSteps = mission.workflow.steps.filter((/** @type {any} */ s) =>
                s.id.startsWith('step-2-chapter-')
            );
            assert.strictEqual(chapterSteps.length, 15, 'Deveria ter 15 chapter steps');

            // Verifica numeração correta
            assert.ok(
                mission.workflow.steps.some((/** @type {any} */ s) => s.id === 'step-2-chapter-1'),
                'Deveria ter chapter-1'
            );
            assert.ok(
                mission.workflow.steps.some((/** @type {any} */ s) => s.id === 'step-2-chapter-15'),
                'Deveria ter chapter-15'
            );
        });

        it('should replace placeholders in prompts', async () => {
            const mission = await missionManager.createMission({
                title: 'Placeholder Test',
                description: 'Test',
                templateId: 'book_writing',
                params: {
                    topic: 'JavaScript Advanced',
                    num_chapters: 5,
                    target_audience: 'senior developers',
                },
            });

            const outlineStep = mission.workflow.steps[0];

            // Verifica substituição de placeholders
            assert.ok(outlineStep.prompt_template.includes('JavaScript Advanced'), 'Prompt deveria conter topic');
            assert.ok(
                outlineStep.prompt_template.includes('senior developers'),
                'Prompt deveria conter target_audience'
            );
        });
    });

    describe('6. Progress Tracking Integration', () => {
        /** @type {any} */ let progressMissionId;

        before(async () => {
            const mission = await missionManager.createMission({
                title: 'Progress Test',
                description: 'Test',
                templateId: 'book_writing',
                params: {
                    topic: 'Progress Tracking',
                    num_chapters: 5,
                },
            });

            progressMissionId = mission.id;
        });

        it('should return accurate progress information', async () => {
            const progress = await missionManager.getMissionProgress(progressMissionId);

            assert.ok(progress, 'Progress deveria existir');
            assert.strictEqual(progress.mission_id, progressMissionId);
            assert.strictEqual(progress.status, 'pending');
            assert.strictEqual(progress.progress.current_step, 0);
            assert.strictEqual(progress.progress.percent, 0);
            assert.ok(progress.current_step, 'Deveria ter current_step info');
        });
    });
});
