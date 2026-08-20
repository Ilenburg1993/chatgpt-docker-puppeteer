/** @import {IDriver} from "#types/driver/contracts" */
// @ts-check - Type checking rigoroso habilitado (arquivo core)
import CONFIG from '#core/config';
import { log } from '#core/logger';
import EventEmitter from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import TargetDriver from './core/TargetDriver.js';

/* ==========================================================================
   FACTORY CONSTANTS
========================================================================== */
/** Constante/valor exportado: FACTORY_CONFIG. */
const CONSTANTS = {
    // Discovery
    TARGETS_DIR: path.join(import.meta.dirname, 'targets'),
    DEFAULT_TARGET: 'chatgpt', // Fallback se CONFIG falhar
    DISCOVERY_RETRY_COUNT: 3,
    LAZY_LOAD_TIMEOUT_MS: 10000,
    HEALTH_CHECK_INTERVAL_MS: 30000,
};

/* ==========================================================================
   FACTORY_EVENTS v3.0 - Pool Telemetry
========================================================================== */
/** Constante/valor exportado: FACTORY_EVENTS. */
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

/**
 * Lista exportada com referência estável para targets disponíveis. É atualizada internamente após discovery.
 *
 * @type {string[]}
 */
const AVAILABLE_TARGETS_EXPORT = [];

/* ==========================================================================
   DriverFactory v3.0 - Pool-Ready Architecture
========================================================================== */

/**
 * DriverFactory v3.0 - Pool pattern para criação e reuse de drivers
 *
 * ✅ BREAKING CHANGES from v2.0:
 *
 * - NO cache WeakMap (removed)
 * - Pool Map<target, DriverEntry[]> (drivers IDLE)
 * - createDriver(target, config) - Creates UNATTACHED driver
 * - acquireFromPool(target) - Get IDLE driver
 * - releaseToPool(driver) - Return IDLE driver
 *
 * Responsabilidades:
 *
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
     * Inicializa registry, pool e métricas sem side-effects de runtime. Discovery/warmup só ocorre via
     * start()/ensureReady().
     */
    constructor() {
        super();

        /**
         * Registro de Metadados (DNA de Descoberta).
         *
         * Estrutura: { [targetKey]: { path: string, className: string } }
         *
         * @private
         * @type {Object<string, { path: string; className: string }>}
         */
        this.registry = Object.create(null);

        /**
         * ✅ v3.0: Pool de drivers IDLE (reutilizáveis).
         *
         * Estrutura: Map<target, DriverEntry[]>
         *
         * DriverEntry: { driver: TargetDriver, target: string, busy: boolean, createdAt: number, lastUsedAt: number |
         * null, totalUses: number }
         *
         * @private
         * @type {Map<string, any[]>}
         */
        this.pool = new Map();

        /**
         * Set de drivers que falharam no lazy-load. Previne tentativas repetidas de carregar drivers quebrados.
         *
         * @private
         * @type {Set<string>}
         */
        this.failedDrivers = new Set();

        /**
         * Métricas de performance e uso.
         *
         * @private
         * @type {any}
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

            // ✅ v3.1: Hot Pool Telemetry
            hotPoolSize: 0,
            coldPoolSize: 0,
            pressureEvents: 0,
            waitersQueued: 0,
            waitersWoken: 0,
            waitersTimedOut: 0,
            createSerializationPasses: 0,
        };

        /**
         * ✅ v3.0: Health check timer
         *
         * @private
         * @type {NodeJS.Timeout | null}
         */
        this.healthTimer = null;

        /**
         * ✅ v3.0: Global driver config (usado para criar novos drivers)
         *
         * @private
         * @type {any}
         */
        this.config = {};

        /**
         * ✅ v3.1: Browser Pool reference (Hot Pool support)
         *
         * @private
         * @type {any}
         */
        this.browserPool = null;

        /**
         * Target padrão efetivo resolvido internamente. Evita mutar CONFIG quando ele expõe getters somente leitura.
         *
         * @private
         * @type {string}
         */
        this.defaultTargetKey = String(CONFIG['DEFAULT_MODEL_ID'] || CONSTANTS.DEFAULT_TARGET).toLowerCase();

        /**
         * Controle de lifecycle explícito (import-safe).
         *
         * @private
         * @type {boolean}
         */
        this._ready = false;

        /**
         * Discovery já executado.
         *
         * @private
         * @type {boolean}
         */
        this._discovered = false;

        /**
         * Warmup já executado.
         *
         * @private
         * @type {boolean}
         */
        this._poolInitialized = false;

        /**
         * Promise única de start (memoization).
         *
         * @private
         * @type {Promise<void> | null}
         */
        this._startPromise = null;

        /**
         * Fila por target para serializar operações críticas.
         *
         * @private
         * @type {Map<string, Promise<void>>}
         */
        this._targetSerializers = new Map();

        /**
         * Fila FIFO de espera por target (backpressure sem recursão).
         *
         * @private
         * @type {Map<
         *     string,
         *     { resolve: () => void; reject: (err: Error) => void; timer: NodeJS.Timeout; done: boolean }[]
         * >}
         */
        this._waiters = new Map();

        // Configurar max listeners
        this.setMaxListeners(50);
    }

    /* ==========================================================================
       LIFECYCLE (IMPORT-SAFE)
    ========================================================================== */

    /**
     * Inicializa factory explicitamente (discovery + warmup opcional + health checks).
     *
     * @param {{
     *     browserPool?: object | null;
     *     warmup?: boolean;
     *     startHealthChecks?: boolean;
     * }} [options]
     * @returns {Promise<void>}
     */
    async start(options = {}) {
        if (this._ready) {
            this._applyStartOptions(options);
            return;
        }

        if (this._startPromise) {
            await this._startPromise;
            this._applyStartOptions(options);
            return;
        }

        this._startPromise = (async () => {
            this._applyStartOptions(options);

            this._discover();

            const shouldWarmup = options.warmup ?? CONFIG['DRIVER_POOL_ENABLED'];
            if (shouldWarmup) {
                await this.initializePool({ skipEnsureReady: true });
            }

            const shouldStartHealthChecks = options.startHealthChecks ?? true;
            if (shouldStartHealthChecks) {
                this._startHealthChecks();
            }

            this._ready = true;
        })();

        try {
            await this._startPromise;
        } catch (/** @type {any} */ err) {
            this._ready = false;
            this._startPromise = null;
            throw err;
        }
    }

    /**
     * Garante factory pronta com lazy-start controlado.
     *
     * @param {{
     *     browserPool?: object | null;
     *     warmup?: boolean;
     *     startHealthChecks?: boolean;
     * }} [options]
     * @returns {Promise<void>}
     */
    async ensureReady(options = {}) {
        if (this._ready) {
            this._applyStartOptions(options);
            return;
        }
        await this.start(options);
    }

    /**
     * Aplica opções de runtime não destrutivas.
     *
     * @private
     * @param {{ browserPool?: object | null }} options
     */
    _applyStartOptions(options = {}) {
        if (Object.prototype.hasOwnProperty.call(options, 'browserPool')) {
            if (options.browserPool == null) {
                this.clearBrowserPool();
            } else {
                this.setBrowserPool(options.browserPool);
            }
        }
    }

    /**
     * Atualiza array exportado de targets disponíveis (referência estável).
     *
     * @private
     */
    _refreshAvailableTargetsExport() {
        AVAILABLE_TARGETS_EXPORT.length = 0;
        AVAILABLE_TARGETS_EXPORT.push(...Object.keys(this.registry));
    }

    /**
     * Serializa uma operação por target.
     *
     * @private
     * @template T
     * @param {string} target
     * @param {() => Promise<T>} operation
     * @returns {Promise<T>}
     */
    async _serializeByTarget(target, operation) {
        const previous = this._targetSerializers.get(target) || Promise.resolve();
        /** @type {(() => void) | null} */
        let release = null;
        const barrier = new Promise((resolve) => {
            release = /** @type {() => void} */ (resolve);
        });
        this._targetSerializers.set(
            target,
            previous.then(() => barrier),
        );

        await previous;
        try {
            this.metrics.createSerializationPasses++;
            return await operation();
        } finally {
            if (typeof release === 'function') {
                /** @type {() => void} */ (release)();
            }
        }
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
     * @fires factory:discovery_complete - Quando discovery completa
     * @fires factory:error - Se erro fatal em discovery
     * @throws {Error} Se nenhum driver for descoberto ou DEFAULT_TARGET inválido
     */
    _discover() {
        if (this._discovered) {
            return;
        }

        const startTime = Date.now();
        let discovered = 0;

        try {
            this.registry = Object.create(null);
            this.pool.clear();

            // Validar que diretório existe
            if (!fs.existsSync(CONSTANTS.TARGETS_DIR)) {
                const error = `Diretório de targets não existe: ${CONSTANTS.TARGETS_DIR}`;
                log('FATAL', `[FACTORY] ${error}`);
                throw new Error(error);
            }

            // Ler diretório com try-catch robusto
            let files;
            try {
                files = fs.readdirSync(CONSTANTS.TARGETS_DIR);
            } catch (/** @type {any} */ _rawReaddirError) {
                const readdirError = /** @type {any} */ (_rawReaddirError);
                const error = `Erro ao ler diretório de targets: ${readdirError.message}`;
                log('FATAL', `[FACTORY] ${error}`);
                throw new Error(error); // eslint-disable-line preserve-caught-error
            }

            // Processar cada arquivo com try-catch individual
            for (const file of files) {
                if (!file.endsWith('Driver.js')) {
                    continue;
                }

                try {
                    const targetKey = file.replace('Driver.js', '').toLowerCase();
                    const driverPath = path.join(CONSTANTS.TARGETS_DIR, file);

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
                } catch (/** @type {any} */ _rawFileError) {
                    const fileError = /** @type {any} */ (_rawFileError);
                    log('WARN', `[FACTORY] Erro ao processar ${file}: ${fileError.message}`);
                }
            }

            // Validar que pelo menos 1 driver foi descoberto
            if (discovered === 0) {
                const error = `Nenhum driver descoberto em ${CONSTANTS.TARGETS_DIR}. Sistema não pode operar.`;
                log('FATAL', `[FACTORY] ${error}`);
                throw new Error(error);
            }

            // Validar DEFAULT_TARGET ou usar primeiro descoberto
            const configuredDefault = String(CONFIG['DEFAULT_MODEL_ID'] || CONSTANTS.DEFAULT_TARGET).toLowerCase();
            this.defaultTargetKey = configuredDefault;
            if (!this.registry[this.defaultTargetKey]) {
                const availableTargets = Object.keys(this.registry);
                const originalDefault = CONFIG['DEFAULT_MODEL_ID'] || CONSTANTS.DEFAULT_TARGET;
                this.defaultTargetKey = availableTargets[0] ?? '';
                log(
                    'WARN',
                    `[FACTORY] Default target '${originalDefault}' não encontrado. Usando '${this.defaultTargetKey}'`,
                );
            }

            // Métricas e telemetria
            this.metrics.discoveryTime = Date.now() - startTime;
            this._discovered = true;
            this._refreshAvailableTargetsExport();

            log('INFO', `[FACTORY] ${discovered} targets mapeados em ${this.metrics.discoveryTime}ms`);

            this.emit(FACTORY_EVENTS.DISCOVERY_COMPLETE, {
                targetCount: discovered,
                targets: Object.keys(this.registry),
                defaultTarget: this.getDefaultTarget(),
                discoveryTime: this.metrics.discoveryTime,
            });
        } catch (/** @type {any} */ _rawE) {
            const e = /** @type {any} */ (_rawE);
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
     * Cria MIN_POOL_SIZE drivers UNATTACHED para cada WARMUP_TARGET. Drivers ficam em estado IDLE (ready para
     * acquireFromPool).
     *
     * @fires factory:pool_initialized - Quando warmup completa
     * @param {any} [options] - Opções de inicialização
     * @returns {Promise<void>}
     */
    async initializePool(options = {}) {
        const { skipEnsureReady = false } = options;

        if (!skipEnsureReady) {
            await this.ensureReady({ warmup: false });
        }

        if (this._poolInitialized) {
            return;
        }

        log('INFO', '[FACTORY] Initializing driver pool (warmup)...');

        const warmupPromises = [];
        const warmupTargets = Array.isArray(CONFIG['DRIVER_WARMUP_TARGETS']) ? CONFIG['DRIVER_WARMUP_TARGETS'] : [];
        const minPoolSize = Number(CONFIG['DRIVER_POOL_MIN_SIZE'] || 0);

        for (const target of warmupTargets) {
            const targetKey = target.trim().toLowerCase();

            if (!this.registry[targetKey]) {
                log('WARN', `[FACTORY] Warmup target '${targetKey}' not found in registry. Skipping.`);
                continue;
            }

            // Criar MIN_POOL_SIZE drivers para este target
            for (let i = 0; i < minPoolSize; i++) {
                const promise = this._createWarmDriver(targetKey).catch((err) => {
                    log('WARN', `[FACTORY] Failed to create warm driver ${targetKey}[${i}]: ${err.message}`);
                    return /** @type {null} */ (null);
                });
                warmupPromises.push(promise);
            }
        }

        // Aguardar todos os warm drivers
        await Promise.allSettled(warmupPromises);

        const totalWarm = this._getTotalPoolSize();
        this._poolInitialized = true;

        log('INFO', `[FACTORY] Pool initialized: ${totalWarm} warm drivers created`);

        this.emit(FACTORY_EVENTS.POOL_INITIALIZED, {
            targets: warmupTargets,
            poolSize: totalWarm,
            minPoolSize,
        });
    }

    /**
     * ✅ v3.0: Cria driver WARM (UNATTACHED, pronto para attach).
     *
     * @private
     * @param {string} target - Target name
     * @returns {Promise<TargetDriver>} Driver UNATTACHED
     */
    async _createWarmDriver(target) {
        try {
            // Criar driver sem context (UNATTACHED)
            const driver = await this.createDriver(target, this.config, { skipEnsureReady: true });

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
        } catch (/** @type {any} */ _rawError) {
            const error = /** @type {any} */ (_rawError);
            log('ERROR', `[FACTORY] Failed to create warm driver ${target}: ${error.message}`);
            throw error;
        }
    }

    /**
     * ✅ v3.0: Cria driver sem context (UNATTACHED state).
     *
     * BREAKING CHANGE from v2.0:
     *
     * - NO page parameter
     * - NO signal parameter
     * - Driver em estado UNATTACHED (page=null, signal=null)
     * - Use driver.attachContext(page, signal) antes de executar
     *
     * @example
     *     const driver = await factory.createDriver('chatgpt', { timeout: 30000 });
     *     // driver.state === 'UNATTACHED'
     *     // driver.page === null
     *     // driver.signal === null
     *
     * @fires factory:driver_created - Quando driver é criado
     * @fires factory:error - Se erro na criação
     * @param {string} targetName - Nome da IA alvo (ex: 'chatgpt', 'gemini')
     * @param {object} config - Configuração do driver
     * @param {string} [config.target] - Target específico (auto preenchido pelo factory)
     * @param {number} [config.timeout] - Timeout em milissegundos
     * @param {any} [options] - Opções extras
     * @returns {Promise<TargetDriver>} Driver em estado UNATTACHED
     * @throws {Error} Se target não existe ou erro na criação
     */
    async createDriver(targetName, config = {}, options = {}) {
        const { skipEnsureReady = false } = options;

        if (!skipEnsureReady) {
            await this.ensureReady();
        }

        const key = (targetName || this.getDefaultTarget() || CONSTANTS.DEFAULT_TARGET).toLowerCase();

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
                let lazyLoadTimerId;
                const timeoutPromise = new Promise((_, reject) => {
                    lazyLoadTimerId = setTimeout(() => {
                        reject(new Error(`Lazy-load timeout após ${CONSTANTS.LAZY_LOAD_TIMEOUT_MS}ms`));
                    }, CONSTANTS.LAZY_LOAD_TIMEOUT_MS);
                });

                const importPromise = import(pathToFileURL(meta.path).href).then((mod) => mod.default ?? mod);

                try {
                    DriverClass = await Promise.race([importPromise, timeoutPromise]);
                } finally {
                    clearTimeout(lazyLoadTimerId);
                }
            } catch (/** @type {any} */ _rawRequireError) {
                const requireError = /** @type {any} */ (_rawRequireError);
                this.failedDrivers.add(key);
                log('ERROR', `[FACTORY] Failed to load driver class '${key}': ${requireError.message}`);

                this.emit(FACTORY_EVENTS.ERROR, {
                    operation: 'lazy_load',
                    target: key,
                    error: requireError.message,
                });

                throw new Error(`Driver class load failed: ${requireError.message}`); // eslint-disable-line preserve-caught-error
            }

            // Validar que DriverClass é função
            if (typeof DriverClass !== 'function') {
                this.failedDrivers.add(key);
                throw new Error(`[FACTORY] '${meta.className}' exports is not a constructor function`);
            }

            // ✅ v3.0: Instanciar COM APENAS CONFIG (NO page, NO signal)
            try {
                instance = new DriverClass(enhancedConfig); // ✅ P0-U6: Uses enhancedConfig with expectedDomain
            } catch (/** @type {any} */ _rawConstructorError) {
                const constructorError = /** @type {any} */ (_rawConstructorError);
                this.failedDrivers.add(key);
                log('ERROR', `[FACTORY] Driver constructor failed for '${key}': ${constructorError.message}`);
                throw new Error(`Driver construction failed: ${constructorError.message}`); // eslint-disable-line preserve-caught-error
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
        } catch (/** @type {any} */ e) {
            // Cleanup em caso de erro
            if (instance && typeof instance.destroy === 'function') {
                try {
                    instance.destroy().catch(() => {});
                } catch (/** @type {any} */ _cleanupError) {
                    // Ignore cleanup errors
                }
            }

            this.metrics.errors++;

            log('ERROR', `[FACTORY] Erro na ativação do driver '${key}': ${/** @type {any} */ (e).message}`);

            this.emit(FACTORY_EVENTS.ERROR, {
                operation: 'createDriver',
                target: key,
                error: /** @type {any} */ (e).message,
            });
            throw e;
        }
    }

    /**
     * ✅ v3.0: Acquire driver do pool (ou cria novo se pool vazio).
     *
     * POOL HIT: Retorna driver IDLE existente (reuse) POOL MISS: Cria novo driver se pool < MAX_POOL_SIZE POOL
     * EXHAUSTED: Lança erro se todos drivers busy
     *
     * @example
     *     const driver = await factory.acquireFromPool('chatgpt');
     *     driver.attachContext(page, signal, 'task-123');
     *     const response = await driver.execute(prompt);
     *     driver.detachContext();
     *     factory.releaseToPool(driver);
     *
     * @fires factory:pool_hit - Quando driver reutilizado
     * @fires factory:pool_miss - Quando driver criado (pool vazio)
     * @fires factory:pool_exhausted - Quando todos drivers busy
     * @param {string} targetName - Nome da IA alvo
     * @returns {Promise<TargetDriver>} Driver em estado UNATTACHED (ready para attachContext)
     * @throws {Error} Se pool exhausted ou target não existe
     */
    async acquireFromPool(targetName) {
        await this.ensureReady();

        const key = (targetName || this.getDefaultTarget() || CONSTANTS.DEFAULT_TARGET).toLowerCase();
        const hotPoolEnabled = this._isHotPoolEnabled() && Boolean(this.browserPool);
        const desiredState = hotPoolEnabled ? 'IDLE' : 'UNATTACHED';
        const maxPoolSize = Number(CONFIG['DRIVER_POOL_MAX_SIZE'] || 0);
        const backpressureTimeoutMs = Number(CONFIG['DRIVER_BACKPRESSURE_TIMEOUT_MS'] || 0);

        while (true) {
            const acquisition = await this._serializeByTarget(key, async () => {
                const pool = this.pool.get(key);

                if (!pool) {
                    const err = /** @type {any} */ (new Error(`[FACTORY] Invalid target: ${key}`));
                    err.code = 'INVALID_TARGET';
                    err.details = { target: key };
                    throw err;
                }

                let entry = pool.find(
                    (e) =>
                        !e.busy &&
                        e.driver.state === desiredState &&
                        !e.driver.destroyed &&
                        (!this.browserPool || (e.driver.page && !e.driver.page.isClosed())),
                );

                let acquisitionType = 'hit';

                if (!entry) {
                    if (pool.length < maxPoolSize) {
                        acquisitionType = 'miss';
                        let driver;
                        if (hotPoolEnabled) {
                            driver = await this._createHotDriver(key);
                        } else {
                            driver = await this.createDriver(key, this.config, { skipEnsureReady: true });
                        }

                        entry = {
                            driver,
                            target: key,
                            busy: false,
                            createdAt: Date.now(),
                            lastUsedAt: null,
                            totalUses: 0,
                        };

                        pool.push(entry);
                    } else {
                        return { status: 'exhausted', poolSize: pool.length };
                    }
                }

                entry.busy = true;
                entry.lastUsedAt = Date.now();
                entry.totalUses++;

                if (entry.driver.destroyed) {
                    throw new Error(`[FACTORY] Driver was destroyed (should not happen)`);
                }

                return {
                    status: 'acquired',
                    entry,
                    poolSize: pool.length,
                    acquisitionType,
                };
            });

            if (acquisition.status === 'acquired') {
                const { entry, poolSize, acquisitionType } = acquisition;

                if (acquisitionType === 'hit') {
                    this.metrics.poolHits++;
                    log(
                        'DEBUG',
                        `[FACTORY] POOL HIT: Reusing driver for ${key} (state: ${desiredState}, uses: ${entry.totalUses})`,
                    );
                    this.emit(FACTORY_EVENTS.POOL_HIT, {
                        target: key,
                        poolSize,
                        totalUses: entry.totalUses,
                        poolHits: this.metrics.poolHits,
                    });
                } else {
                    this.metrics.poolMisses++;
                    log(
                        'DEBUG',
                        `[FACTORY] POOL MISS: Creating new driver for ${key} (${hotPoolEnabled ? 'HOT' : 'COLD'})`,
                    );
                    this.emit(FACTORY_EVENTS.POOL_MISS, {
                        target: key,
                        poolSize,
                        poolMisses: this.metrics.poolMisses,
                    });
                }

                log('DEBUG', `[FACTORY] Acquired driver: ${key} (uses: ${entry.totalUses})`);
                return entry.driver;
            }

            this.metrics.poolExhausted++;
            this.metrics.pressureEvents++;

            log(
                'WARN',
                `[FACTORY] POOL EXHAUSTED: All ${maxPoolSize} drivers for ${key} are busy. ` +
                    `Attempting backpressure recovery (timeout: ${backpressureTimeoutMs}ms)`,
            );

            this.emit(FACTORY_EVENTS.POOL_EXHAUSTED, {
                target: key,
                poolSize: acquisition.poolSize,
                maxPoolSize,
                poolExhausted: this.metrics.poolExhausted,
            });

            try {
                await this._waitForDriverRelease(key, backpressureTimeoutMs);
                this.metrics.poolBackpressureRecovered++;
                log('INFO', `[FACTORY] Backpressure recovered: driver released for ${key}`);
                continue;
            } catch (/** @type {any} */ _timeoutError) {
                if (CONFIG['DRIVER_BACKPRESSURE_TEMP']) {
                    log(
                        'WARN',
                        '[FACTORY] Backpressure timeout. Creating temporary driver (will be discarded after use)',
                    );
                    const tempDriver = await this.createDriver(key, this.config, { skipEnsureReady: true });
                    /** @type {IDriver} */ (/** @type {unknown} */ (tempDriver))._isTemporary = true;
                    this.metrics.temporaryDriversCreated++;

                    // Auto-destruction guard: destroy temporary driver after timeout if caller doesn't
                    const tempDestroyTimeoutMs = 5 * 60 * 1000; // 5 minutes max lifetime
                    const autoDestroyTimer = setTimeout(() => {
                        if (!tempDriver.destroyed) {
                            log('WARN', `[FACTORY] Auto-destroying leaked temporary driver (${key})`);
                            this.metrics.temporaryDriversDestroyed = (this.metrics.temporaryDriversDestroyed || 0) + 1;
                            tempDriver.destroy().catch(() => {});
                        }
                    }, tempDestroyTimeoutMs);
                    autoDestroyTimer.unref?.();

                    return tempDriver;
                }

                const err = /** @type {any} */ (
                    new Error(
                        `[FACTORY] POOL_EXHAUSTED: All ${maxPoolSize} drivers for ${key} are busy ` +
                            `(timeout waiting for release: ${backpressureTimeoutMs}ms)`,
                    )
                );
                err.code = 'DRIVER_POOL_EXHAUSTED';
                err.details = {
                    target: key,
                    poolSize: acquisition.poolSize,
                    maxPoolSize,
                    timeoutMs: backpressureTimeoutMs,
                };
                throw err;
            }
        }
    }

    /**
     * ✅ v3.0 (C3): Libera driver de volta ao pool (estado UNATTACHED). ✅ v3.1: Suporta Hot Pool Recycling (estado IDLE
     *
     * - resetSession).
     *
     * @param {TargetDriver} driver - Driver para liberar
     * @returns {Promise<void>}
     */
    async releaseToPool(driver) {
        if (!driver) {
            log('WARN', '[FACTORY] releaseToPool called with null driver');
            return;
        }

        // 1. Encontra entry no pool
        let entry = null;
        let pool = null;

        for (const [_target, targetPool] of this.pool.entries()) {
            entry = targetPool.find((e) => e.driver === driver);
            if (entry) {
                pool = targetPool;
                break;
            }
        }

        if (!entry) {
            log('WARN', `[FACTORY] Driver not found in pool. Destroying.`);
            driver.destroy().catch((err) => {
                log('WARN', `[FACTORY] Error destroying orphan driver: ${err.message}`);
            });
            return;
        }

        // --- MODO HOT POOL (BrowserPool conectado) ---
        if (this.browserPool && this._isHotPoolEnabled()) {
            // Valida integridade da página
            if (driver.destroyed || !driver.page || driver.page.isClosed()) {
                log('WARN', `[FACTORY] Hot Driver released broken (destroyed/closed). Evicting.`);
                if (driver.page && !driver.page.isClosed()) {
                    await driver.page.close().catch(() => {});
                }
                this._evictDriver(pool, entry);
                driver.destroy().catch(() => {});
                return;
            }

            try {
                // Soft Reset (Assíncrono) - Mantém driver busy durante limpeza
                log('DEBUG', `[FACTORY] Recycling Hot Driver (${entry.target})...`);

                const resettableDriver = /** @type {TargetDriver & { resetSession?: () => Promise<void> }} */ (driver);
                if (typeof resettableDriver.resetSession === 'function') {
                    await resettableDriver.resetSession();
                } else if (driver.page) {
                    await driver.page.goto('about:blank').catch(() => {});
                }

                // Força estado IDLE se necessário
                if (driver.state !== 'IDLE') {
                    const mutableDriverState = /** @type {TargetDriver & { _state?: string }} */ (driver);
                    mutableDriverState._state = 'IDLE';
                }

                // Driver limpo e pronto para reuso
                entry.busy = false;

                log('DEBUG', `[FACTORY] Recycled driver: ${entry.target} (uses: ${entry.totalUses})`);

                this.metrics.driversReleased++;
                this.emit(FACTORY_EVENTS.DRIVER_RELEASED, { target: entry.target });
                this._notifyWaiters(entry.target);
            } catch (/** @type {any} */ err) {
                log('ERROR', `[FACTORY] Failed to recycle driver: ${/** @type {any} */ (err).message}. Evicting.`);
                if (driver.page && !driver.page.isClosed()) {
                    await driver.page.close().catch(() => {});
                }
                this._evictDriver(pool, entry);
                driver.destroy().catch(() => {});
            }
            return;
        }

        // --- MODO COLD POOL (Legado) ---

        // ✅ C3: STRICT VALIDATION - Driver DEVE estar UNATTACHED
        if (driver.state !== 'UNATTACHED') {
            log(
                'ERROR',
                `[FACTORY] C3 VALIDATION FAILED: Driver released but not UNATTACHED (state: ${driver.state}). ` +
                    `Expected detachContext() before release. Attempting force detach...`,
            );

            // ✅ C3: Tenta force detach (C2 idempotência)
            const detachableDriver = /** @type {TargetDriver & { isContextAttached?: () => boolean }} */ (driver);
            if (typeof detachableDriver.isContextAttached === 'function' && detachableDriver.isContextAttached()) {
                try {
                    driver.detachContext({ force: true });

                    log(
                        'WARN',
                        `[FACTORY] C3: Force detach succeeded. Driver now ${driver.state}. ` +
                            `Marking available (warning: incomplete cleanup may have occurred).`,
                    );
                } catch (/** @type {any} */ detachErr) {
                    log(
                        'ERROR',
                        `[FACTORY] C3 CRITICAL: Force detach FAILED: ${/** @type {any} */ (detachErr).message}. ` +
                            `Driver compromised - removing from pool (will be destroyed on next GC).`,
                    );

                    this._evictDriver(pool, entry);
                    driver.destroy().catch(() => {});
                    this.metrics.errors++;
                    return;
                }
            }
        }

        // ✅ C3: Verificação final (paranoia check)
        if (driver.state !== 'UNATTACHED') {
            log('ERROR', `[FACTORY] C3 PARANOIA CHECK FAILED. Removing from pool.`);
            this._evictDriver(pool, entry);
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
            poolSize: /** @type {any} */ (pool).length,
            driversReleased: this.metrics.driversReleased,
        });

        this._notifyWaiters(entry.target);
        return undefined;
    }

    /**
     * Helper para remover driver do pool.
     *
     * @private
     */
    _evictDriver(/** @type {any} */ pool, /** @type {any} */ entry) {
        const index = pool.indexOf(entry);
        if (index !== -1) {
            pool.splice(index, 1);
        }
        this.metrics.driversEvicted++;
    }

    /**
     * ✅ v3.0: Health checks & garbage collection.
     *
     * Remove drivers idle por > IDLE_TIMEOUT_MS SE pool > MIN_POOL_SIZE.
     *
     * @private
     */
    _startHealthChecks() {
        if (this.healthTimer) {
            return;
        }

        this.healthTimer = setInterval(() => {
            try {
                const now = Date.now();
                const idleTimeoutMs = Number(CONFIG['DRIVER_IDLE_TIMEOUT_MS'] || 0);
                const minPoolSize = Number(CONFIG['DRIVER_POOL_MIN_SIZE'] || 0);

                for (const [target, pool] of this.pool.entries()) {
                    // Remove drivers idle por muito tempo (se pool > MIN)
                    for (let i = pool.length - 1; i >= 0; i--) {
                        const entry = pool[i];

                        if (entry.busy || entry.driver.destroyed) {
                            continue;
                        }

                        const idleTime = now - (entry.lastUsedAt || entry.createdAt);
                        const shouldRemove = idleTime > idleTimeoutMs && pool.length > minPoolSize;

                        if (shouldRemove) {
                            log('DEBUG', `[FACTORY] GC: Removing idle driver: ${target} (idle: ${idleTime}ms)`);

                            // Destrói driver
                            entry.driver.destroy().catch((/** @type {any} */ err) => {
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

                // ✅ v3.1: Hot Pool Health Check
                if (this.browserPool && this._isHotPoolEnabled()) {
                    for (const pool of this.pool.values()) {
                        for (const entry of pool) {
                            // Check COLD (attached) drivers for closed pages
                            const pooledDriver = /** @type {TargetDriver & { isCold?: boolean }} */ (entry.driver);
                            if (
                                !entry.busy &&
                                pooledDriver.isCold &&
                                pooledDriver.page &&
                                pooledDriver.page.isClosed()
                            ) {
                                log(
                                    'WARN',
                                    `[FACTORY] Health Check: Found dead page in COLD driver (${entry.target}). Evicting.`,
                                );
                                this._evictDriver(pool, entry);
                                entry.driver.destroy().catch(() => {});

                                // Replenish pool (async)
                                this._createHotDriver(entry.target).catch(() => {});
                            }
                        }
                    }
                }
            } catch (/** @type {any} */ err) {
                log('ERROR', `[FACTORY] Health check error: ${/** @type {any} */ (err).message}`);
            }
        }, CONSTANTS.HEALTH_CHECK_INTERVAL_MS);
    }

    /**
     * ✅ C1: Aguarda release de driver (backpressure strategy).
     *
     * Escuta evento DRIVER_RELEASED e tenta acquire novamente quando disponível.
     *
     * @private
     * @param {string} target - Target name
     * @param {number} timeout - Timeout em ms
     * @returns {Promise<void>} Resolvida quando algum driver for liberado
     * @throws {Error} Se timeout
     */
    _waitForDriverRelease(target, timeout) {
        return new Promise((/** @type {() => void} */ resolve, reject) => {
            const queue = this._waiters.get(target) || [];
            const waiter = {
                resolve: () => {
                    if (waiter.done) return;
                    waiter.done = true;
                    clearTimeout(waiter.timer);
                    this.metrics.waitersWoken++;
                    resolve();
                },
                reject: (/** @type {any} */ err) => {
                    if (waiter.done) return;
                    waiter.done = true;
                    clearTimeout(waiter.timer);
                    reject(err);
                },
                timer: /** @type {any} */ (null),
                done: false,
            };

            waiter.timer = setTimeout(() => {
                const currentQueue = this._waiters.get(target) || [];
                const index = currentQueue.indexOf(waiter);
                if (index !== -1) {
                    currentQueue.splice(index, 1);
                }
                if (currentQueue.length === 0) {
                    this._waiters.delete(target);
                }
                this.metrics.waitersTimedOut++;
                waiter.reject(new Error('TIMEOUT'));
            }, timeout);

            queue.push(waiter);
            this._waiters.set(target, queue);
            this.metrics.waitersQueued++;
        });
    }

    /**
     * Acorda próximo waiter FIFO para um target.
     *
     * @private
     * @param {string} target
     */
    _notifyWaiters(target) {
        const queue = this._waiters.get(target);
        if (!queue || queue.length === 0) {
            return;
        }

        while (queue.length > 0) {
            const waiter = queue.shift();
            if (!waiter || waiter.done) {
                continue;
            }
            waiter.resolve();
            break;
        }

        if (queue.length === 0) {
            this._waiters.delete(target);
        } else {
            this._waiters.set(target, queue);
        }
    }

    /**
     * ✅ v3.0: Para health checks timer.
     *
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
     *
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
     * @returns {object | null} Metadata { path, className } ou null se não existe
     */
    getDriverMetadata(targetName) {
        const key = (targetName || '').toLowerCase();
        return this.registry[key] || null;
    }

    /**
     * Obtém metadata de todos os drivers.
     *
     * @returns {any} Clone do registry completo
     */
    getAllDriversMetadata() {
        return { ...this.registry };
    }

    /**
     * Lista targets atualmente descobertos.
     *
     * @returns {string[]}
     */
    getAvailableTargets() {
        return Object.keys(this.registry);
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
        return this.defaultTargetKey || String(CONFIG['DEFAULT_MODEL_ID'] || CONSTANTS.DEFAULT_TARGET).toLowerCase();
    }

    /**
     * ✅ v3.0: Health Check Endpoint (Pool-aware).
     *
     * @returns {Promise<Record<string, unknown>>} Health status completo
     */
    async getHealth() {
        await this.ensureReady({ warmup: false });

        const poolStats = [];
        for (const [target, pool] of this.pool.entries()) {
            const busy = pool.filter((e) => e.busy).length;
            const idle = pool.filter((e) => !e.busy).length;

            poolStats.push({
                target,
                total: pool.length,
                busy,
                idle,
                destroyed: pool.filter((e) => e.driver.destroyed).length,
            });
        }

        return {
            discovered: Object.keys(this.registry).length,
            targets: Object.keys(this.registry),
            defaultTarget: this.getDefaultTarget(),
            failedDrivers: Array.from(this.failedDrivers),

            // ✅ v3.0: Pool stats
            pool: {
                enabled: CONFIG['DRIVER_POOL_ENABLED'],
                hotPoolEnabled: this._isHotPoolEnabled() && Boolean(this.browserPool),
                totalSize: this._getTotalPoolSize(),
                maxPoolSize: CONFIG['DRIVER_POOL_MAX_SIZE'],
                minPoolSize: CONFIG['DRIVER_POOL_MIN_SIZE'],
                idleTimeout: CONFIG['DRIVER_IDLE_TIMEOUT_MS'],
                warmupTargets: CONFIG['DRIVER_WARMUP_TARGETS'],
                byTarget: poolStats,
            },

            metrics: {
                driversCreated: this.metrics.driversCreated,
                poolHits: this.metrics.poolHits,
                poolMisses: this.metrics.poolMisses,
                poolHitRate:
                    this.metrics.poolMisses > 0
                        ? ((this.metrics.poolHits / (this.metrics.poolHits + this.metrics.poolMisses)) * 100).toFixed(
                              2,
                          ) + '%'
                        : 'N/A',
                poolExhausted: this.metrics.poolExhausted,
                driversReleased: this.metrics.driversReleased,
                driversDestroyed: this.metrics.driversDestroyed,
                driversEvicted: this.metrics.driversEvicted,
                errors: this.metrics.errors,
                discoveryTime: this.metrics.discoveryTime,
                pressureEvents: this.metrics.pressureEvents,
                waitersQueued: this.metrics.waitersQueued,
                waitersWoken: this.metrics.waitersWoken,
                waitersTimedOut: this.metrics.waitersTimedOut,
                createSerializationPasses: this.metrics.createSerializationPasses,
            },

            config: {
                targetsDir: CONSTANTS.TARGETS_DIR,
                defaultTarget: this.getDefaultTarget(),
                validateOnBoot: true,
                maxPoolSize: CONFIG['DRIVER_POOL_MAX_SIZE'],
                minPoolSize: CONFIG['DRIVER_POOL_MIN_SIZE'],
                idleTimeout: CONFIG['DRIVER_IDLE_TIMEOUT_MS'],
            },
        };
    }

    /**
     * Obtém métricas de performance.
     *
     * @returns {any} Métricas completas
     */
    getMetrics() {
        return { ...this.metrics };
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
                const driver = entry?.driver;
                if (!driver) {
                    continue;
                }
                if (typeof driver.destroy !== 'function') {
                    log('WARN', `[FACTORY] Driver entry for '${target}' has no destroy() function. Skipping.`);
                    continue;
                }
                if (!driver.destroyed) {
                    destroyPromises.push(
                        driver.destroy().catch((/** @type {any} */ err) => {
                            log('WARN', `[FACTORY] Error destroying driver ${target}: ${err.message}`);
                        }),
                    );
                }
            }
            pool.length = 0; // Clear pool
        }

        await Promise.allSettled(destroyPromises);

        this._ready = false;
        this._poolInitialized = false;
        this._discovered = false;
        this._startPromise = null;
        this.registry = Object.create(null);
        this._waiters.clear();
        this._refreshAvailableTargetsExport();

        log('INFO', '[FACTORY] Pool shutdown complete');
    }

    /**
     * ✅ P0-U6: Retorna expected domain para target.
     *
     * Usado para validar que página está no domain correto antes de attach.
     *
     * @private
     * @param {string} target - Target name (chatgpt, gemini, etc)
     * @returns {string | null} Expected domain ou null se não mapeado
     */
    _getExpectedDomain(target) {
        const domains = {
            chatgpt: 'chatgpt.com',
            gemini: 'gemini.google.com',
            claude: 'claude.ai',
            openai: 'openai.com',
        };
        return /** @type {any} */ (/** @type {any} */ (domains)[target]) || null;
    }

    /**
     * ✅ v3.1: Define o pool de browsers para uso em Hot Pool. Deve ser chamado durante o bootstrap (main.js).
     *
     * @param {object} pool - Instância de BrowserPoolManager
     */
    setBrowserPool(pool) {
        if (!pool) {
            throw new Error('[FACTORY] browserPool cannot be null');
        }
        if (!this._isHotPoolEnabled()) {
            this.browserPool = null;
            log('WARN', '[FACTORY] DRIVER_HOT_POOL_ENABLED=false — BrowserPool attachment skipped.');
            return;
        }
        this.browserPool = pool;
        log('INFO', '[FACTORY] BrowserPool attached. Hot Pool strategies enabled.');
    }

    /**
     * Remove referência do BrowserPool (detach explícito). Útil para testes/reconfiguração e fallback operacional.
     */
    clearBrowserPool() {
        this.browserPool = null;
        log('INFO', '[FACTORY] BrowserPool detached.');
    }

    /**
     * Indica se modo hot pool está habilitado.
     *
     * @private
     * @returns {boolean}
     */
    _isHotPoolEnabled() {
        return String(process.env['DRIVER_HOT_POOL_ENABLED'] ?? 'true').toLowerCase() !== 'false';
    }

    /**
     * ✅ v3.1: Cria um driver "quente" (com página já alocada). Orquestra a criação do driver E a alocação de página do
     * BrowserPool.
     *
     * @private
     * @param {string} target - Target do driver (ex: 'chatgpt')
     * @returns {Promise<any>} Driver em estado IDLE (com página anexa)
     */
    async _createHotDriver(target) {
        if (!this.browserPool || !this._isHotPoolEnabled()) {
            throw new Error(
                '[FACTORY] Cannot create Hot Driver: BrowserPool not attached. Call setBrowserPool() first.',
            );
        }

        // 1. Cria driver (Estado: UNATTACHED)
        const driver = await this.createDriver(target, this.config, { skipEnsureReady: true });

        try {
            // 2. Aloca página do BrowserPool
            log('DEBUG', `[FACTORY] Allocating page for Hot Driver (${target})...`);
            const page = await this.browserPool.allocate(target);

            // 3. Attach context (Warmup)
            // Cria um controller temporário para manter o driver em estado válido (IDLE)
            // Este signal será substituído quando a task real assumir o driver (Hot Swap)
            const warmupController = new AbortController();

            const attachableDriver = /**
             * @type {TargetDriver & {
             *     attachContext: (
             *         page: import('puppeteer-core').Page,
             *         signal?: AbortSignal | null,
             *         taskId?: string | null,
             *     ) => void;
             * }}
             */ (driver);
            attachableDriver.attachContext(page, warmupController.signal, 'pool-warmup');

            // Marca driver como 'Hot' para métricas
            const hotMarkerDriver = /** @type {TargetDriver & { _isHot?: boolean }} */ (driver);
            hotMarkerDriver._isHot = true;

            log('DEBUG', `[FACTORY] Hot Driver created: ${target} (IDLE)`);
            return driver;
        } catch (/** @type {any} */ err) {
            // Rollback: Destrói driver se falhar alocação de página
            log('ERROR', `[FACTORY] Failed to create Hot Driver for ${target}: ${/** @type {any} */ (err).message}`);

            if (driver && typeof driver.destroy === 'function') {
                void driver.destroy().catch(() => {});
            }
            throw err;
        }
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

/**
 * Cria novo driver para target.
 *
 * @type {typeof factory.createDriver}
 */
export const createDriver = factory.createDriver.bind(factory);

/**
 * Inicializa lifecycle explícito da factory.
 *
 * @type {typeof factory.start}
 */
export const start = factory.start.bind(factory);

/**
 * Garante factory pronta de forma lazy.
 *
 * @type {typeof factory.ensureReady}
 */
export const ensureReady = factory.ensureReady.bind(factory);

/**
 * Adquire driver do pool.
 *
 * @type {typeof factory.acquireFromPool}
 */
export const acquireFromPool = factory.acquireFromPool.bind(factory);

/**
 * Libera driver para o pool.
 *
 * @type {any}
 */
export const releaseToPool = factory.releaseToPool.bind(factory);

/**
 * Inicializa pool de drivers.
 *
 * @type {typeof factory.initializePool}
 */
export const initializePool = factory.initializePool.bind(factory);

/**
 * Desliga factory e pool.
 *
 * @type {typeof factory.shutdown}
 */
export const shutdown = factory.shutdown.bind(factory);

/**
 * Adiciona listener de evento.
 *
 * @type {any}
 */
export const on = factory.on.bind(factory);

/**
 * Adiciona listener único de evento.
 *
 * @type {any}
 */
export const once = factory.once.bind(factory);

/**
 * Remove listener de evento.
 *
 * @type {any}
 */
export const off = factory.off.bind(factory);

/**
 * Emite evento.
 *
 * @type {typeof factory.emit}
 */
export const emit = factory.emit.bind(factory);

/**
 * Obtém metadados de driver específico.
 *
 * @type {typeof factory.getDriverMetadata}
 */
export const getDriverMetadata = factory.getDriverMetadata.bind(factory);

/**
 * Obtém metadados de todos os drivers.
 *
 * @type {typeof factory.getAllDriversMetadata}
 */
export const getAllDriversMetadata = factory.getAllDriversMetadata.bind(factory);

/**
 * Lista targets atualmente disponíveis.
 *
 * @type {typeof factory.getAvailableTargets}
 */
export const getAvailableTargets = factory.getAvailableTargets.bind(factory);

/**
 * Verifica se target está disponível.
 *
 * @type {typeof factory.hasTarget}
 */
export const hasTarget = factory.hasTarget.bind(factory);

/**
 * Obtém target padrão.
 *
 * @type {typeof factory.getDefaultTarget}
 */
export const getDefaultTarget = factory.getDefaultTarget.bind(factory);

/**
 * Obtém status de saúde da factory.
 *
 * @type {typeof factory.getHealth}
 */
export const getHealth = factory.getHealth.bind(factory);

/**
 * Obtém métricas da factory.
 *
 * @type {typeof factory.getMetrics}
 */
export const getMetrics = factory.getMetrics.bind(factory);

/**
 * Lista de targets disponíveis.
 *
 * @type {string[]}
 */
export const availableTargets = AVAILABLE_TARGETS_EXPORT;

/**
 * Configuração da factory.
 *
 * @type {object}
 */
/**
 * Eventos da factory.
 *
 * @type {object}
 */
/**
 * Instância da factory.
 *
 * @type {object}
 */
export { factory, CONSTANTS as FACTORY_CONFIG, FACTORY_EVENTS };
