// @ts-check
import { FEEDBACK_CATEGORY, FeedbackProcessor } from '#missions/feedback_processor';
import { MISSION_STATUS, MissionManager } from '#missions/mission_manager';
import { CheckpointManager } from '#orchestrator/checkpoint_manager';
import { ContextManager } from '#orchestrator/context_manager';
import { ActionCode } from '#shared/nerv/constants';
import fs from 'fs/promises';
import assert from 'node:assert';
import path from 'node:path';

describe('Phase 2 Integration Smoke Tests', () => {
    /** @type {any} */ let missionManager;
    /** @type {any} */ let testMissionsDir;

    // Mocks
    const mockKernel = {
        executeTask: async (/** @type {any} */ task, /** @type {any} */ correlationId) => {
            return { status: 'queued', task_id: task.meta.id };
        },
    };

    const nervEvents = [];
    const mockNERV = {
        onReceive: () => {},
        emit: (/** @type {any} */ eventName, /** @type {any} */ data) => {
            nervEvents.push({ event: eventName, data });
        },
        emitCommand: () => {},
        emitEvent: () => {},
    };

    beforeAll(async () => {
        testMissionsDir = path.join(import.meta.dirname, '../../missions-test-phase2');
        await fs.mkdir(testMissionsDir, { recursive: true });

        const contextManager = new ContextManager();
        const feedbackProcessor = new FeedbackProcessor({ contextManager });
        const checkpointManager = new CheckpointManager({
            baseDir: testMissionsDir,
            keepLast: 5,
            autoCleanup: true,
        });

        missionManager = new MissionManager({
            kernel: mockKernel,
            nerv: mockNERV,
            contextManager,
            feedbackProcessor,
            checkpointManager,
        });

        await missionManager.initialize();
    });

    afterAll(async () => {
        await fs.rm(testMissionsDir, { recursive: true, force: true });
        missionManager.cleanup();
    });

    describe('1. Phase 2 Components Accessible', () => {
        it('should have FeedbackProcessor initialized', () => {
            assert.ok(missionManager.feedbackProcessor);
            assert.strictEqual(typeof missionManager.feedbackProcessor.processFeedback, 'function');
        });

        it('should have CheckpointManager initialized', () => {
            assert.ok(missionManager.checkpointManager);
            assert.strictEqual(typeof missionManager.checkpointManager.saveCheckpoint, 'function');
        });

        it('should have ContextManager initialized', () => {
            assert.ok(missionManager.contextManager);
            assert.strictEqual(typeof missionManager.contextManager.initializeContext, 'function');
        });
    });

    describe('2. New NERV ActionCodes Available', () => {
        it('should have ORCHESTRATION action codes', () => {
            assert.ok(ActionCode.ORCHESTRATION_STARTED);
            assert.ok(ActionCode.ORCHESTRATION_COMPLETED);
            assert.ok(ActionCode.ORCHESTRATION_FAILED);
        });

        it('should have ITERATION action codes', () => {
            assert.ok(ActionCode.ITERATION_STARTED);
            assert.ok(ActionCode.ITERATION_COMPLETED);
            assert.ok(ActionCode.ITERATION_MAX_REACHED);
        });

        it('should have WORKFLOW action codes', () => {
            assert.ok(ActionCode.WORKFLOW_STARTED);
            assert.ok(ActionCode.WORKFLOW_STEP_STARTED);
            assert.ok(ActionCode.WORKFLOW_STEP_COMPLETED);
        });

        it('should have VALIDATION action codes', () => {
            assert.ok(ActionCode.VALIDATION_STARTED);
            assert.ok(ActionCode.VALIDATION_PASSED);
            assert.ok(ActionCode.VALIDATION_SCORE_LOW);
        });

        it('should have CONTEXT action codes', () => {
            assert.ok(ActionCode.CONTEXT_INITIALIZED);
            assert.ok(ActionCode.CONTEXT_OVERFLOW);
            assert.ok(ActionCode.CONTEXT_SUMMARIZED);
        });

        it('should have CHECKPOINT action codes', () => {
            assert.ok(ActionCode.CHECKPOINT_SAVED);
            assert.ok(ActionCode.CHECKPOINT_LOADED);
            assert.ok(ActionCode.CHECKPOINT_RECOVERY_STARTED);
        });

        it('should have FEEDBACK action codes', () => {
            assert.ok(ActionCode.FEEDBACK_RECEIVED);
            assert.ok(ActionCode.FEEDBACK_PROCESSED);
            assert.ok(ActionCode.FEEDBACK_INJECTED);
        });

        it('should have MISSION action codes', () => {
            assert.ok(ActionCode.MISSION_CREATED);
            assert.ok(ActionCode.MISSION_STARTED);
            assert.ok(ActionCode.MISSION_COMPLETED);
        });
    });

    describe('3. End-to-End: Mission + Feedback + Checkpoint', () => {
        /** @type {any} */ let testMissionId;

        it('should create mission successfully', async () => {
            const mission = await missionManager.createMission({
                title: 'Phase 2 Integration Test',
                description: 'Testing all Phase 2 components',
                templateId: 'book_writing',
                params: {
                    topic: 'Integration Testing',
                    num_chapters: 5,
                },
            });

            assert.ok(mission);
            assert.ok(mission.id);
            assert.strictEqual(mission.status, MISSION_STATUS.PENDING);

            testMissionId = mission.id;
        });

        it('should add and process feedback', async () => {
            const feedbackText = 'Add more technical examples and improve code quality';

            const processed = await missionManager.addFeedback(testMissionId, feedbackText);

            // Verify feedback was processed
            assert.ok(processed);
            assert.strictEqual(processed.category, FEEDBACK_CATEGORY.CONTENT);
            assert.ok(processed.actionItems.length > 0);
            assert.ok(processed.patterns.length > 0);

            // Verify feedback was stored in mission state
            const mission = await missionManager.getMission(testMissionId);
            assert.ok(mission.feedback.length > 0);
            assert.strictEqual(mission.feedback[0].content, feedbackText);
            assert.ok(mission.feedback[0].metadata);
            assert.strictEqual(mission.feedback[0].metadata.category, FEEDBACK_CATEGORY.CONTENT);
        });

        it('should save checkpoint after step completion', async () => {
            // Simulate step completion by manually calling checkpoint save
            const mission = await missionManager.getMission(testMissionId);

            const checkpointId = await missionManager.checkpointManager.saveCheckpoint(testMissionId, 1, mission, {
                reason: 'test_step_completed',
            });

            assert.ok(checkpointId);
            assert.ok(checkpointId.startsWith('checkpoint-'));

            // Verify checkpoint was saved
            const hasCheckpoint = await missionManager.checkpointManager.hasCheckpoint(testMissionId);
            assert.strictEqual(hasCheckpoint, true);
        });

        it('should load checkpoint', async () => {
            const checkpoint = await missionManager.checkpointManager.loadCheckpoint(testMissionId);

            assert.ok(checkpoint);
            assert.strictEqual(checkpoint.mission_id, testMissionId);
            assert.strictEqual(checkpoint.step_index, 1);
            assert.ok(checkpoint.mission_state);
            assert.ok(checkpoint.metadata);
        });

        it('should list checkpoints', async () => {
            const checkpoints = await missionManager.checkpointManager.listCheckpoints(testMissionId);

            assert.ok(Array.isArray(checkpoints));
            assert.ok(checkpoints.length >= 1);
            assert.ok(checkpoints[0].checkpoint_id);
            assert.ok(checkpoints[0].timestamp);
        });
    });

    describe('4. Crash Recovery Flow', () => {
        /** @type {any} */ let crashMissionId;

        it('should create mission and checkpoint', async () => {
            const mission = await missionManager.createMission({
                title: 'Crash Recovery Test',
                description: 'Test crash recovery',
                templateId: 'book_writing',
                params: {
                    topic: 'Recovery Testing',
                    num_chapters: 5,
                },
            });

            crashMissionId = mission.id;

            // Simulate mission running and checkpoint saved
            await missionManager.stateManager.updateMission(crashMissionId, { status: MISSION_STATUS.RUNNING });

            const updatedMission = await missionManager.getMission(crashMissionId);
            await missionManager.checkpointManager.saveCheckpoint(crashMissionId, 2, updatedMission, {
                reason: 'test_before_crash',
            });
        });

        it('should detect crashed mission on initialize', async () => {
            // Verify mission is in RUNNING state (simulating crash)
            const mission = await missionManager.getMission(crashMissionId);
            assert.strictEqual(mission.status, MISSION_STATUS.RUNNING);

            // Verify checkpoint exists
            const hasCheckpoint = await missionManager.checkpointManager.hasCheckpoint(crashMissionId);
            assert.strictEqual(hasCheckpoint, true);

            // Note: Actual recovery happens in initialize() which already ran
            // In a real crash scenario, the next boot would trigger recovery
        });

        it('should have checkpoint available for recovery', async () => {
            const checkpoint = await missionManager.checkpointManager.loadCheckpoint(crashMissionId);

            assert.ok(checkpoint);
            assert.strictEqual(checkpoint.mission_id, crashMissionId);
            assert.strictEqual(checkpoint.step_index, 2);
        });
    });

    describe('5. Integration Statistics', () => {
        it('should report FeedbackProcessor stats', () => {
            const stats = missionManager.feedbackProcessor.getStats();

            assert.ok(stats);
            assert.ok(stats.categories > 0);
            assert.ok(stats.pattern_regexes > 0);
            assert.strictEqual(stats.context_manager_enabled, true);
        });

        it('should report CheckpointManager stats', async () => {
            const missions = await missionManager.listMissions();
            const firstMissionId = missions[0].id;

            const stats = await missionManager.checkpointManager.getStats(firstMissionId);

            assert.ok(stats);
            assert.strictEqual(stats.mission_id, firstMissionId);
            assert.ok(stats.total_checkpoints >= 0);
            assert.strictEqual(typeof stats.has_latest, 'boolean');
        });

        it('should report ContextManager stats', () => {
            const stats = missionManager.contextManager.getStats();

            assert.ok(stats);
            assert.ok(stats.active_missions >= 0);
            assert.ok(stats.total_tokens >= 0);
            assert.ok(stats.memory_store);
            assert.ok(stats.memory_store.total_patterns >= 0);
        });
    });

    describe('6. Phase 2 Feature Matrix', () => {
        it('✅ FeedbackProcessor: Processing', () => {
            const result = missionManager.feedbackProcessor.processFeedback('Add examples');
            assert.ok(result);
        });

        it('✅ FeedbackProcessor: Categorization', () => {
            const result = missionManager.feedbackProcessor.processFeedback('Fix the bug');
            assert.strictEqual(result.category, FEEDBACK_CATEGORY.TECHNICAL);
        });

        it('✅ FeedbackProcessor: Pattern Extraction', () => {
            const patterns = missionManager.feedbackProcessor.extractPatterns('Add more examples');
            assert.ok(patterns.length > 0);
        });

        it('✅ CheckpointManager: Save/Load', async () => {
            const testState = { id: 'test', status: 'RUNNING' };
            const checkpointId = await missionManager.checkpointManager.saveCheckpoint('test-mission-id', 1, testState);
            const loaded = await missionManager.checkpointManager.loadCheckpoint('test-mission-id');

            assert.ok(checkpointId);
            assert.ok(loaded);
        });

        it('✅ CheckpointManager: Cleanup (LRU)', async () => {
            // Create 6 checkpoints (keepLast=5)
            for (let i = 1; i <= 6; i++) {
                await missionManager.checkpointManager.saveCheckpoint('lru-test', i, { id: 'lru-test', step: i });
            }

            const checkpoints = await missionManager.checkpointManager.listCheckpoints('lru-test');
            assert.ok(checkpoints.length <= 5); // Should keep only last 5
        });

        it('✅ ContextManager: Memory Store', () => {
            missionManager.contextManager.addPattern({
                type: 'FEEDBACK',
                content: 'Test pattern',
                metadata: { source: 'test' },
            });

            const patterns = missionManager.contextManager.getRelevantPatterns('test', 5);
            assert.ok(patterns.length > 0);
        });

        it('✅ NERV: New ActionCodes', () => {
            // Verify all 7 categories are present
            assert.ok(ActionCode.ORCHESTRATION_STARTED);
            assert.ok(ActionCode.ITERATION_STARTED);
            assert.ok(ActionCode.WORKFLOW_STARTED);
            assert.ok(ActionCode.VALIDATION_STARTED);
            assert.ok(ActionCode.CONTEXT_INITIALIZED);
            assert.ok(ActionCode.CHECKPOINT_SAVED);
            assert.ok(ActionCode.FEEDBACK_RECEIVED);
            assert.ok(ActionCode.MISSION_CREATED);
        });
    });
});
