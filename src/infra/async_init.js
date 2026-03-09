// @ts-check - Type checking rigoroso habilitado

/**
 * @module infra/async_init
 * @file Async initialization utilities for race-free module loading. Provides patterns for safe async initialization in
 *   ESM modules.
 *
 *   Created to address P0 bug in logger.js where fs.mkdirSync() caused race conditions when multiple processes loaded the
 *   module simultaneously.
 */

/**
 * Creates a lazy initialization pattern that runs async setup once. Subsequent calls wait for the same initialization
 * promise.
 *
 * @example
 *     const { ready } = createAsyncInit(async () => {
 *         await fs.promises.mkdir('/path/to/dir', { recursive: true });
 *     });
 *
 *     // Later, in any function:
 *     async function log(msg) {
 *         await ready; // Wait for initialization
 *         // ... use the initialized resource ...
 *     }
 *
 * @param {function} initFn - Async function to run on first access
 * @returns {{ ready: Promise<void>; reset: function; isInitialized: () => boolean }} Initialization control
 */
export function createAsyncInit(initFn) {
    let initPromise = /** @type {Promise<void> | null} */ (null);
    let initialized = false;

    const ready = new Proxy(Promise.resolve(), {
        get(target, prop) {
            if (prop === 'then') {
                // Lazy initialization on first await
                if (!initPromise) {
                    initPromise = initFn()
                        .then(() => {
                            initialized = true;
                        })
                        .catch(
                            /** @param {any} err */ (err) => {
                                // Reset on error so next call retries
                                initPromise = null;
                                initialized = false;
                                throw err;
                            },
                        );
                }
                return /** @type {NonNullable<typeof initPromise>} */ (initPromise).then.bind(initPromise);
            }
            return /** @type {any} */ (target)[prop];
        },
    });

    const reset = () => {
        initPromise = null;
        initialized = false;
    };

    const isInitialized = () => initialized;

    return { ready, reset, isInitialized };
}

/**
 * Creates a top-level async initialization that starts immediately. Safer than using IIFEs because it handles errors
 * properly.
 *
 * @example
 *     // Top of module
 *     const logDirReady = createTopLevelInit(async () => {
 *         await fs.promises.mkdir(LOG_DIR, { recursive: true });
 *     });
 *
 *     // In functions
 *     async function log(msg) {
 *         await logDirReady;
 *         // ... write log ...
 *     }
 *
 * @param {function} initFn - Async function to run immediately
 * @returns {Promise<void>} Promise that resolves when initialization completes
 */
export function createTopLevelInit(initFn) {
    return (async () => {
        try {
            return await initFn();
        } catch (/** @type {any} */ err) {
            // Log to stderr since logging system may not be ready
            console.error('[INIT_ERROR]', /** @type {any} */ (err).message);
            throw err;
        }
    })();
}

/** @typedef {any} InitDirectoryOptions */
/**
 * Creates a thread-safe directory initialization. Handles EEXIST errors gracefully (common in multi-process scenarios).
 *
 * @example
 *     const logDirReady = initDirectory('/var/log/myapp', { recursive: true });
 *
 *     async function log(msg) {
 *         await logDirReady;
 *         await fs.promises.writeFile('/var/log/myapp/output.log', msg);
 *     }
 *
 * @param {string} dirPath - Directory path to create
 * @param {InitDirectoryOptions} [options] - mkdir options
 * @returns {Promise<void>}
 */
export async function initDirectory(dirPath, options = { recursive: true }) {
    try {
        const fs = await import('node:fs/promises');
        await fs.mkdir(dirPath, options);
    } catch (/** @type {any} */ err) {
        // EEXIST is OK - directory already exists (another process created it)
        if (/** @type {any} */ (err).code === 'EEXIST') {
            return;
        }
        throw err;
    }
}

/**
 * Ensures a file exists, creating it if necessary. Thread-safe for concurrent access.
 *
 * @example
 *     await ensureFile('/var/log/app.log', '');
 *
 * @param {string} filePath - File path to ensure
 * @param {string} [defaultContent=''] - Default content if file doesn't exist. Default is `''`
 * @returns {Promise<void>}
 */
export async function ensureFile(filePath, defaultContent = '') {
    try {
        const fs = await import('node:fs/promises');
        const path = await import('node:path');

        // Ensure directory exists first
        const dir = path.dirname(filePath);
        await initDirectory(dir);

        // Try to access file
        await fs.access(filePath);
    } catch (/** @type {any} */ err) {
        // File doesn't exist, create it
        if (/** @type {any} */ (err).code === 'ENOENT') {
            const fs = await import('node:fs/promises');
            await fs.writeFile(filePath, defaultContent, { flag: 'wx' }); // wx = exclusive write
        } else {
            throw err;
        }
    }
}

/**
 * Creates a synchronized initialization guard that prevents concurrent execution. Uses a promise-based mutex pattern.
 *
 * @example
 *     const initGuard = createInitGuard();
 *
 *     async function ensureInitialized() {
 *         const release = await initGuard.acquire();
 *         try {
 *             if (!initialized) {
 *                 await doExpensiveInit();
 *                 initialized = true;
 *             }
 *         } finally {
 *             release();
 *         }
 *     }
 *
 * @returns {{ acquire: function; release: function }}
 */
export function createInitGuard() {
    let locked = false;
    const waitQueue = /** @type {any[]} */ ([]);

    async function acquire() {
        // If not locked, acquire immediately
        if (!locked) {
            locked = true;
            return release;
        }

        // Wait for lock to be released
        await new Promise((resolve) => {
            waitQueue.push(resolve);
        });

        locked = true;
        return release;
    }

    function release() {
        locked = false;

        // Wake up next waiter
        if (waitQueue.length > 0) {
            const next = waitQueue.shift();
            next();
        }
    }

    return { acquire, release };
}

/**
 * Decorator pattern for making a function wait for initialization. Useful for class methods that need resources to be
 * ready.
 *
 * @example
 *     const dbReady = initDatabase();
 *
 *     class UserRepo {
 *         getUser = waitForInit(dbReady, async (id) => {
 *             return db.query('SELECT * FROM users WHERE id = ?', [id]);
 *         });
 *     }
 *
 * @param {Promise<any>} initPromise - Initialization promise to wait for
 * @param {function} fn - Function to wrap
 * @returns {function} Wrapped function
 */
export function waitForInit(initPromise, fn) {
    /**
     * @this {any}
     * @param {...any} args
     */
    async function wrapper(...args) {
        await initPromise;
        return fn.apply(this, args);
    }
    return wrapper;
}

/**
 * Combines multiple initialization promises into one. Useful when a module depends on multiple resources.
 *
 * @example
 *     const dbReady = initDatabase();
 *     const cacheReady = initCache();
 *     const storageReady = initStorage();
 *
 *     const allReady = combineInits(dbReady, cacheReady, storageReady);
 *
 *     async function doWork() {
 *         await allReady;
 *         // All resources are now ready
 *     }
 *
 * @param {...Promise<any>} initPromises - Promises to combine
 * @returns {Promise<void>}
 */
export function combineInits(...initPromises) {
    return Promise.all(initPromises).then(() => /** @type {void} */ (undefined));
}

/**
 * Creates an initialization with timeout. Fails if initialization takes too long.
 *
 * @example
 *     const dbReady = initWithTimeout(() => connectToDatabase(), 5000, 'Database connection');
 *
 * @param {function} initFn - Initialization function
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} [name='Initialization'] - Name for error messages. Default is `'Initialization'`
 * @returns {Promise<void>}
 */
export async function initWithTimeout(initFn, timeoutMs, name = 'Initialization') {
    let timeoutId;

    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            const error = new Error(`${name} timed out after ${timeoutMs}ms`);
            /** @type {any} */ (error).code = 'INIT_TIMEOUT';
            reject(error);
        }, timeoutMs);
    });

    try {
        const result = await Promise.race([initFn(), timeoutPromise]);
        clearTimeout(timeoutId);
        return result;
    } catch (/** @type {any} */ err) {
        clearTimeout(timeoutId);
        throw err;
    }
}

/**
 * Creates an initialization with health check callback. Periodically checks if initialization is still valid.
 *
 * @example
 *     const { ready, stop } = initWithHealthCheck(
 *         () => connectToDatabase(),
 *         async () => {
 *             try {
 *                 await db.ping();
 *                 return true;
 *             } catch {
 *                 return false;
 *             }
 *         },
 *         30000, // Check every 30s
 *     );
 *
 * @param {function} initFn - Initialization function
 * @param {function} healthCheckFn - Function that returns Promise<boolean>
 * @param {number} [intervalMs=60000] - Health check interval. Default is `60000`
 * @returns {{ ready: Promise<void>; stop: function; isHealthy: () => boolean }} Init control
 */
export function initWithHealthCheck(initFn, healthCheckFn, intervalMs = 60000) {
    let healthCheckInterval = /** @type {any} */ (null);
    let isHealthy = false;

    const ready = (async () => {
        await initFn();
        isHealthy = true;

        // Start health checks
        healthCheckInterval = setInterval(async () => {
            const healthy = await healthCheckFn().catch(() => false);
            if (!healthy && isHealthy) {
                console.error('[HEALTH_CHECK] Resource became unhealthy, may need reinitialization');
                isHealthy = false;
            }
        }, intervalMs);
    })();

    const stop = () => {
        if (healthCheckInterval) {
            clearInterval(healthCheckInterval);
            healthCheckInterval = null;
        }
    };

    return { ready, stop, isHealthy: () => isHealthy };
}
