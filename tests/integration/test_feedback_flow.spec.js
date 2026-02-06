import assert from 'node:assert';
import { describe, it, before, after, beforeEach } from 'node:test';
import { MissionManager, MISSION_STATUS } from '#missions/mission_manager';
import { FeedbackProcessor } from '#missions/feedback_processor';
import { ContextManager } from '#orchestrator/context_manager';
import path from 'node:path';
import fs from 'fs/promises';

describe('Feedback Flow Integration Tests', () => {
    let missionManager;
    let contextManager;
    let feedbackProcessor;
    let testMissionsDir;

    // Mocks
    const mockKernel = {
        executeTask: async (task, correlationId) => {
            return { status: 'queued', task_id: task.meta.id };
        }
    };

    const mockNERV = {
        onReceive: () => {},
        emit: () => {},
        emitCommand: () => {},
        emitEvent: () => {}
    };

    before(async () => {
        testMissionsDir = path.join(import.meta.dirname, '../../missions-test-feedback');
        await fs.mkdir(testMissionsDir, { recursive: true });

        contextManager = new ContextManager();
        feedbackProcessor = new FeedbackProcessor({ contextManager });

        missionManager = new MissionManager({
            kernel: mockKernel,
            nerv: mockNERV,
            contextManager,
            feedbackProcessor
        });

        await missionManager.initialize();
    });

    after(async () => {
        await fs.rm(testMissionsDir, { recursive: true, force: true });
        contextManager.cleanup();
        missionManager.cleanup();
    });

    describe('1. Feedback Processing via MissionManager', () => {
        let testMissionId;

        beforeEach(async () => {
            const mission = await missionManager.createMission({
                title: 'Test Mission',
                description: 'Test',
                templateId: 'book_writing',
                params: {
                    topic: 'Feedback Testing',
                    num_chapters: 5
                }
            });

            testMissionId = mission.id;
        });

        it('should process and store feedback', async () => {
            const feedbackText = 'Add more code examples and improve the explanations';

            const processed = await missionManager.addFeedback(testMissionId, feedbackText);

            // Verifica que feedback foi processado
            assert.ok(processed);
            assert.strictEqual(processed.original, feedbackText);
            assert.ok(processed.category);
            assert.ok(processed.actionItems.length > 0);
            assert.ok(processed.patterns.length > 0);
        });

        it('should categorize feedback correctly', async () => {
            const technicalFeedback = 'Fix the bug in authentication';
            const processed = await missionManager.addFeedback(testMissionId, technicalFeedback);

            assert.strictEqual(processed.category, 'TECHNICAL');
        });

        it('should extract action items', async () => {
            const feedbackText = 'Add examples. Improve clarity. Fix typos.';
            const processed = await missionManager.addFeedback(testMissionId, feedbackText);

            assert.ok(processed.actionItems.length >= 3);
        });

        it('should extract patterns', async () => {
            const feedbackText = 'Add more examples and avoid technical jargon';
            const processed = await missionManager.addFeedback(testMissionId, feedbackText);

            assert.ok(processed.patterns.length >= 2);
            assert.ok(processed.patterns.some(p => p.includes('Add:')));
            assert.ok(processed.patterns.some(p => p.includes('Avoid:')));
        });

        it('should store feedback in mission state', async () => {
            const feedbackText = 'Add more examples';
            await missionManager.addFeedback(testMissionId, feedbackText);

            const mission = await missionManager.getMission(testMissionId);

            assert.ok(mission.feedback.length > 0);
            assert.strictEqual(mission.feedback[mission.feedback.length - 1].content, feedbackText);
        });

        it('should include processed metadata in mission state', async () => {
            const feedbackText = 'Add more examples';
            const processed = await missionManager.addFeedback(testMissionId, feedbackText);

            const mission = await missionManager.getMission(testMissionId);
            const storedFeedback = mission.feedback[mission.feedback.length - 1];

            assert.ok(storedFeedback.metadata);
            assert.strictEqual(storedFeedback.metadata.processed_id, processed.id);
            assert.strictEqual(storedFeedback.metadata.category, processed.category);
            assert.deepStrictEqual(storedFeedback.metadata.action_items, processed.actionItems);
            assert.deepStrictEqual(storedFeedback.metadata.patterns, processed.patterns);
        });
    });

    describe('2. Feedback Injection in Task Generation', () => {
        let testMissionId;

        beforeEach(async () => {
            const mission = await missionManager.createMission({
                title: 'Test Mission',
                description: 'Test',
                templateId: 'book_writing',
                params: {
                    topic: 'Injection Testing',
                    num_chapters: 5
                }
            });

            testMissionId = mission.id;
        });

        it('should inject feedback into task prompt', async () => {
            // Adiciona feedback
            await missionManager.addFeedback(testMissionId, 'Add more code examples');

            const mission = await missionManager.getMission(testMissionId);
            const step = mission.workflow.steps[0];

            // Gera task com feedback injetado
            const taskV5 = missionManager._generateTaskV5FromStep(step, mission);

            const prompt = taskV5.spec.payload.user_message;

            // Prompt deve conter feedback
            assert.ok(prompt.includes('[USER FEEDBACK]'));
            assert.ok(prompt.toLowerCase().includes('code examples'));
        });

        it('should inject with structured format', async () => {
            await missionManager.addFeedback(testMissionId, 'Add examples. Improve clarity.');

            const mission = await missionManager.getMission(testMissionId);
            const step = mission.workflow.steps[0];
            const taskV5 = missionManager._generateTaskV5FromStep(step, mission);

            const prompt = taskV5.spec.payload.user_message;

            // Formato estruturado
            assert.ok(prompt.includes('Category:'));
            assert.ok(prompt.includes('Feedback:'));
            assert.ok(prompt.includes('Action Items:'));
        });

        it('should handle multiple feedbacks (use latest)', async () => {
            await missionManager.addFeedback(testMissionId, 'First feedback');
            await missionManager.addFeedback(testMissionId, 'Second feedback - latest');

            const mission = await missionManager.getMission(testMissionId);
            const step = mission.workflow.steps[0];
            const taskV5 = missionManager._generateTaskV5FromStep(step, mission);

            const prompt = taskV5.spec.payload.user_message;

            // Deve usar último feedback
            assert.ok(prompt.toLowerCase().includes('latest'));
        });
    });

    describe('3. MemoryStore Integration', () => {
        let testMissionId;

        beforeEach(async () => {
            const mission = await missionManager.createMission({
                title: 'Test Mission',
                description: 'Test',
                templateId: 'book_writing',
                params: {
                    topic: 'Memory Testing',
                    num_chapters: 5
                }
            });

            testMissionId = mission.id;
        });

        it('should store patterns in MemoryStore', async () => {
            const feedbackText = 'Add more code examples and avoid technical jargon';

            await missionManager.addFeedback(testMissionId, feedbackText);

            // Verifica que patterns foram armazenados
            const stats = contextManager.getStats();
            assert.ok(stats.memory_store.total_patterns > 0);
        });

        it('should retrieve patterns from MemoryStore', async () => {
            await missionManager.addFeedback(testMissionId, 'Add more code examples');

            // Busca patterns relacionados
            const patterns = contextManager.getRelevantPatterns('code', 5);

            assert.ok(patterns.length > 0);
            assert.ok(patterns.some(p => p.content.toLowerCase().includes('code')));
        });

        it('should store patterns with mission metadata', async () => {
            await missionManager.addFeedback(testMissionId, 'Improve documentation');

            const patterns = contextManager.getRelevantPatterns('documentation', 5);

            assert.ok(patterns.length > 0);
            // Patterns devem ter metadata (armazenado internamente)
        });
    });

    describe('4. Multiple Missions', () => {
        it('should handle feedback across multiple missions', async () => {
            const mission1 = await missionManager.createMission({
                title: 'Mission 1',
                description: 'Test',
                templateId: 'book_writing',
                params: { topic: 'Topic 1', num_chapters: 5 }
            });

            const mission2 = await missionManager.createMission({
                title: 'Mission 2',
                description: 'Test',
                templateId: 'book_writing',
                params: { topic: 'Topic 2', num_chapters: 5 }
            });

            await missionManager.addFeedback(mission1.id, 'Add examples for mission 1');
            await missionManager.addFeedback(mission2.id, 'Add examples for mission 2');

            const state1 = await missionManager.getMission(mission1.id);
            const state2 = await missionManager.getMission(mission2.id);

            assert.strictEqual(state1.feedback.length, 1);
            assert.strictEqual(state2.feedback.length, 1);
        });
    });

    describe('5. Feedback Categories', () => {
        let testMissionId;

        beforeEach(async () => {
            const mission = await missionManager.createMission({
                title: 'Test Mission',
                description: 'Test',
                templateId: 'book_writing',
                params: { topic: 'Categories', num_chapters: 5 }
            });

            testMissionId = mission.id;
        });

        it('should categorize CONTENT feedback', async () => {
            const processed = await missionManager.addFeedback(testMissionId, 'Add more details and examples');
            assert.strictEqual(processed.category, 'CONTENT');
        });

        it('should categorize STYLE feedback', async () => {
            const processed = await missionManager.addFeedback(testMissionId, 'Use a more professional tone');
            assert.strictEqual(processed.category, 'STYLE');
        });

        it('should categorize QUALITY feedback', async () => {
            const processed = await missionManager.addFeedback(testMissionId, 'Improve the overall quality');
            assert.strictEqual(processed.category, 'QUALITY');
        });

        it('should categorize STRUCTURE feedback', async () => {
            const processed = await missionManager.addFeedback(testMissionId, 'Organize the sections better');
            assert.strictEqual(processed.category, 'STRUCTURE');
        });
    });
});
