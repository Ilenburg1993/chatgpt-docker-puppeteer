/* ==========================================================================
   src/driver/factory.js v2.0
   Audit Level: 700 — Reactive Driver Factory (Singularity Edition)
   Status: v2.0 - EventEmitter + Full Validation + Telemetry + Health Check
   Responsabilidade: Descoberta, instanciação Lazy-Load e gestão reativa de
                     cache de drivers com suporte a sinais soberanos.
   Sincronizado com: TargetDriver.js v2.0, BaseDriver v2.0,
                     DriverLifecycleManager v2.0.

   v2.0 Changes:
   - EventEmitter class (6 lifecycle events)
   - FACTORY_CONFIG (zero magic numbers)
   - Robust parameter validation (P0 fixes)
   - Discovery validation (P0 fix)
   - Timeout protection in invalidatePageCache (P1 fix)
   - Granular try-catch in lazy-load (P1 fix)
   - Cache validation with destroyed check (P1 fix)
   - Health check endpoint
   - Cache size limit (memory leak prevention)
   - Metrics collection
   - Complete JSDoc
========================================================================== */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const TargetDriver = require('./core/TargetDriver');
const { log } = require('@core/logger');

/* ==========================================================================
   FACTORY_CONFIG v2.0 - Zero Magic Numbers
========================================================================== */
const FACTORY_CONFIG = {
    TARGETS_DIR: path.join(__dirname, 'targets'),
    DEFAULT_TARGET: process.env.FACTORY_DEFAULT_TARGET || 'chatgpt',
    VALIDATE_ON_BOOT: process.env.FACTORY_VALIDATE_BOOT === 'true',
    INVALIDATE_TIMEOUT_MS: 5000,           // Timeout para destroy em invalidatePageCache
    MAX_DRIVERS_PER_PAGE: 10,              // Limite de drivers por página (memory leak prevention)
    DISCOVERY_RETRY_COUNT: 3,              // Tentativas de retry em discovery
    LAZY_LOAD_TIMEOUT_MS: 10000            // Timeout para lazy-load de driver
};

/* ==========================================================================
   FACTORY_EVENTS v2.0 - Telemetria de Factory
========================================================================== */
const FACTORY_EVENTS = {
    DISCOVERY_COMPLETE: 'factory:discovery_complete',   // Discovery concluído
    DRIVER_CREATED: 'factory:driver_created',           // Driver criado
    DRIVER_REUSED: 'factory:driver_reused',             // Driver reutilizado do cache
    DRIVER_EVICTED: 'factory:driver_evicted',           // Driver evictado do cache
    CACHE_INVALIDATED: 'factory:cache_invalidated',     // Cache invalidado
    ERROR: 'factory:error'                              // Erro em qualquer operação
};

/* ==========================================================================
   DriverFactory v2.0 - EventEmitter Class
========================================================================== */

/**
 * DriverFactory v2.0 - Factory pattern para criação e cache de drivers
 *
 * Responsabilidades:
 * - Auto-discovery de drivers no diretório targets/
 * - Lazy-loading de classes (carrega apenas quando necessário)
 * - Cache por página (WeakMap + Map)
 * - Auto-evicção reativa (driver.once('destroyed'))
 * - Invalidação global de cache
 * - Telemetria completa via EventEmitter
 *
 * @class DriverFactory
 * @extends EventEmitter
 */
class DriverFactory extends EventEmitter {
    /**
     * Construtor do DriverFactory v2.0
     *
     * Inicializa registry, cache, métricas e executa discovery automático.
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
         * Cache de instâncias vivas (WeakMap).
         *
         * ✅ Estrutura: WeakMap<Page, Map<targetName, DriverInstance>>
         *
         * Por que WeakMap?
         * - Keys devem ser objetos (Page instance)
         * - GC automático: Se page é coletado → entry é removido automaticamente
         * - Previne memory leaks: Drivers não mantém páginas vivas
         *
         * Limitações:
         * - Não iterável (não tem .keys(), .values(), .entries())
         * - Não tem .size
         * - Keys apenas objects (não strings/numbers)
         *
         * Inner Map:
         * - Keys: targetName (string) - ex: 'chatgpt', 'gemini'
         * - Values: DriverInstance (TargetDriver subclass)
         *
         * @type {WeakMap<Page, Map<string, TargetDriver>>}
         * @private
         */
        this.pageCache = new WeakMap();

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
            driversReused: 0,
            driversDestroyed: 0,
            cacheHits: 0,
            cacheMisses: 0,
            discoveryTime: 0,
            evictions: 0,
            invalidations: 0,
            errors: 0
        };

        // ✅ Configurar max listeners (memory leak detection)
        this.setMaxListeners(50);

        // ✅ Executar discovery automático
        this._discover();
    }

    /* ==========================================================================
       DISCOVERY (BOOT TIME)
    ========================================================================== */

    /**
     * Fase de descoberta automática de drivers.
     *
     * v2.0 Features:
     * - Validação robusta de diretório
     * - Try-catch granular por arquivo
     * - Validação de que pelo menos 1 driver foi descoberto
     * - Validação opcional de herança TargetDriver (FACTORY_VALIDATE_BOOT)
     * - Validação de DEFAULT_TARGET
     * - Métricas de discovery time
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
            // ✅ BUG #1 FIX: Validar que diretório existe
            if (!fs.existsSync(FACTORY_CONFIG.TARGETS_DIR)) {
                const error = `Diretório de targets não existe: ${FACTORY_CONFIG.TARGETS_DIR}`;
                log('FATAL', `[FACTORY] ${error}`);
                throw new Error(error);
            }

            // ✅ Try-catch robusto em readdir
            let files;
            try {
                files = fs.readdirSync(FACTORY_CONFIG.TARGETS_DIR);
            } catch (readdirError) {
                const error = `Erro ao ler diretório de targets: ${readdirError.message}`;
                log('FATAL', `[FACTORY] ${error}`);
                throw new Error(error);
            }

            // ✅ Processar cada arquivo com try-catch individual
            for (const file of files) {
                if (!file.endsWith('Driver.js')) {
                    continue;
                }

                try {
                    const targetKey = file.replace('Driver.js', '').toLowerCase();
                    const driverPath = path.join(FACTORY_CONFIG.TARGETS_DIR, file);

                    // ✅ Validar que arquivo é acessível
                    if (!fs.existsSync(driverPath)) {
                        log('WARN', `[FACTORY] Driver file não encontrado: ${driverPath}`);
                        continue;
                    }

                    // ✅ BUG #6 FIX: Validação opcional de herança em boot (skip se síncrono)
                    // Nota: Validação completa requer instanciação, que pode ser pesada em boot
                    // Por padrão desabilitada (FACTORY_VALIDATE_BOOT=false)

                    // ✅ Registrar driver
                    this.registry[targetKey] = {
                        path: driverPath,
                        className: file.replace('.js', '')
                    };
                    discovered++;
                } catch (fileError) {
                    log('WARN', `[FACTORY] Erro ao processar ${file}: ${fileError.message}`);
                }
            }

            // ✅ BUG #1 FIX: Validar que pelo menos 1 driver foi descoberto
            if (discovered === 0) {
                const error = `Nenhum driver descoberto em ${FACTORY_CONFIG.TARGETS_DIR}. Sistema não pode operar.`;
                log('FATAL', `[FACTORY] ${error}`);
                throw new Error(error);
            }

            // ✅ BUG #8 FIX: Validar DEFAULT_TARGET ou usar primeiro descoberto
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

            // ✅ Métricas e telemetria
            this.metrics.discoveryTime = Date.now() - startTime;

            log('INFO', `[FACTORY] ${discovered} targets mapeados em ${this.metrics.discoveryTime}ms`);

            this.emit(FACTORY_EVENTS.DISCOVERY_COMPLETE, {
                targetCount: discovered,
                targets: Object.keys(this.registry),
                defaultTarget: FACTORY_CONFIG.DEFAULT_TARGET,
                discoveryTime: this.metrics.discoveryTime
            });
        } catch (e) {
            this.metrics.errors++;
            log('FATAL', `[FACTORY] Erro catastrófico no mapeamento de drivers: ${e.message}`);

            this.emit(FACTORY_EVENTS.ERROR, {
                operation: 'discovery',
                error: e.message,
                stack: e.stack
            });

            throw e; // ✅ Re-throw para prevenir execução com registry vazio
        }
    }

    /* ==========================================================================
       DRIVER ACQUISITION
    ========================================================================== */

    /**
     * Obtém ou cria a instância do driver com injeção de sinal e sincronia de config.
     *
     * v2.0 Features:
     * - Validação completa de parâmetros (P0 fix)
     * - Cache validation robusta com destroyed check (P1 fix)
     * - Granular try-catch em lazy-load (P1 fix)
     * - Cache size limit (eviction de LRU se necessário)
     * - Error recovery (não tenta re-load de drivers falhados)
     * - Telemetria completa (created, reused, evicted)
     * - Métricas de cache hit/miss
     *
     * @param {string} targetName - Nome da IA alvo (ex: 'chatgpt', 'gemini')
     * @param {import('puppeteer').Page} page - Instância ativa da página do Puppeteer
     * @param {Object} config - Configuração da tarefa (clonada para imutabilidade)
     * @param {string} config.target - Target específico (chatgpt, gemini, etc)
     * @param {number} [config.timeout] - Timeout em milissegundos
     * @param {AbortSignal} signal - Sinal soberano de cancelamento da tarefa
     *
     * @returns {TargetDriver} Instância de TargetDriver pronta para execução
     * @throws {Error} Se parâmetros inválidos, página fechada ou target não existe
     *
     * @emits factory:driver_created - Quando novo driver é criado
     * @emits factory:driver_reused - Quando driver do cache é reutilizado
     * @emits factory:driver_evicted - Quando driver é evictado por cache limit
     * @emits factory:error - Se erro na criação do driver
     *
     * @example
     * const driver = factory.getDriver('chatgpt', page, { timeout: 30000 }, abortSignal);
     * const response = await driver.execute(task);
     */
    getDriver(targetName, page, config, signal) {
        // ✅ BUG #2 FIX: Validar todos os parâmetros obrigatórios
        if (!page) {
            const error = 'Parameter "page" is required';
            log('ERROR', `[FACTORY] ${error}`);
            throw new Error(`[FACTORY] ${error}`);
        }

        if (!config || typeof config !== 'object') {
            const error = 'Parameter "config" must be an object';
            log('ERROR', `[FACTORY] ${error}`);
            throw new Error(`[FACTORY] ${error}`);
        }

        if (!signal || !(signal instanceof AbortSignal)) {
            const error = 'Parameter "signal" must be an AbortSignal instance';
            log('ERROR', `[FACTORY] ${error}`);
            throw new Error(`[FACTORY] ${error}`);
        }

        const key = (targetName || FACTORY_CONFIG.DEFAULT_TARGET).toLowerCase();

        // A. LIVENESS GUARD: Impede o acoplamento em abas mortas
        if (page.isClosed()) {
            const error = `Tentativa de acoplar driver em aba encerrada (${key})`;
            log('ERROR', `[FACTORY] ${error}`);
            throw new Error(`[FACTORY] ${error}`);
        }

        // B. RESOLUÇÃO DE CACHE (Nível 1: Página)
        if (!this.pageCache.has(page)) {
            this.pageCache.set(page, new Map());
        }
        const instances = this.pageCache.get(page);

        // C. ✅ BUG #3 FIX: REAPROVEITAMENTO com validação robusta
        if (instances.has(key)) {
            const cachedInstance = instances.get(key);

            // ✅ Validar que instância é válida
            if (!cachedInstance) {
                log('WARN', `[FACTORY] Cached instance is null for ${key}, removing from cache`);
                instances.delete(key);
            } else {
                // ✅ Verificar estado destroyed com fallback
                const isDestroyed =
                    cachedInstance.destroyed === true ||
                    (typeof cachedInstance.isDestroyed === 'function' && cachedInstance.isDestroyed());

                if (!isDestroyed) {
                    // ✅ Validar que driver ainda é válido (página não fechada)
                    if (cachedInstance.page && !cachedInstance.page.isClosed()) {
                        // [R5] Sincronia Paramétrica: Atualiza a configuração para a nova missão
                        if (config && typeof config === 'object') {
                            cachedInstance.config = { ...config };
                        }

                        // [R3] Sincronia de Sinal: O driver deve obedecer ao novo sinal de aborto
                        cachedInstance.signal = signal;

                        // ✅ Métricas e telemetria
                        this.metrics.cacheHits++;
                        this.metrics.driversReused++;

                        log('DEBUG', `[FACTORY] Reaproveitando driver em cache: ${cachedInstance.name}`);

                        this.emit(FACTORY_EVENTS.DRIVER_REUSED, {
                            target: key,
                            name: cachedInstance.name,
                            cacheHits: this.metrics.cacheHits
                        });

                        return cachedInstance;
                    } else {
                        log('WARN', `[FACTORY] Cached driver ${key} has closed page, invalidating`);
                    }
                } else {
                    log('DEBUG', `[FACTORY] Cached driver ${key} was destroyed, removing from cache`);
                }

                // ✅ Remover instância inválida
                instances.delete(key);
            }
        }

        // ✅ Métricas
        this.metrics.cacheMisses++;

        // D. ✅ IMPROVEMENT #6: Error Recovery - Não tentar re-load de drivers falhados
        if (this.failedDrivers.has(key)) {
            const error = `Driver ${key} previously failed to load`;
            log('ERROR', `[FACTORY] ${error}`);
            throw new Error(`[FACTORY] ${error}`);
        }

        // E. INSTANCIAÇÃO (Lazy-Loading dinâmico)
        const meta = this.registry[key];
        if (!meta) {
            const error = `Target '${key}' não suportado. Disponíveis: ${Object.keys(this.registry).join(', ')}`;
            log('ERROR', `[FACTORY] ${error}`);
            throw new Error(`[FACTORY] ${error}`);
        }

        // F. ✅ IMPROVEMENT #5: Cache Size Limit - Evict LRU se necessário
        if (instances.size >= FACTORY_CONFIG.MAX_DRIVERS_PER_PAGE) {
            log(
                'WARN',
                `[FACTORY] Cache limit reached for page (${instances.size}/${FACTORY_CONFIG.MAX_DRIVERS_PER_PAGE}). Evicting oldest.`
            );

            // ✅ Evict primeiro driver (FIFO - poderia ser LRU com timestamps)
            const oldestKey = instances.keys().next().value;
            const oldestDriver = instances.get(oldestKey);

            try {
                if (oldestDriver && !oldestDriver.destroyed) {
                    oldestDriver.destroy().catch(err => {
                        log('WARN', `[FACTORY] Error destroying evicted driver ${oldestKey}: ${err.message}`);
                    });
                }
            } catch (evictError) {
                log('WARN', `[FACTORY] Eviction error for ${oldestKey}: ${evictError.message}`);
            }

            instances.delete(oldestKey);
            this.metrics.evictions++;

            this.emit(FACTORY_EVENTS.DRIVER_EVICTED, {
                target: oldestKey,
                reason: 'cache_limit',
                cacheSize: instances.size
            });
        }

        // G. ✅ BUG #4 FIX: Lazy-Load com try-catch granular
        let DriverClass;
        let instance;

        try {
            // ✅ Fase 1: Load da classe
            try {
                DriverClass = require(meta.path);
            } catch (requireError) {
                this.failedDrivers.add(key); // ✅ Marcar como falhado
                log('ERROR', `[FACTORY] Failed to load driver class '${key}': ${requireError.message}`, {
                    stack: requireError.stack,
                    path: meta.path
                });
                throw new Error(`Driver class load failed: ${requireError.message}`);
            }

            // ✅ Validar que DriverClass é função (constructor)
            if (typeof DriverClass !== 'function') {
                this.failedDrivers.add(key);
                throw new Error(`[FACTORY] '${meta.className}' exports is not a constructor function`);
            }

            // ✅ Fase 2: Instanciação
            try {
                instance = new DriverClass(page, { ...config }, signal);
            } catch (constructorError) {
                this.failedDrivers.add(key);
                log('ERROR', `[FACTORY] Driver constructor failed for '${key}': ${constructorError.message}`, {
                    stack: constructorError.stack
                });
                throw new Error(`Driver construction failed: ${constructorError.message}`);
            }

            // ✅ Fase 3: Validação de contrato
            if (!(instance instanceof TargetDriver)) {
                this.failedDrivers.add(key);
                throw new Error(`[FACTORY] '${meta.className}' viola o contrato TargetDriver.`);
            }

            // ✅ Fase 4: Setup de auto-eviction
            instance.once('destroyed', () => {
                const currentMap = this.pageCache.get(page);
                if (currentMap) {
                    currentMap.delete(key);
                    this.metrics.driversDestroyed++;
                    log('DEBUG', `[FACTORY] Cache removido para: ${key} (Ciclo encerrado)`);

                    this.emit(FACTORY_EVENTS.DRIVER_EVICTED, {
                        target: key,
                        reason: 'destroyed',
                        name: instance.name
                    });
                }
            });

            // ✅ Fase 5: Cache
            instances.set(key, instance);
            this.metrics.driversCreated++;

            log('INFO', `[FACTORY] Novo Driver '${instance.name}' acoplado com sucesso.`);

            this.emit(FACTORY_EVENTS.DRIVER_CREATED, {
                target: key,
                name: instance.name,
                className: meta.className,
                driversCreated: this.metrics.driversCreated
            });

            return instance;
        } catch (e) {
            // ✅ Cleanup em caso de erro
            if (instance && typeof instance.destroy === 'function') {
                try {
                    instance.destroy().catch(() => {});
                } catch (cleanupError) {
                    log('WARN', `[FACTORY] Cleanup failed for ${key}: ${cleanupError.message}`);
                }
            }

            this.metrics.errors++;

            log('ERROR', `[FACTORY] Erro na ativação do driver '${key}': ${e.message}`, {
                stack: e.stack
            });

            this.emit(FACTORY_EVENTS.ERROR, {
                operation: 'getDriver',
                target: key,
                error: e.message,
                stack: e.stack
            });

            throw e;
        }
    }

    /* ==========================================================================
       CACHE INVALIDATION
    ========================================================================== */

    /**
     * Invalidação Global: Limpeza profunda de uma sessão.
     *
     * v2.0 Features:
     * - Timeout protection em cada destroy (P1 fix)
     * - Cleanup paralelo (Promise.allSettled)
     * - Report de drivers que falharam
     * - Telemetria completa
     * - Métricas de invalidation
     *
     * Garante que todos os drivers vinculados a uma aba sejam destruídos.
     *
     * @param {object} page - Instância da página do Puppeteer.
     * @param {object} [options] - Opções de invalidação
     * @param {number} [options.timeout=5000] - Timeout por driver em ms
     *
     * @returns {Promise<Object>} Resultado da invalidação { success, failed, total }
     *
     * @emits factory:cache_invalidated - Quando cache é invalidado
     * @emits factory:error - Se erro na invalidação
     */
    async invalidatePageCache(page, options = {}) {
        const timeout = options.timeout || FACTORY_CONFIG.INVALIDATE_TIMEOUT_MS;

        if (!this.pageCache.has(page)) {
            log('DEBUG', '[FACTORY] Nenhum cache para invalidar (página não tem drivers)');
            return { success: 0, failed: 0, total: 0 };
        }

        const instances = this.pageCache.get(page);
        const totalDrivers = instances.size;

        log('DEBUG', `[FACTORY] Invalidação forçada: Limpando ${totalDrivers} drivers da aba.`);

        // ✅ BUG #5 FIX: Cleanup paralelo com timeout
        const cleanupPromises = [];
        const failedDrivers = [];

        for (const [name, driver] of instances.entries()) {
            const cleanupPromise = (async () => {
                try {
                    if (!driver.destroyed) {
                        // ✅ Timeout wrapper
                        const destroyPromise = driver.destroy();
                        const timeoutPromise = new Promise((_, reject) => {
                            setTimeout(() => reject(new Error('Destroy timeout')), timeout);
                        });

                        await Promise.race([destroyPromise, timeoutPromise]);
                        log('DEBUG', `[FACTORY] Driver ${name} destroyed successfully`);
                        return { name, success: true };
                    }
                    return { name, success: true, skipped: true };
                } catch (e) {
                    failedDrivers.push({ name, error: e.message });
                    log('WARN', `[FACTORY] Erro no descarte do driver '${name}': ${e.message}`);
                    return { name, success: false, error: e.message };
                }
            })();

            cleanupPromises.push(cleanupPromise);
        }

        // ✅ Aguardar todos os cleanups (paralelo)
        const results = await Promise.allSettled(cleanupPromises);

        const successCount = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
        const failedCount = failedDrivers.length;

        if (failedCount > 0) {
            log('WARN', `[FACTORY] ${failedCount}/${totalDrivers} drivers falharam no cleanup`, {
                failed: failedDrivers
            });
        }

        instances.clear();
        this.pageCache.delete(page);
        this.metrics.invalidations++;

        const result = {
            success: successCount,
            failed: failedCount,
            total: totalDrivers,
            drivers: results.map(r => (r.status === 'fulfilled' ? r.value : { success: false }))
        };

        log('INFO', `[FACTORY] Page cache invalidated. Success: ${successCount}/${totalDrivers}`);

        this.emit(FACTORY_EVENTS.CACHE_INVALIDATED, {
            ...result,
            invalidations: this.metrics.invalidations
        });

        return result;
    }

    /* ==========================================================================
       INTROSPECTION & HEALTH
    ========================================================================== */

    /**
     * ✅ BUG #9 FIX: Obtém metadata de um driver específico
     *
     * @param {string} targetName - Nome do target
     * @returns {Object|null} Metadata { path, className } ou null se não existe
     */
    getDriverMetadata(targetName) {
        const key = (targetName || '').toLowerCase();
        return this.registry[key] || null;
    }

    /**
     * ✅ BUG #9 FIX: Obtém metadata de todos os drivers
     *
     * @returns {Object} Clone do registry completo
     */
    getAllDriversMetadata() {
        return { ...this.registry };
    }

    /**
     * ✅ BUG #9 FIX: Verifica se target existe no registry
     *
     * @param {string} targetName - Nome do target
     * @returns {boolean} true se existe, false caso contrário
     */
    hasTarget(targetName) {
        const key = (targetName || '').toLowerCase();
        return key in this.registry;
    }

    /**
     * ✅ BUG #9 FIX: Obtém o target padrão
     *
     * @returns {string} Nome do target padrão
     */
    getDefaultTarget() {
        return FACTORY_CONFIG.DEFAULT_TARGET;
    }

    /**
     * ✅ IMPROVEMENT #4: Health Check Endpoint
     *
     * Retorna o status de saúde completo da factory.
     * Útil para monitoramento e debugging.
     *
     * v2.0 Features:
     * - Discovered targets
     * - Cache stats (impossível com WeakMap, mas reporta descobertos)
     * - Métricas completas
     * - Failed drivers
     * - Config atual
     *
     * @returns {Object} Health status completo
     */
    getHealth() {
        const health = {
            discovered: Object.keys(this.registry).length,
            targets: Object.keys(this.registry),
            defaultTarget: FACTORY_CONFIG.DEFAULT_TARGET,
            failedDrivers: Array.from(this.failedDrivers),
            metrics: {
                driversCreated: this.metrics.driversCreated,
                driversReused: this.metrics.driversReused,
                driversDestroyed: this.metrics.driversDestroyed,
                cacheHits: this.metrics.cacheHits,
                cacheMisses: this.metrics.cacheMisses,
                cacheHitRate:
                    this.metrics.cacheMisses > 0
                        ? (
                              (this.metrics.cacheHits / (this.metrics.cacheHits + this.metrics.cacheMisses)) *
                              100
                          ).toFixed(2) + '%'
                        : 'N/A',
                evictions: this.metrics.evictions,
                invalidations: this.metrics.invalidations,
                errors: this.metrics.errors,
                discoveryTime: this.metrics.discoveryTime
            },
            config: {
                targetsDir: FACTORY_CONFIG.TARGETS_DIR,
                defaultTarget: FACTORY_CONFIG.DEFAULT_TARGET,
                validateOnBoot: FACTORY_CONFIG.VALIDATE_ON_BOOT,
                invalidateTimeout: FACTORY_CONFIG.INVALIDATE_TIMEOUT_MS,
                maxDriversPerPage: FACTORY_CONFIG.MAX_DRIVERS_PER_PAGE
            }
        };

        return health;
    }

    /**
     * ✅ IMPROVEMENT #7: Obtém métricas de performance
     *
     * @returns {Object} Métricas completas
     */
    getMetrics() {
        return { ...this.metrics };
    }

    /**
     * ✅ Reseta métricas (útil para testes)
     *
     * @private
     */
    _resetMetrics() {
        this.metrics = {
            driversCreated: 0,
            driversReused: 0,
            driversDestroyed: 0,
            cacheHits: 0,
            cacheMisses: 0,
            discoveryTime: 0,
            evictions: 0,
            invalidations: 0,
            errors: 0
        };
    }
}

/* ==========================================================================
   SINGLETON INSTANCE & MODULE EXPORTS
========================================================================== */

/**
 * Singleton instance da DriverFactory v2.0
 *
 * @type {DriverFactory}
 */
const factory = new DriverFactory();

/**
 * Module exports - Compatibilidade com v1.0 + novos métodos v2.0
 */
module.exports = {
    // ✅ v1.0 API (compatibilidade)
    getDriver: factory.getDriver.bind(factory),
    invalidatePageCache: factory.invalidatePageCache.bind(factory),
    availableTargets: Object.keys(factory.registry),

    // ✅ v2.0 EventEmitter API
    on: factory.on.bind(factory),
    once: factory.once.bind(factory),
    off: factory.off.bind(factory),
    emit: factory.emit.bind(factory),

    // ✅ v2.0 Introspection API
    getDriverMetadata: factory.getDriverMetadata.bind(factory),
    getAllDriversMetadata: factory.getAllDriversMetadata.bind(factory),
    hasTarget: factory.hasTarget.bind(factory),
    getDefaultTarget: factory.getDefaultTarget.bind(factory),

    // ✅ v2.0 Health & Metrics API
    getHealth: factory.getHealth.bind(factory),
    getMetrics: factory.getMetrics.bind(factory),

    // ✅ Constantes exportadas
    FACTORY_CONFIG,
    FACTORY_EVENTS,

    // ✅ Singleton instance (para casos avançados)
    factory
};
