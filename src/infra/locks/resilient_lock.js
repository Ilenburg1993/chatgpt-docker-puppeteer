/**
 * @fileoverview Resilient Lock Manager with automatic cleanup on process termination.
 * Guarantees lock release even when process crashes, preventing deadlocks.
 *
 * Created to address P0 bug in task_orchestration_worker.js where lock extension
 * intervals were not cleaned up on process crash, leaving tasks locked indefinitely.
 *
 * @module infra/locks/resilient_lock
 */

import { log } from '#core/logger';

/**
 * Manages locks with automatic cleanup on process exit.
 * Ensures locks are released even in crash scenarios by registering
 * process termination handlers.
 *
 * @class ResilientLockManager
 *
 * @example
 * const lockAcquired = await resilientLock.acquire(
 *   `task:${taskId}`,
 *   async () => acquireTaskLock(taskId),
 *   async () => releaseTaskLock(taskId),
 *   { taskId, workerId }
 * );
 */
class ResilientLockManager {
    constructor() {
        /**
         * Active locks map: lockKey -> { release, metadata }
         * @private
         */
        this.activeLocks = new Map();

        /**
         * Flag to prevent duplicate cleanup handler registration
         * @private
         */
        this._cleanupHandlersRegistered = false;
        this._cleanupHandlers = {
            beforeExit: null,
            sigint: null,
            sigterm: null,
            uncaughtException: null,
            unhandledRejection: null
        };

        /**
         * Stats for monitoring
         * @private
         */
        this._stats = {
            totalAcquired: 0,
            totalReleased: 0,
            totalFailedAcquire: 0,
            totalFailedRelease: 0,
            peakConcurrentLocks: 0
        };
    }

    /**
     * Registers process termination handlers for automatic cleanup.
     * Only registers once, subsequent calls are no-op.
     * @private
     */
    _registerCleanupHandlers() {
        if (this._cleanupHandlersRegistered) {
            return;
        }

        const cleanup = async () => {
            const lockCount = this.activeLocks.size;
            if (lockCount > 0) {
                console.log(`[ResilientLock] Process terminating with ${lockCount} active locks, releasing...`);
                await this.releaseAll();
            }
        };

        this._cleanupHandlers.beforeExit = cleanup;
        this._cleanupHandlers.sigint = cleanup;
        this._cleanupHandlers.sigterm = cleanup;
        this._cleanupHandlers.uncaughtException = async (err) => {
            console.error('[ResilientLock] Uncaught exception, cleaning up locks before exit:', err.message);
            await this.releaseAll();
            // Re-throw to maintain normal crash behavior
            process.exit(1);
        };
        this._cleanupHandlers.unhandledRejection = async (reason) => {
            console.error('[ResilientLock] Unhandled rejection, cleaning up locks:', reason);
            await this.releaseAll();
            process.exit(1);
        };

        // Register handlers for graceful shutdown
        process.once('beforeExit', this._cleanupHandlers.beforeExit);
        process.once('SIGINT', this._cleanupHandlers.sigint);
        process.once('SIGTERM', this._cleanupHandlers.sigterm);
        process.once('uncaughtException', this._cleanupHandlers.uncaughtException);
        process.once('unhandledRejection', this._cleanupHandlers.unhandledRejection);

        this._cleanupHandlersRegistered = true;
        log('DEBUG', '[ResilientLock] Cleanup handlers registered');
    }

    _unregisterCleanupHandlers() {
        if (!this._cleanupHandlersRegistered) {
            return;
        }

        if (this._cleanupHandlers.beforeExit) {
            process.removeListener('beforeExit', this._cleanupHandlers.beforeExit);
            this._cleanupHandlers.beforeExit = null;
        }
        if (this._cleanupHandlers.sigint) {
            process.removeListener('SIGINT', this._cleanupHandlers.sigint);
            this._cleanupHandlers.sigint = null;
        }
        if (this._cleanupHandlers.sigterm) {
            process.removeListener('SIGTERM', this._cleanupHandlers.sigterm);
            this._cleanupHandlers.sigterm = null;
        }
        if (this._cleanupHandlers.uncaughtException) {
            process.removeListener('uncaughtException', this._cleanupHandlers.uncaughtException);
            this._cleanupHandlers.uncaughtException = null;
        }
        if (this._cleanupHandlers.unhandledRejection) {
            process.removeListener('unhandledRejection', this._cleanupHandlers.unhandledRejection);
            this._cleanupHandlers.unhandledRejection = null;
        }

        this._cleanupHandlersRegistered = false;
        log('DEBUG', '[ResilientLock] Cleanup handlers removed');
    }

    /**
     * Acquires a lock and registers it for automatic cleanup.
     *
     * @param {string} lockKey - Unique identifier for the lock
     * @param {Function} acquireFn - Async function to acquire the lock, returns Promise<boolean>
     * @param {Function} releaseFn - Async function to release the lock, returns Promise<void>
     * @param {Object} [metadata={}] - Optional metadata for debugging (e.g., taskId, workerId)
     * @returns {Promise<boolean>} True if lock was acquired successfully
     *
     * @example
     * const acquired = await resilientLock.acquire(
     *   `task:${taskId}`,
     *   () => db.acquireLock(taskId),
     *   () => db.releaseLock(taskId),
     *   { taskId: 'task-123', workerId: 'worker-1' }
     * );
     */
    async acquire(lockKey, acquireFn, releaseFn, metadata = {}) {
        // Ensure cleanup handlers are registered
        this._registerCleanupHandlers();

        // Check if lock is already held
        if (this.activeLocks.has(lockKey)) {
            log('WARN', `[ResilientLock] Lock ${lockKey} already held`, metadata);
            return false;
        }

        try {
            // Attempt to acquire the lock
            const acquired = await acquireFn();

            if (!acquired) {
                this._stats.totalFailedAcquire++;
                log('DEBUG', `[ResilientLock] Failed to acquire ${lockKey}`, metadata);
                return false;
            }

            // Register the lock for cleanup
            this.activeLocks.set(lockKey, {
                release: releaseFn,
                metadata: {
                    ...metadata,
                    acquiredAt: Date.now(),
                    lockKey
                }
            });

            // Update stats
            this._stats.totalAcquired++;
            if (this.activeLocks.size > this._stats.peakConcurrentLocks) {
                this._stats.peakConcurrentLocks = this.activeLocks.size;
            }

            log('DEBUG', `[ResilientLock] Acquired ${lockKey} (${this.activeLocks.size} active)`, metadata);
            return true;

        } catch (err) {
            this._stats.totalFailedAcquire++;
            log('ERROR', `[ResilientLock] Error acquiring ${lockKey}: ${err.message}`, metadata);
            return false;
        }
    }

    /**
     * Releases a specific lock.
     *
     * @param {string} lockKey - Identifier of the lock to release
     * @returns {Promise<boolean>} True if lock was released successfully
     *
     * @example
     * await resilientLock.release(`task:${taskId}`);
     */
    async release(lockKey) {
        const lock = this.activeLocks.get(lockKey);

        if (!lock) {
            log('DEBUG', `[ResilientLock] Lock ${lockKey} not found (already released or never acquired)`);
            return false;
        }

        try {
            await lock.release();
            this.activeLocks.delete(lockKey);

            this._stats.totalReleased++;
            if (this.activeLocks.size === 0) {
                this._unregisterCleanupHandlers();
            }

            log('DEBUG', `[ResilientLock] Released ${lockKey} (${this.activeLocks.size} active)`, lock.metadata);
            return true;

        } catch (err) {
            this._stats.totalFailedRelease++;
            log('WARN', `[ResilientLock] Failed to release ${lockKey}: ${err.message}`, lock.metadata);

            // Remove from map anyway to prevent memory leak
            this.activeLocks.delete(lockKey);
            if (this.activeLocks.size === 0) {
                this._unregisterCleanupHandlers();
            }
            return false;
        }
    }

    /**
     * Releases all active locks.
     * Called automatically on process exit.
     *
     * @returns {Promise<{total: number, released: number, failed: number}>} Release statistics
     *
     * @example
     * const stats = await resilientLock.releaseAll();
     * console.log(`Released ${stats.released}/${stats.total} locks`);
     */
    async releaseAll() {
        const lockKeys = Array.from(this.activeLocks.keys());
        const total = lockKeys.length;
        let released = 0;
        let failed = 0;

        if (total === 0) {
            this._unregisterCleanupHandlers();
            return { total: 0, released: 0, failed: 0 };
        }

        log('INFO', `[ResilientLock] Releasing ${total} active locks...`);

        for (const lockKey of lockKeys) {
            const success = await this.release(lockKey);
            if (success) {
                released++;
            } else {
                failed++;
            }
        }

        log('INFO', `[ResilientLock] Released ${released}/${total} locks (${failed} failed)`);
        if (this.activeLocks.size === 0) {
            this._unregisterCleanupHandlers();
        }

        return { total, released, failed };
    }

    /**
     * Explicit cleanup hook for global listeners (used by tests and controlled teardown).
     */
    cleanupGlobalListeners() {
        this._unregisterCleanupHandlers();
    }

    /**
     * Lists all active locks with their metadata.
     * Useful for debugging and monitoring.
     *
     * @returns {Array<Object>} Array of active lock information
     *
     * @example
     * const activeLocks = resilientLock.listActiveLocks();
     * console.log(`Active locks: ${activeLocks.length}`);
     * activeLocks.forEach(lock => {
     *   console.log(`- ${lock.key}: held for ${Date.now() - lock.acquiredAt}ms`);
     * });
     */
    listActiveLocks() {
        return Array.from(this.activeLocks.entries()).map(([key, lock]) => ({
            key,
            ...lock.metadata,
            heldForMs: Date.now() - lock.metadata.acquiredAt
        }));
    }

    /**
     * Gets statistics about lock operations.
     *
     * @returns {Object} Lock statistics
     *
     * @example
     * const stats = resilientLock.getStats();
     * console.log(`Acquired: ${stats.totalAcquired}, Released: ${stats.totalReleased}`);
     */
    getStats() {
        return {
            ...this._stats,
            currentActive: this.activeLocks.size
        };
    }

    /**
     * Checks if a specific lock is currently held.
     *
     * @param {string} lockKey - Lock identifier to check
     * @returns {boolean} True if lock is active
     *
     * @example
     * if (resilientLock.hasLock(`task:${taskId}`)) {
     *   console.log('Task is currently locked');
     * }
     */
    hasLock(lockKey) {
        return this.activeLocks.has(lockKey);
    }

    /**
     * Gets metadata for a specific lock.
     *
     * @param {string} lockKey - Lock identifier
     * @returns {Object|null} Lock metadata or null if not found
     *
     * @example
     * const metadata = resilientLock.getLockMetadata(`task:${taskId}`);
     * if (metadata) {
     *   console.log(`Lock acquired at: ${new Date(metadata.acquiredAt)}`);
     * }
     */
    getLockMetadata(lockKey) {
        const lock = this.activeLocks.get(lockKey);
        return lock ? { ...lock.metadata } : null;
    }

    /**
     * Extends a lock's TTL by re-acquiring it.
     * Useful for long-running operations that need periodic lock refresh.
     *
     * @param {string} lockKey - Lock identifier
     * @param {Function} extendFn - Function to extend the lock, returns Promise<boolean>
     * @returns {Promise<boolean>} True if lock was extended successfully
     *
     * @example
     * const extended = await resilientLock.extend(
     *   `task:${taskId}`,
     *   () => db.extendLock(taskId, 60000)
     * );
     */
    async extend(lockKey, extendFn) {
        const lock = this.activeLocks.get(lockKey);

        if (!lock) {
            log('WARN', `[ResilientLock] Cannot extend ${lockKey}: lock not found`);
            return false;
        }

        try {
            const extended = await extendFn();

            if (extended) {
                // Update metadata to reflect extension
                lock.metadata.lastExtendedAt = Date.now();
                log('DEBUG', `[ResilientLock] Extended ${lockKey}`, lock.metadata);
            }

            return extended;

        } catch (err) {
            log('ERROR', `[ResilientLock] Failed to extend ${lockKey}: ${err.message}`, lock.metadata);
            return false;
        }
    }
}

/**
 * Singleton instance of ResilientLockManager.
 * Use this for all lock management operations.
 *
 * @type {ResilientLockManager}
 * @example
 * import { resilientLock } from '#infra/locks/resilient_lock';
 *
 * await resilientLock.acquire('my-lock', acquireFn, releaseFn);
 */
export const resilientLock = new ResilientLockManager();

/**
 * Export class for testing purposes
 */
export { ResilientLockManager };
