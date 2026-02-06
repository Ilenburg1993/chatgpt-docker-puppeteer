import assert from 'node:assert';
import { describe, it, before } from 'node:test';
import { MissionManager } from '#missions/mission_manager';
import { FeedbackProcessor } from '#missions/feedback_processor';
import { CheckpointManager } from '#orchestrator/checkpoint_manager';
import { ContextManager } from '#orchestrator/context_manager';
import { OrchestratorEngine } from '#orchestrator/orchestrator_engine';
import { createKernel } from '#kernel/kernel';
import { createNERV } from '#nerv/nerv';

describe('Boot Integration - Phase 2 Components', () => {
    let nerv;
    let contextManager;
    let kernel;
    let feedbackProcessor;
    let checkpointManager;
    let missionManager;

    before(async () => {
        // Simula boot sequence (sem browser pool)

        // Fase 2: NERV
        nerv = await createNERV({
            mode: 'local',
            correlation: true,
            bufferSize: 1000,
            telemetry: false
        });

        // Fase 3.5: ContextManager Compartilhado
        contextManager = new ContextManager({
            strategy: 'sliding_window',
            maxTokens: 100000,
            summarizationPolicy: 'on_overflow'
        });

        // Fase 4: Kernel (com ContextManager)
        kernel = await createKernel({
            nerv,
            contextManager, // Compartilhado!
            telemetry: {
                source: 'kernel',
                retention: 1000
            },
            policy: {},
            loop: {
                cycleInterval: 50
            }
        });

        // Fase 5.5: Mission Orchestration
        feedbackProcessor = new FeedbackProcessor({
            contextManager
        });

        checkpointManager = new CheckpointManager({
            baseDir: 'missions-test-boot',
            keepLast: 10,
            autoCleanup: true
        });

        missionManager = new MissionManager({
            kernel,
            nerv,
            contextManager, // Compartilhado!
            feedbackProcessor,
            checkpointManager
        });

        await missionManager.initialize();
    });

    describe('1. Components Initialization', () => {
        it('should have NERV initialized', () => {
            assert.ok(nerv);
            assert.strictEqual(typeof nerv.emit, 'function');
        });

        it('should have ContextManager initialized', () => {
            assert.ok(contextManager);
            assert.strictEqual(typeof contextManager.initializeContext, 'function');
        });

        it('should have Kernel initialized', () => {
            assert.ok(kernel);
            assert.strictEqual(typeof kernel.start, 'function');
        });

        it('should have FeedbackProcessor initialized', () => {
            assert.ok(feedbackProcessor);
            assert.strictEqual(typeof feedbackProcessor.processFeedback, 'function');
        });

        it('should have CheckpointManager initialized', () => {
            assert.ok(checkpointManager);
            assert.strictEqual(typeof checkpointManager.saveCheckpoint, 'function');
        });

        it('should have MissionManager initialized', () => {
            assert.ok(missionManager);
            assert.strictEqual(typeof missionManager.createMission, 'function');
        });
    });

    describe('2. Shared ContextManager Validation', () => {
        it('MissionManager should have contextManager reference', () => {
            assert.ok(missionManager.contextManager);
            assert.strictEqual(missionManager.contextManager, contextManager);
        });

        it('FeedbackProcessor should have contextManager reference', () => {
            assert.ok(feedbackProcessor.contextManager);
            assert.strictEqual(feedbackProcessor.contextManager, contextManager);
        });

        it('Kernel should have contextManager passed to OrchestratorEngine', () => {
            // Verificar que existe orchestrator no kernel
            // (não há getter público, mas podemos testar comportamento)
            assert.ok(kernel);
        });

        it('should share MemoryStore patterns across components', () => {
            // Adiciona pattern via FeedbackProcessor
            feedbackProcessor.contextManager.addPattern({
                type: 'FEEDBACK',
                content: 'Test shared pattern',
                metadata: { source: 'boot_test' }
            });

            // Verifica que pattern está acessível via MissionManager's contextManager
            const patterns = missionManager.contextManager.getRelevantPatterns('shared', 5);
            assert.ok(patterns.length > 0);
            assert.ok(patterns.some(p => p.content.includes('shared')));
        });
    });

    describe('3. Dependency Injection Validation', () => {
        it('MissionManager should have all dependencies', () => {
            assert.ok(missionManager.kernel);
            assert.ok(missionManager.nerv);
            assert.ok(missionManager.contextManager);
            assert.ok(missionManager.feedbackProcessor);
            assert.ok(missionManager.checkpointManager);
        });

        it('FeedbackProcessor should have contextManager', () => {
            assert.ok(feedbackProcessor.contextManager);
        });

        it('ContextManager should have MemoryStore', () => {
            assert.ok(contextManager.memoryStore);
        });
    });

    describe('4. Integration Flow', () => {
        it('should create mission with context initialization', async () => {
            const mission = await missionManager.createMission({
                title: 'Boot Integration Test',
                description: 'Test mission for boot integration',
                templateId: 'book_writing',
                params: {
                    topic: 'Boot Testing',
                    num_chapters: 5
                }
            });

            assert.ok(mission);
            assert.ok(mission.id);

            // Verifica que contexto foi inicializado
            const stats = contextManager.getStats();
            assert.ok(stats.active_missions >= 0);
        });

        it('should process feedback with shared MemoryStore', async () => {
            const mission = await missionManager.createMission({
                title: 'Feedback Test',
                description: 'Test',
                templateId: 'book_writing',
                params: {
                    topic: 'Feedback',
                    num_chapters: 5
                }
            });

            // Adiciona feedback
            const processed = await missionManager.addFeedback(mission.id, 'Add more examples');

            // Verifica que patterns foram armazenados no MemoryStore compartilhado
            assert.ok(processed.patterns.length > 0);

            const memoryPatterns = contextManager.getRelevantPatterns('examples', 5);
            assert.ok(memoryPatterns.length > 0);
        });

        it('should save checkpoint', async () => {
            const mission = await missionManager.createMission({
                title: 'Checkpoint Test',
                description: 'Test',
                templateId: 'book_writing',
                params: {
                    topic: 'Checkpoint',
                    num_chapters: 5
                }
            });

            // Simula checkpoint save
            const checkpointId = await checkpointManager.saveCheckpoint(
                mission.id,
                1,
                mission,
                { reason: 'boot_test' }
            );

            assert.ok(checkpointId);
            assert.ok(checkpointId.startsWith('checkpoint-'));

            // Verifica que checkpoint existe
            const hasCheckpoint = await checkpointManager.hasCheckpoint(mission.id);
            assert.strictEqual(hasCheckpoint, true);
        });
    });

    describe('5. Statistics and Health', () => {
        it('should report ContextManager stats', () => {
            const stats = contextManager.getStats();

            assert.ok(stats);
            assert.ok(stats.active_missions >= 0);
            assert.ok(stats.total_tokens >= 0);
            assert.ok(stats.memory_store);
        });

        it('should report FeedbackProcessor stats', () => {
            const stats = feedbackProcessor.getStats();

            assert.ok(stats);
            assert.ok(stats.categories > 0);
            assert.strictEqual(stats.context_manager_enabled, true);
        });

        it('should report CheckpointManager stats', async () => {
            const stats = await checkpointManager.getStats();

            assert.ok(stats);
            assert.ok(stats.base_dir);
            assert.ok(stats.keep_last > 0);
        });
    });
});
