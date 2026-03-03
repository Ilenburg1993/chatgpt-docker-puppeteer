// @ts-check - Type checking rigoroso habilitado (arquivo core)
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
            unhandledRejection: null,
        };
        this._fatalHookRegistration = {
            uncaughtExceptionHadExternalListener: false,
            unhandledRejectionHadExternalListener: false,
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
            peakConcurrentLocks: 0,
        };
    }

    /**
     * Registers process termination handlers for automatic cleanup.
     * Only registers once, subsequent calls are no-op.
     *
     * ✅ P0 FIX (2026-02-16): Removed intrusive process.exit calls.
     * This library should clean up resources but NOT control process lifecycle.
     *
     * @private
     */
    _registerCleanupHandlers() {
        if (this._cleanupHandlersRegistered) {
            return;
        }

        const cleanup = async signal => {
            const lockCount = this.activeLocks.size;
            if (lockCount > 0) {
                console.log(`[ResilientLock] ${signal} received. Releasing ${lockCount} active locks...`);
                await this.releaseAll().catch(err => console.error(`[ResilientLock] Cleanup error: ${err.message}`));
            }
        };

        // Standard termination signals (graceful shutdown)
        // We do NOT exit the process here; we let the main event loop finish or be terminated by the orchestrator.
        this._cleanupHandlers.sigint = () => cleanup('SIGINT');
        this._cleanupHandlers.sigterm = () => cleanup('SIGTERM');
        this._cleanupHandlers.beforeExit = () => cleanup('beforeExit');

        // Compatibility + cleanup safety:
        // We keep passive fatal hooks so active locks are released under crash paths,
        // but avoid taking ownership of the process lifecycle when another handler exists.
        this._fatalHookRegistration.uncaughtExceptionHadExternalListener =
            process.listenerCount('uncaughtException') > 0;
        this._fatalHookRegistration.unhandledRejectionHadExternalListener =
            process.listenerCount('unhandledRejection') > 0;
        this._cleanupHandlers.uncaughtException = err => {
            void cleanup('uncaughtException').finally(() => {
                if (!this._fatalHookRegistration.uncaughtExceptionHadExternalListener) {
                    // Preserve Node crash semantics when no app-level handler existed.
                    queueMicrotask(() => {
                        throw err;
                    });
                }
            });
        };
        this._cleanupHandlers.unhandledRejection = reason => {
            void cleanup('unhandledRejection');
            // Deliberately no rethrow here to avoid changing Node's configured
            // unhandled rejection mode. App-level policy remains the owner.
            void reason;
        };

        process.once('SIGINT', this._cleanupHandlers.sigint);
        process.once('SIGTERM', this._cleanupHandlers.sigterm);
        process.once('beforeExit', this._cleanupHandlers.beforeExit);
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
     * @param {function} acquireFn - Async function to acquire the lock, returns Promise<boolean>
     * @param {function} releaseFn - Async function to release the lock, returns Promise<void>
     * @param {object} [metadata={}] - Optional metadata for debugging (e.g., taskId, workerId)
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
                    lockKey,
                },
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
     * @param {number} [timeoutMs=5000] - Timeout per release attempt (not total) to prevent indefinite hang.
     * @returns {Promise<{total: number, released: number, failed: number}>} Release statistics
     *
     * @example
     * const stats = await resilientLock.releaseAll();
     * console.log(`Released ${stats.released}/${stats.total} locks`);
     */
    async releaseAll(timeoutMs = 5000) {
        const lockKeys = Array.from(this.activeLocks.keys());
        const total = lockKeys.length;
        let released = 0;
        let failed = 0;

        if (total === 0) {
            this._unregisterCleanupHandlers();
            return { total: 0, released: 0, failed: 0 };
        }

        log('INFO', `[ResilientLock] Releasing ${total} active locks (timeout: ${timeoutMs}ms)...`);

        const promises = lockKeys.map(async lockKey => {
            try {
                // Wrap release in timeout
                const releasePromise = this.release(lockKey);
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs)
                );

                const success = await Promise.race([releasePromise, timeoutPromise]);
                if (success) released++;
                else failed++;
            } catch (err) {
                failed++;
                log('WARN', `[ResilientLock] Failed to release lock ${lockKey}: ${err.message}`);
            }
        });

        await Promise.allSettled(promises);

        log('INFO', `[ResilientLock] Released ${released}/${total} locks (${failed} failed)`);

        // Force cleanup even if some failed
        if (this.activeLocks.size === 0 || failed > 0) {
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
     * @returns {Array<object>} Array of active lock information
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
            heldForMs: Date.now() - lock.metadata.acquiredAt,
        }));
    }

    /**
     * Gets statistics about lock operations.
     *
     * @returns {object} Lock statistics
     *
     * @example
     * const stats = resilientLock.getStats();
     * console.log(`Acquired: ${stats.totalAcquired}, Released: ${stats.totalReleased}`);
     */
    getStats() {
        return {
            ...this._stats,
            currentActive: this.activeLocks.size,
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
     * @returns {object|null} Lock metadata or null if not found
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
     * @param {function} extendFn - Function to extend the lock, returns Promise<boolean>
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
