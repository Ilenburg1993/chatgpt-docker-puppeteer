// @ts-check
import { CheckpointManager } from '#orchestrator/checkpoint_manager';
import fs from 'fs/promises';
import assert from 'node:assert';
import path from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';

describe('CheckpointManager Unit Tests', () => {
    /** @type {any} */ let checkpointManager;
    /** @type {any} */ let testBaseDir;

    beforeEach(async () => {
        testBaseDir = path.join(import.meta.dirname, '../../test-checkpoints');
        await fs.mkdir(testBaseDir, { recursive: true });

        checkpointManager = new CheckpointManager({
            baseDir: testBaseDir,
            keepLast: 5,
            autoCleanup: false, // Desabilitado para testar manualmente
        });
    });

    afterEach(async () => {
        await fs.rm(testBaseDir, { recursive: true, force: true });
    });

    describe('1. Initialization', () => {
        it('should initialize with default options', () => {
            const manager = new CheckpointManager();
            assert.ok(manager);
            assert.strictEqual(manager.baseDir, 'missions');
            assert.strictEqual(manager.keepLast, 10);
            assert.strictEqual(manager.autoCleanup, true);
        });

        it('should initialize with custom options', () => {
            assert.strictEqual(checkpointManager.baseDir, testBaseDir);
            assert.strictEqual(checkpointManager.keepLast, 5);
            assert.strictEqual(checkpointManager.autoCleanup, false);
        });
    });

    describe('2. Save Checkpoint', () => {
        it('should save checkpoint successfully', async () => {
            const missionState = {
                id: 'mission-123',
                status: 'RUNNING',
                progress: { current_step: 5 },
            };

            const checkpointId = await checkpointManager.saveCheckpoint('mission-123', 5, missionState);

            assert.ok(checkpointId);
            assert.ok(checkpointId.startsWith('checkpoint-'));
        });

        it('should create checkpoints directory', async () => {
            const missionState = { id: 'mission-123', status: 'RUNNING' };

            await checkpointManager.saveCheckpoint('mission-123', 1, missionState);

            const checkpointsDir = path.join(testBaseDir, 'mission-123', 'checkpoints');
            const stat = await fs.stat(checkpointsDir);
            assert.ok(stat.isDirectory());
        });

        it('should save checkpoint with metadata', async () => {
            const missionState = { id: 'mission-123', status: 'RUNNING' };
            const metadata = {
                reason: 'step_completed',
                created_by: 'test',
            };

            await checkpointManager.saveCheckpoint('mission-123', 1, missionState, metadata);

            const checkpoint = await checkpointManager.loadCheckpoint('mission-123');

            assert.ok(checkpoint.metadata);
            assert.strictEqual(checkpoint.metadata.reason, 'step_completed');
            assert.strictEqual(checkpoint.metadata.created_by, 'test');
            assert.ok(checkpoint.metadata.created_at);
        });

        it('should save checkpoint-latest.json', async () => {
            const missionState = { id: 'mission-123', status: 'RUNNING' };

            await checkpointManager.saveCheckpoint('mission-123', 1, missionState);

            const latestPath = path.join(testBaseDir, 'mission-123', 'checkpoints', 'checkpoint-latest.json');
            const stat = await fs.stat(latestPath);
            assert.ok(stat.isFile());
        });

        it('should include complete mission state in checkpoint', async () => {
            const missionState = {
                id: 'mission-123',
                status: 'RUNNING',
                progress: { current_step: 5, percent: 50 },
                workflow: { steps: [] },
            };

            await checkpointManager.saveCheckpoint('mission-123', 5, missionState);

            const checkpoint = await checkpointManager.loadCheckpoint('mission-123');

            assert.strictEqual(checkpoint.mission_state.id, 'mission-123');
            assert.strictEqual(checkpoint.mission_state.status, 'RUNNING');
            assert.strictEqual(checkpoint.mission_state.progress.current_step, 5);
        });
    });

    describe('3. Load Checkpoint', () => {
        it('should load latest checkpoint', async () => {
            const missionState = { id: 'mission-123', status: 'RUNNING' };

            await checkpointManager.saveCheckpoint('mission-123', 1, missionState);

            const loaded = await checkpointManager.loadCheckpoint('mission-123');

            assert.ok(loaded);
            assert.strictEqual(loaded.mission_id, 'mission-123');
            assert.strictEqual(loaded.step_index, 1);
        });

        it('should return null if no checkpoint exists', async () => {
            const loaded = await checkpointManager.loadCheckpoint('nonexistent-mission');

            assert.strictEqual(loaded, null);
        });

        it('should load checkpoint by ID', async () => {
            const missionState = { id: 'mission-123', status: 'RUNNING' };

            const checkpointId = await checkpointManager.saveCheckpoint('mission-123', 1, missionState);

            const loaded = await checkpointManager.loadCheckpointById('mission-123', checkpointId);

            assert.ok(loaded);
            assert.strictEqual(loaded.checkpoint_id, checkpointId);
        });

        it('should return null for nonexistent checkpoint ID', async () => {
            const loaded = await checkpointManager.loadCheckpointById('mission-123', 'checkpoint-nonexistent');

            assert.strictEqual(loaded, null);
        });
    });

    describe('4. List Checkpoints', () => {
        it('should list all checkpoints', async () => {
            const missionState = { id: 'mission-123', status: 'RUNNING' };

            await checkpointManager.saveCheckpoint('mission-123', 1, missionState);
            await checkpointManager.saveCheckpoint('mission-123', 2, missionState);
            await checkpointManager.saveCheckpoint('mission-123', 3, missionState);

            const checkpoints = await checkpointManager.listCheckpoints('mission-123');

            assert.strictEqual(checkpoints.length, 3);
        });

        it('should return checkpoints sorted by timestamp (desc)', async () => {
            const missionState = { id: 'mission-123', status: 'RUNNING' };

            await checkpointManager.saveCheckpoint('mission-123', 1, missionState);
            await new Promise((resolve) => setTimeout(resolve, 10)); // Ensure timestamp difference
            await checkpointManager.saveCheckpoint('mission-123', 2, missionState);
            await new Promise((resolve) => setTimeout(resolve, 10));
            await checkpointManager.saveCheckpoint('mission-123', 3, missionState);

            const checkpoints = await checkpointManager.listCheckpoints('mission-123');

            // Most recent first
            assert.ok(checkpoints[0].timestamp > checkpoints[1].timestamp);
            assert.ok(checkpoints[1].timestamp > checkpoints[2].timestamp);
        });

        it('should return empty array if no checkpoints exist', async () => {
            const checkpoints = await checkpointManager.listCheckpoints('nonexistent-mission');

            assert.strictEqual(checkpoints.length, 0);
        });

        it('should include metadata in list', async () => {
            const missionState = { id: 'mission-123', status: 'RUNNING' };

            await checkpointManager.saveCheckpoint('mission-123', 5, missionState);

            const checkpoints = await checkpointManager.listCheckpoints('mission-123');

            assert.ok(checkpoints[0].checkpoint_id);
            assert.ok(checkpoints[0].timestamp);
            assert.strictEqual(checkpoints[0].step_index, 5);
            assert.ok(checkpoints[0].created_at);
        });
    });

    describe('5. Delete Checkpoints', () => {
        it('should delete specific checkpoint', async () => {
            const missionState = { id: 'mission-123', status: 'RUNNING' };

            const checkpointId = await checkpointManager.saveCheckpoint('mission-123', 1, missionState);

            await checkpointManager.deleteCheckpoint('mission-123', checkpointId);

            const loaded = await checkpointManager.loadCheckpointById('mission-123', checkpointId);
            assert.strictEqual(loaded, null);
        });

        it('should delete all checkpoints', async () => {
            const missionState = { id: 'mission-123', status: 'RUNNING' };

            await checkpointManager.saveCheckpoint('mission-123', 1, missionState);
            await checkpointManager.saveCheckpoint('mission-123', 2, missionState);

            await checkpointManager.deleteAllCheckpoints('mission-123');

            const checkpoints = await checkpointManager.listCheckpoints('mission-123');
            assert.strictEqual(checkpoints.length, 0);
        });

        it('should handle deleting nonexistent checkpoint gracefully', async () => {
            // Should not throw
            await checkpointManager.deleteCheckpoint('mission-123', 'nonexistent');
        });
    });

    describe('6. Has Checkpoint', () => {
        it('should return true if checkpoint exists', async () => {
            const missionState = { id: 'mission-123', status: 'RUNNING' };

            await checkpointManager.saveCheckpoint('mission-123', 1, missionState);

            const has = await checkpointManager.hasCheckpoint('mission-123');
            assert.strictEqual(has, true);
        });

        it('should return false if no checkpoint exists', async () => {
            const has = await checkpointManager.hasCheckpoint('nonexistent-mission');
            assert.strictEqual(has, false);
        });
    });

    describe('7. Auto-cleanup (LRU)', () => {
        it('should auto-cleanup old checkpoints', async () => {
            // Enable auto-cleanup
            const manager = new CheckpointManager({
                baseDir: testBaseDir,
                keepLast: 3,
                autoCleanup: true,
            });

            const missionState = { id: 'mission-456', status: 'RUNNING' };

            // Save 6 checkpoints (keepLast=3)
            for (let i = 1; i <= 6; i++) {
                await manager.saveCheckpoint('mission-456', i, missionState);
                await new Promise((resolve) => setTimeout(resolve, 10)); // Ensure timestamp order
            }

            const checkpoints = await manager.listCheckpoints('mission-456');

            // Should keep only last 3
            assert.strictEqual(checkpoints.length, 3);
        });

        it('should keep most recent checkpoints', async () => {
            const manager = new CheckpointManager({
                baseDir: testBaseDir,
                keepLast: 2,
                autoCleanup: true,
            });

            const missionState = { id: 'mission-456', status: 'RUNNING' };

            await manager.saveCheckpoint('mission-456', 1, missionState);
            await new Promise((resolve) => setTimeout(resolve, 10));
            await manager.saveCheckpoint('mission-456', 2, missionState);
            await new Promise((resolve) => setTimeout(resolve, 10));
            await manager.saveCheckpoint('mission-456', 3, missionState);

            const checkpoints = await manager.listCheckpoints('mission-456');

            assert.strictEqual(checkpoints.length, 2);
            assert.strictEqual(/** @type {any} */ (checkpoints[0]).step_index, 3); // Most recent
            assert.strictEqual(/** @type {any} */ (checkpoints[1]).step_index, 2); // Second most recent
        });
    });

    describe('8. Statistics', () => {
        it('should return stats for specific mission', async () => {
            const missionState = { id: 'mission-123', status: 'RUNNING' };

            await checkpointManager.saveCheckpoint('mission-123', 1, missionState);
            await checkpointManager.saveCheckpoint('mission-123', 2, missionState);

            const stats = await checkpointManager.getStats('mission-123');

            assert.strictEqual(stats.mission_id, 'mission-123');
            assert.strictEqual(stats.total_checkpoints, 2);
            assert.strictEqual(stats.has_latest, true);
            assert.ok(stats.latest_checkpoint);
            assert.strictEqual(stats.latest_checkpoint.step_index, 2);
        });

        it('should return global stats', async () => {
            const stats = await checkpointManager.getStats();

            assert.strictEqual(stats.base_dir, testBaseDir);
            assert.strictEqual(stats.keep_last, 5);
            assert.strictEqual(stats.auto_cleanup, false);
        });
    });
});
