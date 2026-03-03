// @ts-check
import assert from 'node:assert';
import { describe, it, before, after } from 'node:test';
import { ContextManager, CHUNKING_STRATEGY } from '#orchestrator/context_manager';
import { MissionManager } from '#missions/mission_manager';
import { MissionStateManager } from '#missions/mission_state_manager';
import path from 'node:path';
import fs from 'fs/promises';

describe('Context Flow Integration Tests', () => {
    let contextManager;
    let missionManager;
    let testMissionsDir;

    // Mock dependencies
    const mockKernel = {
        executeTask: async (task, correlationId) => {
            // Mock: retorna sucesso
            return { status: 'queued', task_id: task.meta.id };
        },
    };

    const mockNERV = {
        onReceive: () => {},
        emit: () => {},
        emitCommand: () => {},
        emitEvent: () => {},
    };

    before(async () => {
        testMissionsDir = path.join(import.meta.dirname, '../../missions-test-context');
        await fs.mkdir(testMissionsDir, { recursive: true });

        // Cria ContextManager compartilhado
        contextManager = new ContextManager({
            chunkingStrategy: CHUNKING_STRATEGY.SLIDING_WINDOW,
            windowSize: 5,
        });

        // Cria MissionManager com ContextManager
        const stateManager = new MissionStateManager({ baseDir: testMissionsDir });
        missionManager = new MissionManager({
            kernel: mockKernel,
            nerv: mockNERV,
            stateManager,
            contextManager,
        });

        await missionManager.initialize();
    });

    after(async () => {
        await fs.rm(testMissionsDir, { recursive: true, force: true });
        contextManager.cleanup();
        missionManager.cleanup();
    });

    describe('1. Context Initialization on Mission Creation', () => {
        it('should initialize context when mission is created', async () => {
            const mission = await missionManager.createMission({
                title: 'Test Mission',
                description: 'Test',
                templateId: 'book_writing',
                params: {
                    topic: 'Context Testing',
                    num_chapters: 5,
                },
            });

            // Verifica que contexto foi inicializado
            const context = contextManager.getContextForStep(mission.id, 'step-1');

            assert.ok(context);
            assert.strictEqual(context.steps.length, 0); // Nenhum step executado ainda
            assert.ok(context.metadata.template === 'book_writing');
        });
    });

    describe('2. Context Accumulation During Execution', () => {
        let testMissionId;

        before(async () => {
            const mission = await missionManager.createMission({
                title: 'Accumulation Test',
                description: 'Test context accumulation',
                templateId: 'book_writing',
                params: {
                    topic: 'Accumulation',
                    num_chapters: 5,
                },
            });

            testMissionId = mission.id;
        });

        it('should accumulate context as steps complete', async () => {
            // Simula outputs de 3 steps
            await contextManager.addStepOutput(
                testMissionId,
                'step-1',
                'Chapter outline: Introduction, Chapter 1, Chapter 2'
            );
            await contextManager.addStepOutput(
                testMissionId,
                'step-2',
                'Chapter 1: This is the first chapter about Accumulation'
            );
            await contextManager.addStepOutput(testMissionId, 'step-3', 'Chapter 2: This continues the topic');

            // Obtém contexto para step 4
            const context = contextManager.getContextForStep(testMissionId, 'step-4');

            // Deve ter 3 steps acumulados
            assert.strictEqual(context.steps.length, 3);
            assert.strictEqual(context.steps[0].step_id, 'step-1');
            assert.strictEqual(context.steps[2].step_id, 'step-3');
        });

        it('should apply sliding window chunking', async () => {
            // Adiciona mais 5 steps (total 8)
            await contextManager.addStepOutput(testMissionId, 'step-4', 'Chapter 3: Content here');
            await contextManager.addStepOutput(testMissionId, 'step-5', 'Chapter 4: More content');
            await contextManager.addStepOutput(testMissionId, 'step-6', 'Chapter 5: Final content');
            await contextManager.addStepOutput(testMissionId, 'step-7', 'Review: All good');
            await contextManager.addStepOutput(testMissionId, 'step-8', 'Consistency check: OK');

            // Obtém contexto (windowSize=5)
            const context = contextManager.getContextForStep(testMissionId, 'step-9');

            // Deve ter apenas últimos 5 steps
            assert.strictEqual(context.steps.length, 5);
            assert.strictEqual(context.steps[0].step_id, 'step-4');
            assert.strictEqual(context.steps[4].step_id, 'step-8');
            assert.strictEqual(context.metadata.total_steps, 8);
        });
    });

    describe('3. Context in Task Generation', () => {
        let testMissionId;

        before(async () => {
            const mission = await missionManager.createMission({
                title: 'Task Generation Test',
                description: 'Test context in task prompts',
                templateId: 'book_writing',
                params: {
                    topic: 'Prompts',
                    num_chapters: 5,
                },
            });

            testMissionId = mission.id;

            // Adiciona contexto
            await contextManager.addStepOutput(testMissionId, 'step-1', 'Outline: Intro, Chapter 1, Chapter 2');
            await contextManager.addStepOutput(testMissionId, 'step-2', 'Chapter 1: AI fundamentals');
        });

        it('should include context in generated task prompt', async () => {
            const mission = await missionManager.getMission(testMissionId);

            // Simula geração de task (pega step 3)
            const step = mission.workflow.steps[2]; // step-2-chapter-1
            const taskV5 = missionManager._generateTaskV5FromStep(step, mission);

            const prompt = taskV5.spec.payload.user_message;

            // Prompt deve conter contexto
            assert.ok(prompt.includes('[RECENT STEPS]'), 'Prompt should include recent steps context');
            assert.ok(prompt.includes('step-1') || prompt.includes('step-2'), 'Prompt should reference previous steps');
        });
    });

    describe('4. Context Cleanup', () => {
        it('should clear context when mission completes', async () => {
            const mission = await missionManager.createMission({
                title: 'Cleanup Test',
                description: 'Test',
                templateId: 'book_writing',
                params: {
                    topic: 'Cleanup',
                    num_chapters: 5,
                },
            });

            // Adiciona contexto
            await contextManager.addStepOutput(mission.id, 'step-1', 'Output');

            // Verifica que existe
            let context = contextManager.getContextForStep(mission.id, 'step-2');
            assert.ok(context);

            // Simula completar missão
            await missionManager._completeMission(mission.id);

            // Verifica que contexto foi limpo
            context = contextManager.getContextForStep(mission.id, 'step-2');
            assert.strictEqual(context, null);
        });

        it('should clear context when mission fails', async () => {
            const mission = await missionManager.createMission({
                title: 'Fail Test',
                description: 'Test',
                templateId: 'book_writing',
                params: {
                    topic: 'Fail',
                    num_chapters: 5,
                },
            });

            await contextManager.addStepOutput(mission.id, 'step-1', 'Output');

            // Simula falha
            await missionManager._failMission(mission.id, 'Test failure');

            // Verifica que contexto foi limpo
            const context = contextManager.getContextForStep(mission.id, 'step-2');
            assert.strictEqual(context, null);
        });
    });

    describe('5. Memory Store Integration', () => {
        it('should add patterns from feedback to memory store', () => {
            const pattern = {
                type: 'feedback',
                content: 'Add more technical details and code examples',
                metadata: { source: 'user' },
            };

            contextManager.addPattern(pattern);

            const results = contextManager.getRelevantPatterns('technical', 5);

            assert.ok(results.length > 0);
            assert.ok(results[0].content.includes('technical'));
        });

        it('should retrieve patterns for similar contexts', () => {
            // Adiciona vários patterns
            contextManager.addPattern({ type: 'success', content: 'Clear explanations worked well' });
            contextManager.addPattern({ type: 'feedback', content: 'Need more examples' });
            contextManager.addPattern({ type: 'feedback', content: 'Improve code quality' });

            const results = contextManager.getRelevantPatterns('code quality', 3);

            assert.ok(results.length > 0);
            // Deve priorizar patterns com "code" e "quality"
            const hasRelevant = results.some(p => p.content.toLowerCase().includes('code'));
            assert.ok(hasRelevant);
        });
    });

    describe('6. Context Statistics', () => {
        it('should provide accurate context stats', async () => {
            // Cria 2 missões
            const mission1 = await missionManager.createMission({
                title: 'Stats Test 1',
                description: 'Test',
                templateId: 'book_writing',
                params: { topic: 'Stats1', num_chapters: 5 },
            });

            const mission2 = await missionManager.createMission({
                title: 'Stats Test 2',
                description: 'Test',
                templateId: 'book_writing',
                params: { topic: 'Stats2', num_chapters: 5 },
            });

            // Adiciona contexto
            await contextManager.addStepOutput(mission1.id, 'step-1', 'x'.repeat(400)); // ~100 tokens
            await contextManager.addStepOutput(mission2.id, 'step-1', 'y'.repeat(400)); // ~100 tokens

            const stats = contextManager.getStats();

            assert.ok(stats.active_missions >= 2);
            assert.ok(stats.total_tokens >= 200);
            assert.ok(stats.memory_store);
        });
    });
});
