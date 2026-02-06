import { STATUS_VALUES } from '#core/constants/tasks';
import { log } from '#core/logger';
import { ConnectionOrchestrator } from '../ConnectionOrchestrator.js';
import { CircuitBreakerManager, FailureCause } from './circuit_breaker.js';
import { PageValidator } from './PageValidator.js';
import { PageLifecycleMonitor } from './PageLifecycleMonitor.js';
import PeriodicHealthMonitor from './PeriodicHealthMonitor.js';

class BrowserPoolManager {
    /**
     * @param {Object} config - Configuração do pool
     * @param {number} config.poolSize - Número de instâncias no pool (padrão: 3)
     * @param {string} config.allocationStrategy - round-robin | least-loaded | target-affinity (padrão: round-robin)
     * @param {number} config.healthCheckInterval - Intervalo de health check em ms (padrão: 30000)
     * @param {Object} config.browserEndpoint - Configuração canônica do browser externo (url, optional wsEndpoint)
     */
    constructor(config = {}) {
        this.config = {
            poolSize: config.poolSize || 3,
            allocationStrategy: config.allocationStrategy || 'round-robin',
            healthCheckInterval: config.healthCheckInterval || 30000,
            // Force uso explícito de `browserEndpoint` — não há fallback para 'chromium'
            browserEndpoint: config.browserEndpoint || {},
        };

        // Pool de instâncias: Array de { browser, pages, health, stats }
        this.pool = [];

        // Índice para round-robin
        this.roundRobinIndex = 0;

        // Estatísticas globais
        this.stats = {
            totalAllocations: 0,
            totalReleases: 0,
            healthChecks: 0,
            crashesDetected: 0,
            restartsPerformed: 0,
            // ✅ P0-U2: New lifecycle stats
            pagesClosedByUser: 0,
            pageErrors: 0,
            pagesDisconnected: 0,
        };

        // ✅ P0-U2: Lifecycle monitors (Map<taskId, PageLifecycleMonitor>)
        this.lifecycleMonitors = new Map();

        // Health check interval
        this.healthCheckTimer = null;

        // Estado
        this.initialized = false;
        this.shuttingDown = false;

        // [V800] Promise memoization para prevenir race em inicialização dupla
        this._initPromise = null;

        // [V1.0] Circuit Breaker para detecção inteligente de falhas
        this.circuitBreaker = new CircuitBreakerManager({
            poolSize: this.config.poolSize,
            nerv: null, // NERV será injetado externamente
        });

        // ✅ Phase 3: Periodic health monitoring (CDP-only)
        this.healthMonitor = null; // Inicializado após pool ready
        this.reconnectionInProgress = false;
    }

    /**
     * Inicializa o pool de browsers.
     * Conecta às instâncias Chrome remotas usando ConnectionOrchestrator.
     *
     * [V800] Promise Memoization: Se chamado múltiplas vezes simultaneamente,
     * retorna a mesma promise de inicialização (previne dupla inicialização).
     */
    async initialize() {
        // Retorna imediatamente se já inicializado
        if (this.initialized) {
            log('WARN', '[BrowserPool] Pool já inicializado');
            return;
        }

        // Retorna promise existente se inicialização em andamento
        if (this._initPromise) {
            log('DEBUG', '[BrowserPool] Inicialização já em andamento, aguardando...');
            return this._initPromise;
        }

        // Cria e memoriza promise de inicialização
        this._initPromise = this._doInitialize();

        try {
            await this._initPromise;
        } finally {
            // Limpa promise após conclusão (sucesso ou erro)
            this._initPromise = null;
        }
    }

    /**
     * Executa a inicialização real do pool (método interno).
     */
    async _doInitialize() {
        log('INFO', `[BrowserPool] Inicializando pool com ${this.config.poolSize} instâncias...`);

        // Arquitetura de conexão: exige browserEndpoint.url
        if (!this.config.browserEndpoint || !this.config.browserEndpoint.url) {
            throw new Error(
                '[ARCHITECTURE ERROR] browserEndpoint.url é obrigatório. Este sistema não suporta launch de browsers.'
            );
        }

        // ✅ Bug #3: Validar proxy ANTES de tentar conectar
        const CONFIG = await import('#core/config').then(m => m.default ?? m);
        if (CONFIG.CHROME_PROXY_ENABLED !== false) {
            await this._validateProxyAvailability();
        }

        const orchestrator = new ConnectionOrchestrator({ browserEndpoint: this.config.browserEndpoint });

        // Conecta a múltiplas instâncias Chrome
        // Em produção, cada instância pode estar em uma porta diferente (ex.: 9224 container-facing proxy, 9223)
        // Por enquanto, usaremos a mesma conexão com contextos isolados

        for (let i = 0; i < this.config.poolSize; i++) {
            try {
                // ✅ Bug #2: Corrigido .connect() → .ensureBrowser()
                const browser = await orchestrator.ensureBrowser();

                const poolEntry = {
                    id: `browser-${i}`,
                    browser,
                    pages: new Map(), // taskId -> page
                    health: {
                        status: STATUS_VALUES.HEALTHY,
                        lastCheck: Date.now(),
                        consecutiveFailures: 0,
                    },
                    stats: {
                        allocations: 0,
                        activeTasks: 0,
                        totalUptime: Date.now(),
                    },
                };

                this.pool.push(poolEntry);

                log('INFO', `[BrowserPool] Instância ${poolEntry.id} conectada e adicionada ao pool`);
            } catch (error) {
                log('ERROR', `[BrowserPool] Falha ao conectar instância ${i}: ${error.message}`);
                // Continua com pool degradado (menos instâncias)
            }
        }

        if (this.pool.length === 0) {
            throw new Error('[BrowserPool] Nenhuma instância Chrome disponível. Pool não pode inicializar.');
        }

        this.initialized = true;

        // Inicia health checks periódicos
        this._startHealthChecks();

        // ✅ Phase 3: Inicializa e inicia PeriodicHealthMonitor
        this.healthMonitor = new PeriodicHealthMonitor(this);
        this._attachHealthMonitorEvents();
        this._bridgeCircuitBreakerAndMonitor(); // ✅ Bridge CB ↔ Monitor
        this.healthMonitor.start(this.config.healthCheckInterval);

        log('INFO', `[BrowserPool] Inicializado com ${this.pool.length}/${this.config.poolSize} instâncias`);
        log('INFO', '[BrowserPool] ✅ PeriodicHealthMonitor started (CDP-only mode)');
        log('INFO', '[BrowserPool] ✅ CircuitBreaker ↔ Monitor bridge established');
    }

    /**
     * Aloca uma página do pool para uma task.
     * Usa estratégia configurada (round-robin, least-loaded, target-affinity).
     *
     * @param {string} target - Target da task (chatgpt, gemini, etc) para affinity
     * @returns {Promise<Page>} Página Puppeteer alocada
     */
    async allocate(target = 'default') {
        if (!this.initialized) {
            throw new Error('[BrowserPool] Pool não inicializado. Chame initialize() primeiro.');
        }

        if (this.shuttingDown) {
            throw new Error('[BrowserPool] Pool em shutdown, não é possível alocar novas páginas.');
        }

        // Seleciona instância baseado na estratégia
        const poolEntry = this._selectInstance(target);

        if (!poolEntry) {
            throw new Error('[BrowserPool] Nenhuma instância saudável disponível no pool.');
        }

        try {
            // Cria nova página na instância selecionada
            const page = await poolEntry.browser.newPage();

            // ✅ P0-U1: Valida página ANTES de alocar (BUG-01 FIX)
            const validation = await PageValidator.validate(page, target);

            if (!validation.valid) {
                // Página inválida (fatal issues), fecha e tenta novamente
                log('ERROR', `[BrowserPool] Page validation failed: ${JSON.stringify(validation.issues)}`);

                try {
                    await page.close();
                } catch (closeErr) {
                    log('WARN', `[BrowserPool] Error closing invalid page: ${closeErr.message}`);
                }

                // Marca como falha no circuit breaker
                this.circuitBreaker.recordFailure(poolEntry.id, FailureCause.PAGE_VALIDATION_FAILED);

                // Retry allocation (recursivo)
                if (poolEntry.health.consecutiveFailures < 3) {
                    return this.allocate(target);
                }

                throw new Error(`Page validation failed: ${JSON.stringify(validation.issues)}`);
            }

            // Log warnings (non-fatal issues)
            if (validation.issues.length > 0) {
                log('WARN', `[BrowserPool] Page validation warnings: ${JSON.stringify(validation.issues)}`);
            }

            // Gera taskId único temporário (será substituído pelo real via updatePageTaskId)
            const taskId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

            // Registra página no pool entry
            poolEntry.pages.set(taskId, page);
            poolEntry.stats.allocations++;
            poolEntry.stats.activeTasks++;

            this.stats.totalAllocations++;

            log('DEBUG', `[BrowserPool] Página alocada de ${poolEntry.id} (${poolEntry.stats.activeTasks} ativas)`);

            // Anexa metadata à página para rastreamento
            page._poolMetadata = {
                poolEntryId: poolEntry.id,
                taskId,
                allocatedAt: Date.now(),
                validation, // ✅ Salva resultado de validação para debugging
            };

            // ✅ P0-U5: Store temp ID for later update
            page._tempTaskId = taskId;
            page._poolEntry = poolEntry;

            // ✅ P0-U2: Attach lifecycle monitor (BUG-02 FIX)
            const monitor = new PageLifecycleMonitor(page, this, taskId, this.nerv || null);
            this.lifecycleMonitors.set(taskId, monitor);

            log('DEBUG', `[BrowserPool] Lifecycle monitor attached for ${taskId}`);

            return page;
        } catch (error) {
            log('ERROR', `[BrowserPool] Erro ao alocar página de ${poolEntry.id}: ${error.message}`);

            // Marca instância como unhealthy
            poolEntry.health.status = STATUS_VALUES.UNHEALTHY;
            poolEntry.health.consecutiveFailures++;

            // Tenta alocar de outra instância
            if (poolEntry.health.consecutiveFailures < 3) {
                return this.allocate(target); // Recursão com outra instância
            }

            throw error;
        }
    }

    /**
     * ✅ P0-U5: Atualiza taskId de página de temporário para real.
     *
     * Chamado pelo adapter após criar task real, para manter pages Map sincronizado.
     * Melhora debugging (pages Map tem IDs reais, não temp-xxx).
     *
     * @param {Page} page - Puppeteer page
     * @param {string} realTaskId - Real task ID (substitui temp ID)
     * @returns {void}
     */
    updatePageTaskId(page, realTaskId) {
        if (!page._tempTaskId || !page._poolEntry) {
            log('WARN', '[BrowserPool] Cannot update taskId: missing metadata');
            return;
        }

        const poolEntry = page._poolEntry;

        // Remove temp ID
        poolEntry.pages.delete(page._tempTaskId);

        // Add real ID
        poolEntry.pages.set(realTaskId, page);

        // Update metadata
        page._poolMetadata.taskId = realTaskId;
        delete page._tempTaskId;

        log('DEBUG', `[BrowserPool] Updated taskId: ${page._tempTaskId} → ${realTaskId}`);
    }

    /**
     * Libera uma página de volta ao pool.
     *
     * @param {Page} page - Página Puppeteer para liberar
     */
    async release(page) {
        if (!page || !page._poolMetadata) {
            log('WARN', '[BrowserPool] Tentativa de liberar página sem metadata');
            return;
        }

        const { poolEntryId, taskId } = page._poolMetadata;

        const poolEntry = this.pool.find(entry => entry.id === poolEntryId);

        if (!poolEntry) {
            log('WARN', `[BrowserPool] PoolEntry ${poolEntryId} não encontrado ao liberar página`);
            return;
        }

        try {
            // ✅ P0-U2: Cleanup lifecycle monitor
            const monitor = this.lifecycleMonitors.get(taskId);
            if (monitor) {
                monitor.cleanup();
                this.lifecycleMonitors.delete(taskId);
                log('DEBUG', `[BrowserPool] Lifecycle monitor cleaned: ${taskId}`);
            }

            // Fecha a página
            await page.close();

            // Remove do registro
            poolEntry.pages.delete(taskId);
            poolEntry.stats.activeTasks = Math.max(0, poolEntry.stats.activeTasks - 1);

            this.stats.totalReleases++;

            log('DEBUG', `[BrowserPool] Página liberada de ${poolEntryId} (${poolEntry.stats.activeTasks} ativas)`);
        } catch (error) {
            log('ERROR', `[BrowserPool] Erro ao liberar página: ${error.message}`);
        }
    }

    /**
     * ✅ P0-U2: Remove página do pool (chamado por lifecycle monitor).
     *
     * Usado quando página fecha/disconnecta inesperadamente (usuário ou crash).
     * Previne pool corruption (páginas closed no registro).
     *
     * @param {string} taskId - Task ID da página
     * @returns {void}
     */
    removePageFromPool(taskId) {
        try {
            // Find pool entry que contém esta página
            const poolEntry = this.pool.find(entry => entry.pages.has(taskId));

            if (!poolEntry) {
                log('WARN', `[BrowserPool] TaskId ${taskId} not found in pool (already removed?)`);
                return;
            }

            // Remove from pages Map
            poolEntry.pages.delete(taskId);

            // Update stats
            poolEntry.stats.activeTasks = Math.max(0, poolEntry.stats.activeTasks - 1);

            // Cleanup monitor
            const monitor = this.lifecycleMonitors.get(taskId);
            if (monitor) {
                monitor.cleanup();
                this.lifecycleMonitors.delete(taskId);
            }

            log('INFO', `[BrowserPool] Page removed from pool: ${taskId} (${poolEntry.stats.activeTasks} active)`);
        } catch (err) {
            log('ERROR', `[BrowserPool] Error removing page from pool: ${err.message}`);
        }
    }

    /**
     * Seleciona uma instância do pool baseado na estratégia configurada.
     * P9.2: Circuit breaker - filtra apenas instâncias HEALTHY com 0 falhas consecutivas
     */
    _selectInstance(target) {
        const healthyInstances = this.pool.filter(
            entry => entry.health.status === STATUS_VALUES.HEALTHY && entry.health.consecutiveFailures === 0
        );

        if (healthyInstances.length === 0) {
            log('ERROR', '[BrowserPool] Nenhuma instância saudável disponível');
            return null;
        }

        switch (this.config.allocationStrategy) {
            case 'round-robin':
                return this._selectRoundRobin(healthyInstances);

            case 'least-loaded':
                return this._selectLeastLoaded(healthyInstances);

            case 'target-affinity':
                return this._selectByAffinity(healthyInstances, target);

            default:
                return this._selectRoundRobin(healthyInstances);
        }
    }

    /**
     * Estratégia Round-Robin: alterna entre instâncias sequencialmente.
     */
    _selectRoundRobin(instances) {
        const selected = instances[this.roundRobinIndex % instances.length];
        this.roundRobinIndex = (this.roundRobinIndex + 1) % instances.length;
        return selected;
    }

    /**
     * Estratégia Least-Loaded: seleciona instância com menos tasks ativas.
     */
    _selectLeastLoaded(instances) {
        return instances.reduce((min, entry) => (entry.stats.activeTasks < min.stats.activeTasks ? entry : min));
    }

    /**
     * Estratégia Target-Affinity: mantém tasks do mesmo target na mesma instância.
     * Útil para reutilizar cookies/sessões.
     */
    _selectByAffinity(instances, target) {
        // Hash simples do target para selecionar instância consistente
        const hash = target.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        const index = hash % instances.length;
        return instances[index];
    }

    /**
     * Inicia health checks periódicos do pool.
     */
    _startHealthChecks() {
        this.healthCheckTimer = setInterval(async () => {
            await this._performHealthCheck();
        }, this.config.healthCheckInterval);

        log('DEBUG', `[BrowserPool] Health checks iniciados (intervalo: ${this.config.healthCheckInterval}ms)`);
    }

    /**
     * Realiza health check em todas as instâncias do pool.
     * P3.2: Detecta tanto crashes quanto degradação de performance
     * V1.0: Integrado com Circuit Breaker para detecção inteligente de falhas
     */
    async _performHealthCheck() {
        this.stats.healthChecks++;

        for (const poolEntry of this.pool) {
            try {
                // Verifica se browser está conectado
                const isConnected = poolEntry.browser.isConnected();

                if (!isConnected) {
                    throw new Error('Browser disconnected');
                }

                // P3.2: Mede timing do smoke test para detectar degradação
                const startTime = Date.now();
                const testPage = await poolEntry.browser.newPage();
                await testPage.close();
                const duration = Date.now() - startTime;

                // P3.2: Detecta degradação (resposta > 5s indica problema)
                if (duration > 5000) {
                    poolEntry.health.status = 'DEGRADED';
                    poolEntry.health.consecutiveFailures++;
                    log(
                        'WARN',
                        `[BrowserPool] Instância ${poolEntry.id} DEGRADED (${duration}ms) - ${poolEntry.health.consecutiveFailures}/3 falhas`
                    );

                    // Auto-restart após 3 degradações consecutivas
                    if (poolEntry.health.consecutiveFailures >= 3) {
                        poolEntry.health.status = STATUS_VALUES.CRASHED;
                        this.stats.crashesDetected++;

                        // ✅ Circuit Breaker: Registra falha
                        const error = new Error(`Performance degradation: ${duration}ms`);
                        this.circuitBreaker.registerFailure(poolEntry.id, error, {
                            duration,
                            memoryHigh: duration > 10000,
                        });

                        log(
                            'ERROR',
                            `[BrowserPool] Instância ${poolEntry.id} marcada como CRASHED após degradações repetidas`
                        );
                    }
                } else {
                    // Instância saudável - reseta contador
                    poolEntry.health.status = STATUS_VALUES.HEALTHY;
                    poolEntry.health.consecutiveFailures = 0;
                    poolEntry.health.lastCheck = Date.now();

                    // ✅ Circuit Breaker: Registra recovery
                    this.circuitBreaker.registerRecovery(poolEntry.id);
                }
            } catch (error) {
                log('WARN', `[BrowserPool] Health check falhou para ${poolEntry.id}: ${error.message}`);

                poolEntry.health.consecutiveFailures++;

                if (poolEntry.health.consecutiveFailures >= 3) {
                    poolEntry.health.status = STATUS_VALUES.CRASHED;
                    this.stats.crashesDetected++;

                    // ✅ Circuit Breaker: Registra falha com contexto
                    const context = {
                        consecutiveFailures: poolEntry.health.consecutiveFailures,
                        lastCheck: poolEntry.health.lastCheck,
                    };
                    const result = this.circuitBreaker.registerFailure(poolEntry.id, error, context);

                    log(
                        'ERROR',
                        `[BrowserPool] Instância ${poolEntry.id} marcada como CRASHED (${poolEntry.health.consecutiveFailures} falhas consecutivas)`
                    );

                    log(
                        'INFO',
                        `[BrowserPool] Circuit Breaker: Causa detectada = ${result.cause}, Deve pausar = ${result.shouldPause}`
                    );
                }
            }
        }

        // ✅ Verifica se sistema deve pausar
        if (this.circuitBreaker.shouldPauseSystem()) {
            log('WARN', '[BrowserPool] ⏸️  Sistema deve PAUSAR devido ao Circuit Breaker');
            // TODO: Emitir evento NERV para Kernel pausar
        }
    }

    /**
     * Retorna health status do pool incluindo Circuit Breaker.
     */
    async getHealth() {
        const healthyCount = this.pool.filter(e => e.health.status === STATUS_VALUES.HEALTHY).length;
        const unhealthyCount = this.pool.filter(e => e.health.status === STATUS_VALUES.UNHEALTHY).length;
        const crashedCount = this.pool.filter(e => e.health.status === STATUS_VALUES.CRASHED).length;

        const circuitBreakerStatus = this.circuitBreaker.getStatus();

        return {
            status: healthyCount > 0 ? 'OPERATIONAL' : 'DEGRADED',
            poolSize: this.pool.length,
            healthy: healthyCount,
            unhealthy: unhealthyCount,
            crashed: crashedCount,
            stats: { ...this.stats },
            circuitBreaker: circuitBreakerStatus,
        };
    }

    /**
     * Valida disponibilidade do Chrome Proxy Service antes de tentar conectar.
     * Fail-fast com mensagens claras.
     *
     * @throws {Error} Se proxy não estiver disponível ou unhealthy
     */
    async _validateProxyAvailability() {
        const CONFIG = await import('#core/config').then(m => m.default ?? m);

        /*
         * CONTRATO DE TOPOLOGIA (CANÔNICO):
         *
         * - Chrome REAL           → Windows Host (porta 9225, bind 0.0.0.0)
         * - Chrome Proxy Service  → DevContainer (porta 9224, bind 0.0.0.0)
         * - Node.js / Puppeteer   → DevContainer (conecta localhost:9224)
         *
         * Fluxo de Conexão:
         *   Puppeteer → Proxy (localhost:9224) → Chrome (host.docker.internal:9225)
         *
         * O container NUNCA acessa diretamente:
         *   • porta 9225 (apenas via proxy)
         *   • 127.0.0.1:9225 do Windows (rede isolada)
         *
         * O proxy roda NO CONTAINER para:
         *   • Reescrever Host: headers (Chrome valida)
         *   • Reescrever WebSocket URLs (localhost → IP container)
         *   • Gerenciamento centralizado PM2 + logs NERV
         */

        const host = CONFIG.CHROME_PROXY_HOST || process.env.CHROME_PROXY_HOST || 'localhost';

        const port = CONFIG.CHROME_PROXY_PORT || Number(process.env.CHROME_PROXY_PORT) || 9224;

        const url = `http://${host}:${port}/health`;

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);

            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();

            if (data.status !== 'ok' && data.status !== 'healthy') {
                throw new Error(`Proxy status: ${data.status}`);
            }

            log('INFO', `[BrowserPool] ✅ Chrome Proxy validado e disponível (${host}:${port})`);
        } catch (error) {
            const errorMsg = error.name === 'AbortError' ? 'timeout (3s)' : error.message;

            log('ERROR', `[BrowserPool] ❌ Chrome Proxy indisponível: ${url}`);
            log('ERROR', `[BrowserPool] Erro: ${errorMsg}`);
            log('ERROR', '[BrowserPool]');
            log('ERROR', '[BrowserPool] CONTEXTO ARQUITETURAL:');
            log('ERROR', '[BrowserPool] • Proxy DEVE rodar no MESMO container que Node.js');
            log('ERROR', '[BrowserPool] • Proxy esperado em localhost:9224 (dentro do container)');
            log('ERROR', '[BrowserPool]');
            log('ERROR', '[BrowserPool] AÇÃO CORRETIVA:');
            log('ERROR', '[BrowserPool] 1. Inicie o Chrome Proxy Service (PM2):');
            log('ERROR', '[BrowserPool]    pm2 start ecosystem.config.js --only chrome-proxy');
            log('ERROR', '[BrowserPool] 2. Valide manualmente (dentro do container):');
            log('ERROR', `[BrowserPool]    curl http://localhost:${port}/health`);
            log('ERROR', '[BrowserPool]');

            throw new Error(`Chrome Proxy Service não está disponível em ${host}:${port} - ${errorMsg}`);
        }
    }
    /**
     * Shutdown gracioso do pool.
     * Fecha todas as páginas e desconecta browsers.
     */
    async shutdown() {
        this.shuttingDown = true;

        log('INFO', '[BrowserPool] Iniciando shutdown gracioso...');

        // ✅ Phase 3: Para PeriodicHealthMonitor
        if (this.healthMonitor) {
            this.healthMonitor.stop();
            this.healthMonitor = null;
            log('INFO', '[BrowserPool] PeriodicHealthMonitor stopped');
        }

        // Para health checks
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = null;
        }

        // Fecha todas as páginas ativas
        for (const poolEntry of this.pool) {
            try {
                // Fecha todas as páginas da instância
                for (const [taskId, page] of poolEntry.pages.entries()) {
                    await page.close().catch(err => {
                        log('WARN', `[BrowserPool] Erro ao fechar página ${taskId}: ${err.message}`);
                    });
                }

                // Desconecta browser (não fecha processo Chrome, apenas desconecta)
                await poolEntry.browser.disconnect();

                log('INFO', `[BrowserPool] Instância ${poolEntry.id} desconectada`);
            } catch (error) {
                log('ERROR', `[BrowserPool] Erro ao desconectar ${poolEntry.id}: ${error.message}`);
            }
        }

        this.pool = [];
        this.initialized = false;

        log('INFO', '[BrowserPool] Shutdown concluído');
    }

    /* ======================================================================
       ✅ PHASE 3 - MONITORING & RECONNECTION (P2-U2)
    ====================================================================== */

    /**
     * Anexa event handlers do PeriodicHealthMonitor.
     * @private
     */
    async _attachHealthMonitorEvents() {
        if (!this.healthMonitor) {
            return;
        }

        const { MONITOR_EVENTS } = await import('./PeriodicHealthMonitor.js');

        // Status changes
        this.healthMonitor.on(MONITOR_EVENTS.STATUS_CHANGED, data => {
            log('INFO', `[BrowserPool] Health status changed: ${data.oldStatus} → ${data.newStatus}`);

            // Emit via NERV se disponível
            if (this.nerv) {
                this.nerv.emit({
                    type: 'BROWSER_POOL_HEALTH',
                    action: 'STATUS_CHANGED',
                    payload: data,
                });
            }
        });

        // Critical issues
        this.healthMonitor.on(MONITOR_EVENTS.CRITICAL_ISSUE, results => {
            log('ERROR', `[BrowserPool] Critical health issue detected: ${JSON.stringify(results.issues)}`);

            // Emit via NERV
            if (this.nerv) {
                this.nerv.emit({
                    type: 'BROWSER_POOL_HEALTH',
                    action: 'CRITICAL_ISSUE',
                    payload: results,
                });
            }
        });

        // Connection lost - trigger reconnection
        this.healthMonitor.on(MONITOR_EVENTS.RECOVERY_NEEDED, async data => {
            log('ERROR', `[BrowserPool] Recovery needed: ${data.reason}`);

            // Emit via NERV
            if (this.nerv) {
                this.nerv.emit({
                    type: 'BROWSER_POOL_HEALTH',
                    action: 'RECOVERY_NEEDED',
                    payload: data,
                });
            }

            // Trigger reconnection strategy
            if (!this.reconnectionInProgress) {
                await this._attemptReconnection();
            }
        });

        // Warnings
        this.healthMonitor.on(MONITOR_EVENTS.WARNING_DETECTED, results => {
            log('WARN', `[BrowserPool] Health warnings: ${JSON.stringify(results.issues)}`);
        });

        log('DEBUG', '[BrowserPool] PeriodicHealthMonitor event handlers attached');
    }

    /**
     * ✅ INTEGRATION: Estabelece ponte entre CircuitBreaker e PeriodicHealthMonitor.
     *
     * **Responsabilidades**:
     * - Monitor → CB: Notificar recovery quando voltando para HEALTHY
     * - Monitor → CB: Registrar falhas detectadas via health checks
     *
     * **Benefícios**:
     * - Kernel retoma execução automaticamente após reconexão
     * - CircuitBreaker sempre sincronizado com estado real
     * - Zero intervenção manual necessária
     *
     * @private
     */
    async _bridgeCircuitBreakerAndMonitor() {
        if (!this.circuitBreaker || !this.healthMonitor) {
            log('WARN', '[BrowserPool] Bridge CB ↔ Monitor skipped (components not available)');
            return;
        }

        const { MONITOR_EVENTS } = await import('./PeriodicHealthMonitor.js');
        const { HEALTH_STATUS, CHECK_TYPES } = await import('./PeriodicHealthMonitor.js');

        // Bridge 1: Monitor → CircuitBreaker (Recovery Notification)
        this.healthMonitor.on(MONITOR_EVENTS.STATUS_CHANGED, data => {
            // Detecta volta para HEALTHY (recovery completo)
            if (data.oldStatus !== HEALTH_STATUS.HEALTHY && data.newStatus === HEALTH_STATUS.HEALTHY) {
                log('INFO', '[BrowserPool] Bridge: HEALTHY status detected, notifying CircuitBreaker...');

                // Notifica CB para todas as instâncias reconectadas
                for (const poolEntry of this.pool) {
                    if (poolEntry.browser && poolEntry.browser.isConnected()) {
                        this.circuitBreaker.registerRecovery(poolEntry.id);
                        log('INFO', `[BrowserPool] Bridge: CB recovery registered for ${poolEntry.id}`);
                    }
                }
            }
        });

        // Bridge 2: Monitor → CircuitBreaker (Failure Detection)
        this.healthMonitor.on(MONITOR_EVENTS.CRITICAL_ISSUE, results => {
            // Detecta falhas críticas via health check
            const connCheck = results.checks[CHECK_TYPES.CONNECTION];

            if (connCheck && !connCheck.passed) {
                log(
                    'WARN',
                    '[BrowserPool] Bridge: CONNECTION failure detected by monitor, notifying CircuitBreaker...'
                );

                const error = new Error('Connection lost (detected by PeriodicHealthMonitor)');

                // Registra falha no CB para todas as instâncias
                for (const poolEntry of this.pool) {
                    this.circuitBreaker.registerFailure(poolEntry.id, error, {
                        source: 'PeriodicHealthMonitor',
                        healthCheckResult: results,
                        timestamp: results.timestamp,
                    });

                    log('WARN', `[BrowserPool] Bridge: CB failure registered for ${poolEntry.id}`);
                }
            }
        });

        log('INFO', '[BrowserPool] ✅ CircuitBreaker ↔ PeriodicHealthMonitor bridge established');
    }

    /**
     * ✅ P2-U2: ConnectionRecoveryStrategy - Graceful reconnection flow.
     *
     * Chamado automaticamente quando PeriodicHealthMonitor detecta CONNECTION_LOST.
     *
     * **Flow**:
     * 1. Detect: browser.isConnected() === false
     * 2. Clear: Close all page connections
     * 3. Poll: Retry puppeteer.connect() with exponential backoff
     * 4. Re-establish: Allocate new pages
     * 5. Notify: Alert user if manual restart needed
     *
     * **External Browser Mode**:
     * - Cannot restart Chrome process (user-managed)
     * - Can only reconnect via CDP
     * - User must manually restart Chrome if crashed
     *
     * @private
     * @returns {Promise<boolean>} True if reconnection succeeded
     */
    async _attemptReconnection() {
        if (this.reconnectionInProgress) {
            log('WARN', '[BrowserPool] Reconnection already in progress');
            return false;
        }

        this.reconnectionInProgress = true;

        log('INFO', '[BrowserPool] Starting ConnectionRecoveryStrategy...');

        const { MONITOR_CONFIG } = await import('./PeriodicHealthMonitor.js');

        const maxAttempts = MONITOR_CONFIG.RECONNECT_MAX_ATTEMPTS;
        const baseBackoff = MONITOR_CONFIG.RECONNECT_BACKOFF_BASE_MS;
        const maxBackoff = MONITOR_CONFIG.RECONNECT_BACKOFF_MAX_MS;

        let attempt = 0;
        let reconnected = false;

        try {
            // Step 1: Clear all page connections
            log('INFO', '[BrowserPool] Step 1: Clearing page connections...');
            await this._clearAllPageConnections();

            // Step 2: Poll reconnection with backoff
            log('INFO', '[BrowserPool] Step 2: Polling reconnection...');

            while (attempt < maxAttempts && !reconnected) {
                attempt++;

                // Exponential backoff: 2s, 4s, 8s, 16s, 30s (capped)
                const backoff = Math.min(baseBackoff * Math.pow(2, attempt - 1), maxBackoff);

                log('INFO', `[BrowserPool] Reconnection attempt ${attempt}/${maxAttempts} (backoff: ${backoff}ms)`);

                try {
                    // Check if browser already reconnected (external mode)
                    if (this.browser && this.browser.isConnected()) {
                        log('INFO', '[BrowserPool] Browser already reconnected (external mode)');
                        reconnected = true;
                        break;
                    }

                    // Try reconnecting
                    const orchestrator = new ConnectionOrchestrator({ browserEndpoint: this.config.browserEndpoint });
                    const newBrowser = await orchestrator.ensureBrowser();

                    // Validate connection
                    if (newBrowser && newBrowser.isConnected()) {
                        log('INFO', `[BrowserPool] ✅ Reconnection successful on attempt ${attempt}`);

                        // Update pool entry
                        if (this.pool.length > 0) {
                            const poolEntry = this.pool[0];
                            poolEntry.browser = newBrowser;
                            poolEntry.health.status = STATUS_VALUES.HEALTHY;
                            poolEntry.health.consecutiveFailures = 0;
                            poolEntry.health.lastCheck = Date.now();
                        }

                        reconnected = true;
                        break;
                    }
                } catch (reconnectErr) {
                    log('WARN', `[BrowserPool] Reconnection attempt ${attempt} failed: ${reconnectErr.message}`);
                }

                // Wait before next attempt
                if (attempt < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, backoff));
                }
            }

            // Step 3: Handle result
            if (reconnected) {
                log('INFO', '[BrowserPool] ✅ ConnectionRecoveryStrategy succeeded');

                // ✅ FIX (Bug #1): Notificar CircuitBreaker do recovery
                if (this.circuitBreaker && this.pool.length > 0) {
                    const poolEntry = this.pool[0];
                    this.circuitBreaker.registerRecovery(poolEntry.id);
                    log('INFO', `[BrowserPool] ✅ CircuitBreaker recovery registered: ${poolEntry.id}`);
                }

                // Emit via NERV
                if (this.nerv) {
                    this.nerv.emit({
                        type: 'BROWSER_POOL_HEALTH',
                        action: 'RECONNECTION_SUCCEEDED',
                        payload: { attempts: attempt },
                    });
                }

                return true;
            } else {
                log('ERROR', `[BrowserPool] ❌ ConnectionRecoveryStrategy failed after ${maxAttempts} attempts`);

                // Notify user (external browser mode - manual restart needed)
                this._notifyUserManualRestartNeeded();

                // Emit via NERV
                if (this.nerv) {
                    this.nerv.emit({
                        type: 'BROWSER_POOL_HEALTH',
                        action: 'RECONNECTION_FAILED',
                        payload: { attempts: maxAttempts, reason: 'MAX_ATTEMPTS_REACHED' },
                    });
                }

                return false;
            }
        } catch (err) {
            log('ERROR', `[BrowserPool] ConnectionRecoveryStrategy error: ${err.message}`);
            return false;
        } finally {
            this.reconnectionInProgress = false;
        }
    }

    /**
     * Clear all page connections (before reconnection).
     * @private
     */
    async _clearAllPageConnections() {
        for (const poolEntry of this.pool) {
            try {
                // Close all pages
                for (const [taskId, page] of poolEntry.pages.entries()) {
                    try {
                        if (!page.isClosed()) {
                            await page.close();
                        }
                    } catch (closeErr) {
                        log('WARN', `[BrowserPool] Error closing page ${taskId}: ${closeErr.message}`);
                    }

                    // Remove from pool
                    poolEntry.pages.delete(taskId);

                    // Cleanup monitor
                    const monitor = this.lifecycleMonitors.get(taskId);
                    if (monitor) {
                        monitor.cleanup();
                        this.lifecycleMonitors.delete(taskId);
                    }
                }

                // Disconnect browser (graceful)
                if (poolEntry.browser && poolEntry.browser.isConnected()) {
                    await poolEntry.browser.disconnect();
                }

                poolEntry.stats.activeTasks = 0;

                log('INFO', `[BrowserPool] Cleared connections for ${poolEntry.id}`);
            } catch (clearErr) {
                log('ERROR', `[BrowserPool] Error clearing ${poolEntry.id}: ${clearErr.message}`);
            }
        }
    }

    /**
     * Notifica usuário que restart manual do Chrome é necessário.
     * @private
     */
    _notifyUserManualRestartNeeded() {
        log('ERROR', '[BrowserPool] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        log('ERROR', '[BrowserPool]');
        log('ERROR', '[BrowserPool] 🚨 MANUAL ACTION REQUIRED 🚨');
        log('ERROR', '[BrowserPool]');
        log('ERROR', '[BrowserPool] Browser connection lost and automatic reconnection failed.');
        log('ERROR', '[BrowserPool]');
        log('ERROR', '[BrowserPool] EXTERNAL BROWSER MODE:');
        log('ERROR', '[BrowserPool] - Chrome runs on Windows host (user-managed)');
        log('ERROR', '[BrowserPool] - Cannot auto-restart browser process from container');
        log('ERROR', '[BrowserPool]');
        log('ERROR', '[BrowserPool] REQUIRED ACTIONS:');
        log('ERROR', '[BrowserPool] 1. Restart Chrome on Windows host:');
        log('ERROR', '[BrowserPool]    START-CHROME-SIMPLE.bat');
        log('ERROR', '[BrowserPool] 2. Verify Chrome is running (port 9225)');
        log('ERROR', '[BrowserPool] 3. System will auto-reconnect when Chrome is available');
        log('ERROR', '[BrowserPool]');
        log('ERROR', '[BrowserPool] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

        // Emit via NERV
        if (this.nerv) {
            this.nerv.emit({
                type: 'USER_NOTIFICATION',
                action: 'BROWSER_RESTART_REQUIRED',
                payload: {
                    severity: 'CRITICAL',
                    message: 'Chrome connection lost. Please restart Chrome on Windows host.',
                    instructions: [
                        'Run START-CHROME-SIMPLE.bat on Windows',
                        'Verify Chrome is running on port 9225',
                        'System will auto-reconnect',
                    ],
                },
            });
        }
    }

    /**
     * Gets active pages for monitoring.
     * Called by PeriodicHealthMonitor.
     *
     * @returns {Array<{page, taskId}>} Active pages
     */
    getActivePages() {
        const pages = [];

        for (const poolEntry of this.pool) {
            for (const [taskId, page] of poolEntry.pages.entries()) {
                pages.push({ page, taskId });
            }
        }

        return pages;
    }
}

export default BrowserPoolManager;
