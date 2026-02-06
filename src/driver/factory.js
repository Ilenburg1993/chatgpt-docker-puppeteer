import EventEmitter from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import TargetDriver from './core/TargetDriver.js';
import { log } from '#core/logger';

/* ==========================================================================
   FACTORY_CONFIG v3.0 - Pool Management
========================================================================== */
const FACTORY_CONFIG = {
    // Discovery
    TARGETS_DIR: path.join(import.meta.dirname, 'targets'),
    DEFAULT_TARGET: process.env.FACTORY_DEFAULT_TARGET || 'chatgpt',
    VALIDATE_ON_BOOT: process.env.FACTORY_VALIDATE_BOOT === 'true',
    DISCOVERY_RETRY_COUNT: 3,
    LAZY_LOAD_TIMEOUT_MS: 10000,

    // ✅ v3.0: Pool Management
    MAX_POOL_SIZE: parseInt(process.env.DRIVER_POOL_MAX_SIZE) || 5,
    MIN_POOL_SIZE: parseInt(process.env.DRIVER_POOL_MIN_SIZE) || 2,
    IDLE_TIMEOUT_MS: parseInt(process.env.DRIVER_IDLE_TIMEOUT_MS) || 300000, // 5min
    WARMUP_TARGETS: (process.env.DRIVER_WARMUP_TARGETS || 'chatgpt,gemini').split(','),
    HEALTH_CHECK_INTERVAL_MS: parseInt(process.env.DRIVER_HEALTH_INTERVAL_MS) || 30000, // 30s
    POOL_ENABLED: process.env.DRIVER_POOL_ENABLED !== 'false', // Default true

    // ✅ C1: Backpressure Strategy
    BACKPRESSURE_TIMEOUT_MS: parseInt(process.env.DRIVER_BACKPRESSURE_TIMEOUT_MS) || 5000, // 5s
    BACKPRESSURE_ALLOW_TEMPORARY: process.env.DRIVER_BACKPRESSURE_TEMP !== 'false', // Default true
};

/* ==========================================================================
   FACTORY_EVENTS v3.0 - Pool Telemetry
========================================================================== */
const FACTORY_EVENTS = {
    DISCOVERY_COMPLETE: 'factory:discovery_complete',
    DRIVER_CREATED: 'factory:driver_created',
    POOL_HIT: 'factory:pool_hit', // ✅ v3.0: Reused from pool
    POOL_MISS: 'factory:pool_miss', // ✅ v3.0: Created new (pool empty)
    POOL_EXHAUSTED: 'factory:pool_exhausted', // ✅ v3.0: All drivers busy
    DRIVER_RELEASED: 'factory:driver_released', // ✅ v3.0: Returned to pool
    DRIVER_EVICTED: 'factory:driver_evicted', // ✅ v3.0: Removed from pool (GC)
    POOL_INITIALIZED: 'factory:pool_initialized', // ✅ v3.0: Warmup complete
    ERROR: 'factory:error',
};

/* ==========================================================================
   DriverFactory v3.0 - Pool-Ready Architecture
========================================================================== */

/**
 * DriverFactory v3.0 - Pool pattern para criação e reuse de drivers
 *
 * ✅ BREAKING CHANGES from v2.0:
 * - NO cache WeakMap (removed)
 * - Pool Map<target, DriverEntry[]> (drivers IDLE)
 * - createDriver(target, config) - Creates UNATTACHED driver
 * - acquireFromPool(target) - Get IDLE driver
 * - releaseToPool(driver) - Return IDLE driver
 *
 * Responsabilidades:
 * - Auto-discovery de drivers no diretório targets/
 * - Lazy-loading de classes (carrega apenas quando necessário)
 * - Pool de drivers IDLE (reutilizáveis entre tasks)
 * - Warmup automático (MIN_POOL_SIZE drivers criados no boot)
 * - Health checks & GC (evict drivers idle > 5min)
 * - Telemetria completa via EventEmitter
 *
 * @class DriverFactory
 * @extends EventEmitter
 */
class DriverFactory extends EventEmitter {
    /**
     * Construtor do DriverFactory v3.0
     *
     * Inicializa registry, pool, métricas e executa discovery + warmup.
     */
    constructor() {
        super();

        /**
         * Registro de Metadados (DNA de Descoberta).
         *
         * Estrutura: { [targetKey]: { path: string, className: string } }
         *
         * @type {Object.<string, {path: string, className: string}>}
         * @private
         */
        this.registry = Object.create(null);

        /**
         * ✅ v3.0: Pool de drivers IDLE (reutilizáveis).
         *
         * Estrutura: Map<target, DriverEntry[]>
         *
         * DriverEntry: {
         *   driver: TargetDriver,
         *   target: string,
         *   busy: boolean,
         *   createdAt: number,
         *   lastUsedAt: number | null,
         *   totalUses: number
         * }
         *
         * @type {Map<string, Array<Object>>}
         * @private
         */
        this.pool = new Map();

        /**
         * Set de drivers que falharam no lazy-load.
         * Previne tentativas repetidas de carregar drivers quebrados.
         *
         * @type {Set<string>}
         * @private
         */
        this.failedDrivers = new Set();

        /**
         * Métricas de performance e uso.
         *
         * @type {Object}
         * @private
         */
        this.metrics = {
            driversCreated: 0,
            poolHits: 0,
            poolMisses: 0,
            poolExhausted: 0,
            driversReleased: 0,
            driversDestroyed: 0,
            driversEvicted: 0,
            discoveryTime: 0,
            errors: 0,
            poolBackpressureRecovered: 0, // ✅ C1: Backpressure recoveries
            temporaryDriversCreated: 0, // ✅ C1: Temporary drivers created
        };

        /**
         * ✅ v3.0: Health check timer
         * @type {NodeJS.Timeout | null}
         * @private
         */
        this.healthTimer = null;

        /**
         * ✅ v3.0: Global driver config (usado para criar novos drivers)
         * @type {Object}
         * @private
         */
        this.config = {};

        // Configurar max listeners
        this.setMaxListeners(50);

        // Executar discovery + warmup automático
        this._discover();
    }

    /* ==========================================================================
       DISCOVERY (BOOT TIME)
    ========================================================================== */

    /**
     * Fase de descoberta automática de drivers.
     *
     * v3.0: Após discovery, executa initializePool() para warmup
     *
     * @private
     * @throws {Error} Se nenhum driver for descoberto ou DEFAULT_TARGET inválido
     * @emits factory:discovery_complete - Quando discovery completa
     * @emits factory:error - Se erro fatal em discovery
     */
    _discover() {
        const startTime = Date.now();
        let discovered = 0;

        try {
            // Validar que diretório existe
            if (!fs.existsSync(FACTORY_CONFIG.TARGETS_DIR)) {
                const error = `Diretório de targets não existe: ${FACTORY_CONFIG.TARGETS_DIR}`;
                log('FATAL', `[FACTORY] ${error}`);
                throw new Error(error);
            }

            // Ler diretório com try-catch robusto
            let files;
            try {
                files = fs.readdirSync(FACTORY_CONFIG.TARGETS_DIR);
            } catch (readdirError) {
                const error = `Erro ao ler diretório de targets: ${readdirError.message}`;
                log('FATAL', `[FACTORY] ${error}`);
                throw new Error(error);
            }

            // Processar cada arquivo com try-catch individual
            for (const file of files) {
                if (!file.endsWith('Driver.js')) {
                    continue;
                }

                try {
                    const targetKey = file.replace('Driver.js', '').toLowerCase();
                    const driverPath = path.join(FACTORY_CONFIG.TARGETS_DIR, file);

                    // Validar que arquivo é acessível
                    if (!fs.existsSync(driverPath)) {
                        log('WARN', `[FACTORY] Driver file não encontrado: ${driverPath}`);
                        continue;
                    }

                    // Registrar driver
                    this.registry[targetKey] = {
                        path: driverPath,
                        className: file.replace('.js', ''),
                    };

                    // ✅ v3.0: Inicializar pool vazio para este target
                    this.pool.set(targetKey, []);

                    discovered++;
                } catch (fileError) {
                    log('WARN', `[FACTORY] Erro ao processar ${file}: ${fileError.message}`);
                }
            }

            // Validar que pelo menos 1 driver foi descoberto
            if (discovered === 0) {
                const error = `Nenhum driver descoberto em ${FACTORY_CONFIG.TARGETS_DIR}. Sistema não pode operar.`;
                log('FATAL', `[FACTORY] ${error}`);
                throw new Error(error);
            }

            // Validar DEFAULT_TARGET ou usar primeiro descoberto
            const defaultKey = FACTORY_CONFIG.DEFAULT_TARGET.toLowerCase();
            if (!this.registry[defaultKey]) {
                const availableTargets = Object.keys(this.registry);
                const originalDefault = FACTORY_CONFIG.DEFAULT_TARGET;
                FACTORY_CONFIG.DEFAULT_TARGET = availableTargets[0];
                log(
                    'WARN',
                    `[FACTORY] Default target '${originalDefault}' não encontrado. Usando '${FACTORY_CONFIG.DEFAULT_TARGET}'`
                );
            }

            // Métricas e telemetria
            this.metrics.discoveryTime = Date.now() - startTime;

            log('INFO', `[FACTORY] ${discovered} targets mapeados em ${this.metrics.discoveryTime}ms`);

            this.emit(FACTORY_EVENTS.DISCOVERY_COMPLETE, {
                targetCount: discovered,
                targets: Object.keys(this.registry),
                defaultTarget: FACTORY_CONFIG.DEFAULT_TARGET,
                discoveryTime: this.metrics.discoveryTime,
            });

            // ✅ v3.0: Inicializar pool (warmup) após discovery
            if (FACTORY_CONFIG.POOL_ENABLED) {
                this.initializePool().catch(err => {
                    log('ERROR', `[FACTORY] Pool initialization failed: ${err.message}`);
                    this.emit(FACTORY_EVENTS.ERROR, {
                        operation: 'pool_init',
                        error: err.message,
                    });
                });

                // ✅ v3.0: Start health checks timer
                this._startHealthChecks();
            }
        } catch (e) {
            this.metrics.errors++;
            log('FATAL', `[FACTORY] Erro catastrófico no mapeamento de drivers: ${e.message}`);

            this.emit(FACTORY_EVENTS.ERROR, {
                operation: 'discovery',
                error: e.message,
                stack: e.stack,
            });

            throw e;
        }
    }

    /* ==========================================================================
       POOL MANAGEMENT (v3.0)
    ========================================================================== */

    /**
     * ✅ v3.0: Inicializa pool com warm drivers (MIN_POOL_SIZE).
     *
     * Cria MIN_POOL_SIZE drivers UNATTACHED para cada WARMUP_TARGET.
     * Drivers ficam em estado IDLE (ready para acquireFromPool).
     *
     * @returns {Promise<void>}
     * @emits factory:pool_initialized - Quando warmup completa
     */
    async initializePool() {
        log('INFO', '[FACTORY] Initializing driver pool (warmup)...');

        const warmupPromises = [];

        for (const target of FACTORY_CONFIG.WARMUP_TARGETS) {
            const targetKey = target.trim().toLowerCase();

            if (!this.registry[targetKey]) {
                log('WARN', `[FACTORY] Warmup target '${targetKey}' not found in registry. Skipping.`);
                continue;
            }

            // Criar MIN_POOL_SIZE drivers para este target
            for (let i = 0; i < FACTORY_CONFIG.MIN_POOL_SIZE; i++) {
                const promise = this._createWarmDriver(targetKey).catch(err => {
                    log('WARN', `[FACTORY] Failed to create warm driver ${targetKey}[${i}]: ${err.message}`);
                    return null;
                });
                warmupPromises.push(promise);
            }
        }

        // Aguardar todos os warm drivers
        await Promise.allSettled(warmupPromises);

        const totalWarm = this._getTotalPoolSize();

        log('INFO', `[FACTORY] Pool initialized: ${totalWarm} warm drivers created`);

        this.emit(FACTORY_EVENTS.POOL_INITIALIZED, {
            targets: FACTORY_CONFIG.WARMUP_TARGETS,
            poolSize: totalWarm,
            minPoolSize: FACTORY_CONFIG.MIN_POOL_SIZE,
        });
    }

    /**
     * ✅ v3.0: Cria driver WARM (UNATTACHED, pronto para attach).
     *
     * @param {string} target - Target name
     * @returns {Promise<TargetDriver>} Driver UNATTACHED
     * @private
     */
    async _createWarmDriver(target) {
        try {
            // Criar driver sem context (UNATTACHED)
            const driver = this.createDriver(target, this.config);

            // Adicionar ao pool
            const pool = this.pool.get(target);
            if (pool) {
                pool.push({
                    driver,
                    target,
                    busy: false,
                    createdAt: Date.now(),
                    lastUsedAt: null,
                    totalUses: 0,
                });

                log('DEBUG', `[FACTORY] Warm driver created: ${target} (pool size: ${pool.length})`);
            }

            return driver;
        } catch (error) {
            log('ERROR', `[FACTORY] Failed to create warm driver ${target}: ${error.message}`);
            throw error;
        }
    }

    /**
     * ✅ v3.0: Cria driver sem context (UNATTACHED state).
     *
     * BREAKING CHANGE from v2.0:
     * - NO page parameter
     * - NO signal parameter
     * - Driver em estado UNATTACHED (page=null, signal=null)
     * - Use driver.attachContext(page, signal) antes de executar
     *
     * @param {string} targetName - Nome da IA alvo (ex: 'chatgpt', 'gemini')
     * @param {Object} config - Configuração do driver
     * @param {string} config.target - Target específico
     * @param {number} [config.timeout] - Timeout em milissegundos
     *
     * @returns {Promise<TargetDriver>} Driver em estado UNATTACHED
     * @throws {Error} Se target não existe ou erro na criação
     *
     * @emits factory:driver_created - Quando driver é criado
     * @emits factory:error - Se erro na criação
     *
     * @example
     * const driver = await factory.createDriver('chatgpt', { timeout: 30000 });
     * // driver.state === 'UNATTACHED'
     * // driver.page === null
     * // driver.signal === null
     */
    async createDriver(targetName, config = {}) {
        const key = (targetName || FACTORY_CONFIG.DEFAULT_TARGET).toLowerCase();

        // Validar config
        if (!config || typeof config !== 'object') {
            const error = 'Parameter "config" must be an object';
            log('ERROR', `[FACTORY] ${error}`);
            throw new Error(`[FACTORY] ${error}`);
        }

        // Error recovery: não tentar re-load de drivers falhados
        if (this.failedDrivers.has(key)) {
            const error = `Driver ${key} previously failed to load`;
            log('ERROR', `[FACTORY] ${error}`);
            throw new Error(`[FACTORY] ${error}`);
        }

        // Lazy-loading
        const meta = this.registry[key];
        if (!meta) {
            const error = `Target '${key}' não suportado. Disponíveis: ${Object.keys(this.registry).join(', ')}`;
            log('ERROR', `[FACTORY] ${error}`);
            throw new Error(`[FACTORY] ${error}`);
        }

        let DriverClass;
        let instance;

        try {
            // ✅ P0-U6: Add expectedDomain to config
            const enhancedConfig = {
                ...config,
                target: key,
                expectedDomain: this._getExpectedDomain(key),
            };

            // Lazy-load COM timeout
            try {
                const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => {
                        reject(new Error(`Lazy-load timeout após ${FACTORY_CONFIG.LAZY_LOAD_TIMEOUT_MS}ms`));
                    }, FACTORY_CONFIG.LAZY_LOAD_TIMEOUT_MS);
                });

                const importPromise = import(pathToFileURL(meta.path).href).then(mod => mod.default ?? mod);

                DriverClass = await Promise.race([importPromise, timeoutPromise]);
            } catch (requireError) {
                this.failedDrivers.add(key);
                log('ERROR', `[FACTORY] Failed to load driver class '${key}': ${requireError.message}`);

                this.emit(FACTORY_EVENTS.ERROR, {
                    operation: 'lazy_load',
                    target: key,
                    error: requireError.message,
                });

                throw new Error(`Driver class load failed: ${requireError.message}`);
            }

            // Validar que DriverClass é função
            if (typeof DriverClass !== 'function') {
                this.failedDrivers.add(key);
                throw new Error(`[FACTORY] '${meta.className}' exports is not a constructor function`);
            }

            // ✅ v3.0: Instanciar COM APENAS CONFIG (NO page, NO signal)
            try {
                instance = new DriverClass(enhancedConfig); // ✅ P0-U6: Uses enhancedConfig with expectedDomain
            } catch (constructorError) {
                this.failedDrivers.add(key);
                log('ERROR', `[FACTORY] Driver constructor failed for '${key}': ${constructorError.message}`);
                throw new Error(`Driver construction failed: ${constructorError.message}`);
            }

            // Validar contrato
            if (!(instance instanceof TargetDriver)) {
                this.failedDrivers.add(key);
                throw new Error(`[FACTORY] '${meta.className}' viola o contrato TargetDriver.`);
            }

            // Setup de telemetria
            instance.once('destroyed', () => {
                this.metrics.driversDestroyed++;
                log('DEBUG', `[FACTORY] Driver destroyed: ${key}`);
            });

            this.metrics.driversCreated++;

            log('DEBUG', `[FACTORY] Driver created: ${instance.name} (UNATTACHED)`);

            this.emit(FACTORY_EVENTS.DRIVER_CREATED, {
                target: key,
                name: instance.name,
                className: meta.className,
                driversCreated: this.metrics.driversCreated,
            });

            return instance;
        } catch (e) {
            // Cleanup em caso de erro
            if (instance && typeof instance.destroy === 'function') {
                try {
                    instance.destroy().catch(() => {});
                } catch (_cleanupError) {
                    // Ignore cleanup errors
                }
            }

            this.metrics.errors++;

            log('ERROR', `[FACTORY] Erro na ativação do driver '${key}': ${e.message}`);

            this.emit(FACTORY_EVENTS.ERROR, {
                operation: 'createDriver',
                target: key,
                error: e.message,
            });

            throw e;
        }
    }

    /**
     * ✅ v3.0: Acquire driver do pool (ou cria novo se pool vazio).
     *
     * POOL HIT: Retorna driver IDLE existente (reuse)
     * POOL MISS: Cria novo driver se pool < MAX_POOL_SIZE
     * POOL EXHAUSTED: Lança erro se todos drivers busy
     *
     * @param {string} targetName - Nome da IA alvo
     * @returns {TargetDriver} Driver em estado UNATTACHED (ready para attachContext)
     * @throws {Error} Se pool exhausted ou target não existe
     *
     * @emits factory:pool_hit - Quando driver reutilizado
     * @emits factory:pool_miss - Quando driver criado (pool vazio)
     * @emits factory:pool_exhausted - Quando todos drivers busy
     *
     * @example
     * const driver = await factory.acquireFromPool('chatgpt');
     * driver.attachContext(page, signal, 'task-123');
     * const response = await driver.execute(prompt);
     * driver.detachContext();
     * factory.releaseToPool(driver);
     */
    async acquireFromPool(targetName) {
        const key = (targetName || FACTORY_CONFIG.DEFAULT_TARGET).toLowerCase();

        const pool = this.pool.get(key);

        if (!pool) {
            throw new Error(`[FACTORY] Invalid target: ${key}`);
        }

        // 1. Busca driver disponível (não busy, estado UNATTACHED)
        let entry = pool.find(e => !e.busy && e.driver.state === 'UNATTACHED' && !e.driver.destroyed);

        if (entry) {
            // POOL HIT - reusa driver IDLE
            this.metrics.poolHits++;

            log('DEBUG', `[FACTORY] POOL HIT: Reusing driver for ${key} (uses: ${entry.totalUses})`);

            this.emit(FACTORY_EVENTS.POOL_HIT, {
                target: key,
                poolSize: pool.length,
                totalUses: entry.totalUses,
                poolHits: this.metrics.poolHits,
            });
        } else {
            // POOL MISS - cria novo ou aguarda
            this.metrics.poolMisses++;

            if (pool.length < FACTORY_CONFIG.MAX_POOL_SIZE) {
                log('DEBUG', `[FACTORY] POOL MISS: Creating new driver for ${key}`);

                const driver = this.createDriver(key, this.config);

                entry = {
                    driver,
                    target: key,
                    busy: false,
                    createdAt: Date.now(),
                    lastUsedAt: null,
                    totalUses: 0,
                };

                pool.push(entry);

                this.emit(FACTORY_EVENTS.POOL_MISS, {
                    target: key,
                    poolSize: pool.length,
                    poolMisses: this.metrics.poolMisses,
                });
            } else {
                // ✅ C1: POOL EXHAUSTED - BACKPRESSURE STRATEGY
                this.metrics.poolExhausted++;

                log(
                    'WARN',
                    `[FACTORY] POOL EXHAUSTED: All ${FACTORY_CONFIG.MAX_POOL_SIZE} drivers for ${key} are busy. ` +
                        `Attempting backpressure recovery (timeout: ${FACTORY_CONFIG.BACKPRESSURE_TIMEOUT_MS}ms)`
                );

                this.emit(FACTORY_EVENTS.POOL_EXHAUSTED, {
                    target: key,
                    poolSize: pool.length,
                    maxPoolSize: FACTORY_CONFIG.MAX_POOL_SIZE,
                    poolExhausted: this.metrics.poolExhausted,
                });

                // ✅ C1: ESTRATÉGIA 1 - Aguardar release (backpressure)
                try {
                    const driver = await this._waitForDriverRelease(key, FACTORY_CONFIG.BACKPRESSURE_TIMEOUT_MS);

                    this.metrics.poolBackpressureRecovered++;

                    log('INFO', `[FACTORY] Backpressure recovered: driver released for ${key}`);

                    return driver; // Retry acquire (recursivo)
                } catch (_timeoutError) {
                    // ✅ C1: ESTRATÉGIA 2 (Fallback) - Driver temporário
                    if (FACTORY_CONFIG.BACKPRESSURE_ALLOW_TEMPORARY) {
                        log(
                            'WARN',
                            `[FACTORY] Backpressure timeout. Creating temporary driver (will be discarded after use)`
                        );

                        const tempDriver = this.createDriver(key, this.config);
                        tempDriver._isTemporary = true; // Flag para não adicionar ao pool

                        this.metrics.temporaryDriversCreated++;

                        // NÃO adiciona ao pool, retorna direto
                        return tempDriver;
                    }

                    // ✅ C1: REJECT como último recurso
                    throw new Error(
                        `[FACTORY] POOL_EXHAUSTED: All ${FACTORY_CONFIG.MAX_POOL_SIZE} drivers for ${key} are busy ` +
                            `(timeout waiting for release: ${FACTORY_CONFIG.BACKPRESSURE_TIMEOUT_MS}ms)`
                    );
                }
            }
        }

        // 2. Marca como busy
        entry.busy = true;
        entry.lastUsedAt = Date.now();
        entry.totalUses++;

        // 3. Validar que driver é válido
        if (entry.driver.destroyed) {
            throw new Error(`[FACTORY] Driver was destroyed (should not happen)`);
        }

        log('DEBUG', `[FACTORY] Acquired driver: ${key} (uses: ${entry.totalUses})`);

        return entry.driver;
    }

    /**
     * ✅ v3.0 (C3): Libera driver de volta ao pool (estado UNATTACHED).
     * ✅ C3: Strict validation - Garante que driver está em estado correto.
     *
     * PRÉ-CONDIÇÕES:
     * - Driver deve estar UNATTACHED (detachContext() já foi chamado)
     * - Driver não pode estar destruído
     *
     * PÓS-CONDIÇÕES:
     * - Driver volta para pool (busy=false) SE validação OK
     * - Driver removido do pool SE validação falhar
     * - Evento DRIVER_RELEASED emitido
     *
     * @param {TargetDriver} driver - Driver para liberar
     * @returns {void}
     *
     * @emits factory:driver_released - Quando driver volta ao pool
     *
     * @example
     * const response = await driver.execute(prompt);
     * driver.detachContext();
     * factory.releaseToPool(driver);  // Driver volta IDLE
     */
    releaseToPool(driver) {
        if (!driver) {
            log('WARN', '[FACTORY] releaseToPool called with null driver');
            return;
        }

        // 1. Encontra entry no pool
        let entry = null;
        let pool = null;

        for (const [_target, targetPool] of this.pool.entries()) {
            entry = targetPool.find(e => e.driver === driver);
            if (entry) {
                pool = targetPool;
                break;
            }
        }

        if (!entry) {
            log('WARN', `[FACTORY] Driver not found in pool. Destroying.`);
            driver.destroy().catch(err => {
                log('WARN', `[FACTORY] Error destroying orphan driver: ${err.message}`);
            });
            return;
        }

        // ✅ C3: STRICT VALIDATION - Driver DEVE estar UNATTACHED
        if (driver.state !== 'UNATTACHED') {
            log(
                'ERROR',
                `[FACTORY] C3 VALIDATION FAILED: Driver released but not UNATTACHED (state: ${driver.state}). ` +
                    `Expected detachContext() before release. Attempting force detach...`
            );

            // ✅ C3: Tenta force detach (C2 idempotência)
            if (driver.isContextAttached && driver.isContextAttached()) {
                try {
                    driver.detachContext({ force: true });

                    log(
                        'WARN',
                        `[FACTORY] C3: Force detach succeeded. Driver now ${driver.state}. ` +
                            `Marking available (warning: incomplete cleanup may have occurred).`
                    );
                } catch (detachErr) {
                    log(
                        'ERROR',
                        `[FACTORY] C3 CRITICAL: Force detach FAILED: ${detachErr.message}. ` +
                            `Driver compromised - removing from pool (will be destroyed on next GC).`
                    );

                    // ✅ C3: Remove driver do pool (corrupted state)
                    const index = pool.indexOf(entry);
                    if (index !== -1) {
                        pool.splice(index, 1);
                    }

                    // Tentar destruir imediatamente
                    driver.destroy().catch(destroyErr => {
                        log('ERROR', `[FACTORY] C3: Error destroying compromised driver: ${destroyErr.message}`);
                    });

                    this.metrics.errors++;
                    return; // NÃO marca como disponível
                }
            }
        }

        // ✅ C3: Verificação final (paranoia check)
        if (driver.state !== 'UNATTACHED') {
            log(
                'ERROR',
                `[FACTORY] C3 PARANOIA CHECK FAILED: Driver still not UNATTACHED after force detach ` +
                    `(state: ${driver.state}). Removing from pool.`
            );

            const index = pool.indexOf(entry);
            if (index !== -1) {
                pool.splice(index, 1);
            }

            driver.destroy().catch(() => {});
            this.metrics.errors++;
            return;
        }

        // ✅ C3: Validation OK - Marca como disponível
        entry.busy = false;

        log('DEBUG', `[FACTORY] Released driver: ${entry.target} (uses: ${entry.totalUses}, idle again)`);

        this.metrics.driversReleased++;

        this.emit(FACTORY_EVENTS.DRIVER_RELEASED, {
            target: entry.target,
            totalUses: entry.totalUses,
            poolSize: pool.length,
            driversReleased: this.metrics.driversReleased,
        });
    }

    /**
     * ✅ v3.0: Health checks & garbage collection.
     *
     * Remove drivers idle por > IDLE_TIMEOUT_MS SE pool > MIN_POOL_SIZE.
     *
     * @private
     */
    _startHealthChecks() {
        this.healthTimer = setInterval(() => {
            try {
                const now = Date.now();

                for (const [target, pool] of this.pool.entries()) {
                    // Remove drivers idle por muito tempo (se pool > MIN)
                    for (let i = pool.length - 1; i >= 0; i--) {
                        const entry = pool[i];

                        if (entry.busy || entry.driver.destroyed) {
                            continue;
                        }

                        const idleTime = now - (entry.lastUsedAt || entry.createdAt);
                        const shouldRemove =
                            idleTime > FACTORY_CONFIG.IDLE_TIMEOUT_MS && pool.length > FACTORY_CONFIG.MIN_POOL_SIZE;

                        if (shouldRemove) {
                            log('DEBUG', `[FACTORY] GC: Removing idle driver: ${target} (idle: ${idleTime}ms)`);

                            // Destrói driver
                            entry.driver.destroy().catch(err => {
                                log('WARN', `[FACTORY] GC: Error destroying driver: ${err.message}`);
                            });

                            // Remove do pool
                            pool.splice(i, 1);

                            this.metrics.driversEvicted++;

                            this.emit(FACTORY_EVENTS.DRIVER_EVICTED, {
                                target,
                                reason: 'idle_timeout',
                                idleTime,
                                poolSize: pool.length,
                                driversEvicted: this.metrics.driversEvicted,
                            });
                        }
                    }
                }
            } catch (err) {
                log('ERROR', `[FACTORY] Health check error: ${err.message}`);
            }
        }, FACTORY_CONFIG.HEALTH_CHECK_INTERVAL_MS);
    }

    /**
     * ✅ C1: Aguarda release de driver (backpressure strategy).
     *
     * Escuta evento DRIVER_RELEASED e tenta acquire novamente quando disponível.
     *
     * @param {string} target - Target name
     * @param {number} timeout - Timeout em ms
     * @returns {Promise<TargetDriver>} Driver released
     * @throws {Error} Se timeout
     * @private
     */
    _waitForDriverRelease(target, timeout) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.off(FACTORY_EVENTS.DRIVER_RELEASED, listener);
                reject(new Error('TIMEOUT'));
            }, timeout);

            const listener = event => {
                if (event.target === target) {
                    clearTimeout(timer);
                    this.off(FACTORY_EVENTS.DRIVER_RELEASED, listener);

                    // Tenta acquire novamente (recursivo)
                    this.acquireFromPool(target).then(resolve).catch(reject);
                }
            };

            this.on(FACTORY_EVENTS.DRIVER_RELEASED, listener);
        });
    }

    /**
     * ✅ v3.0: Para health checks timer.
     * @private
     */
    _stopHealthChecks() {
        if (this.healthTimer) {
            clearInterval(this.healthTimer);
            this.healthTimer = null;
        }
    }

    /**
     * ✅ v3.0: Obtém tamanho total do pool.
     * @private
     * @returns {number} Total de drivers no pool
     */
    _getTotalPoolSize() {
        let total = 0;
        for (const pool of this.pool.values()) {
            total += pool.length;
        }
        return total;
    }

    /* ==========================================================================
       INTROSPECTION & HEALTH
    ========================================================================== */

    /**
     * Obtém metadata de um driver específico.
     *
     * @param {string} targetName - Nome do target
     * @returns {Object|null} Metadata { path, className } ou null se não existe
     */
    getDriverMetadata(targetName) {
        const key = (targetName || '').toLowerCase();
        return this.registry[key] || null;
    }

    /**
     * Obtém metadata de todos os drivers.
     *
     * @returns {Object} Clone do registry completo
     */
    getAllDriversMetadata() {
        return { ...this.registry };
    }

    /**
     * Verifica se target existe no registry.
     *
     * @param {string} targetName - Nome do target
     * @returns {boolean} true se existe, false caso contrário
     */
    hasTarget(targetName) {
        const key = (targetName || '').toLowerCase();
        return key in this.registry;
    }

    /**
     * Obtém o target padrão.
     *
     * @returns {string} Nome do target padrão
     */
    getDefaultTarget() {
        return FACTORY_CONFIG.DEFAULT_TARGET;
    }

    /**
     * ✅ v3.0: Health Check Endpoint (Pool-aware).
     *
     * @returns {Object} Health status completo
     */
    getHealth() {
        const poolStats = [];
        for (const [target, pool] of this.pool.entries()) {
            const busy = pool.filter(e => e.busy).length;
            const idle = pool.filter(e => !e.busy).length;

            poolStats.push({
                target,
                total: pool.length,
                busy,
                idle,
                destroyed: pool.filter(e => e.driver.destroyed).length,
            });
        }

        return {
            discovered: Object.keys(this.registry).length,
            targets: Object.keys(this.registry),
            defaultTarget: FACTORY_CONFIG.DEFAULT_TARGET,
            failedDrivers: Array.from(this.failedDrivers),

            // ✅ v3.0: Pool stats
            pool: {
                enabled: FACTORY_CONFIG.POOL_ENABLED,
                totalSize: this._getTotalPoolSize(),
                maxPoolSize: FACTORY_CONFIG.MAX_POOL_SIZE,
                minPoolSize: FACTORY_CONFIG.MIN_POOL_SIZE,
                idleTimeout: FACTORY_CONFIG.IDLE_TIMEOUT_MS,
                warmupTargets: FACTORY_CONFIG.WARMUP_TARGETS,
                byTarget: poolStats,
            },

            metrics: {
                driversCreated: this.metrics.driversCreated,
                poolHits: this.metrics.poolHits,
                poolMisses: this.metrics.poolMisses,
                poolHitRate:
                    this.metrics.poolMisses > 0
                        ? ((this.metrics.poolHits / (this.metrics.poolHits + this.metrics.poolMisses)) * 100).toFixed(
                              2
                          ) + '%'
                        : 'N/A',
                poolExhausted: this.metrics.poolExhausted,
                driversReleased: this.metrics.driversReleased,
                driversDestroyed: this.metrics.driversDestroyed,
                driversEvicted: this.metrics.driversEvicted,
                errors: this.metrics.errors,
                discoveryTime: this.metrics.discoveryTime,
            },

            config: {
                targetsDir: FACTORY_CONFIG.TARGETS_DIR,
                defaultTarget: FACTORY_CONFIG.DEFAULT_TARGET,
                validateOnBoot: FACTORY_CONFIG.VALIDATE_ON_BOOT,
                maxPoolSize: FACTORY_CONFIG.MAX_POOL_SIZE,
                minPoolSize: FACTORY_CONFIG.MIN_POOL_SIZE,
                idleTimeout: FACTORY_CONFIG.IDLE_TIMEOUT_MS,
            },
        };
    }

    /**
     * Obtém métricas de performance.
     *
     * @returns {Object} Métricas completas
     */
    getMetrics() {
        return { ...this.metrics };
    }

    /**
     * Reseta métricas (útil para testes).
     *
     * @private
     */
    _resetMetrics() {
        this.metrics = {
            driversCreated: 0,
            poolHits: 0,
            poolMisses: 0,
            poolExhausted: 0,
            driversReleased: 0,
            driversDestroyed: 0,
            driversEvicted: 0,
            discoveryTime: 0,
            errors: 0,
        };
    }

    /**
     * ✅ v3.0: Shutdown graceful do pool.
     *
     * Destrói todos os drivers e para health checks.
     *
     * @returns {Promise<void>}
     */
    async shutdown() {
        log('INFO', '[FACTORY] Shutting down pool...');

        // Para health checks
        this._stopHealthChecks();

        // Destrói todos os drivers
        const destroyPromises = [];

        for (const [target, pool] of this.pool.entries()) {
            for (const entry of pool) {
                if (!entry.driver.destroyed) {
                    destroyPromises.push(
                        entry.driver.destroy().catch(err => {
                            log('WARN', `[FACTORY] Error destroying driver ${target}: ${err.message}`);
                        })
                    );
                }
            }
            pool.length = 0; // Clear pool
        }

        await Promise.allSettled(destroyPromises);

        log('INFO', '[FACTORY] Pool shutdown complete');
    }

    /**
     * ✅ P0-U6: Retorna expected domain para target.
     *
     * Usado para validar que página está no domain correto antes de attach.
     *
     * @private
     * @param {string} target - Target name (chatgpt, gemini, etc)
     * @returns {string|null} Expected domain ou null se não mapeado
     */
    _getExpectedDomain(target) {
        const domains = {
            chatgpt: 'chatgpt.com',
            gemini: 'gemini.google.com',
            claude: 'claude.ai',
            openai: 'openai.com',
        };
        return domains[target] || null;
    }
}

/* ==========================================================================
   SINGLETON INSTANCE & MODULE EXPORTS
========================================================================== */

/**
 * Singleton instance da DriverFactory v3.0
 *
 * @type {DriverFactory}
 */
const factory = new DriverFactory();

export const createDriver = factory.createDriver.bind(factory);
export const acquireFromPool = factory.acquireFromPool.bind(factory);
export const releaseToPool = factory.releaseToPool.bind(factory);
export const initializePool = factory.initializePool.bind(factory);
export const shutdown = factory.shutdown.bind(factory);
export const on = factory.on.bind(factory);
export const once = factory.once.bind(factory);
export const off = factory.off.bind(factory);
export const emit = factory.emit.bind(factory);
export const getDriverMetadata = factory.getDriverMetadata.bind(factory);
export const getAllDriversMetadata = factory.getAllDriversMetadata.bind(factory);
export const hasTarget = factory.hasTarget.bind(factory);
export const getDefaultTarget = factory.getDefaultTarget.bind(factory);
export const getHealth = factory.getHealth.bind(factory);
export const getMetrics = factory.getMetrics.bind(factory);
export const availableTargets = Object.keys(factory.registry);
export { FACTORY_CONFIG, FACTORY_EVENTS, factory };
