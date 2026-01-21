/* ==========================================================================
   src/infra/browser_pool/pool_manager.js
   Subsistema: INFRA — Browser Pool Manager
   Audit Level: 800 — Critical Resource Manager (Singularity Edition)

   Responsabilidade:
   - Gerenciar pool de 3 instâncias Chrome remotas (--remote-debugging-port)
   - Alocar páginas (tabs) para tasks com estratégias: round-robin, least-loaded, target-affinity
   - Health checks periódicos (heartbeat, crash detection)
   - Auto-restart de instâncias crashed
   - Isolamento entre tasks (diferentes contexts quando necessário)

   Princípios:
   - NÃO cria processos Chrome (assume Chrome já rodando em --remote-debugging-port=9222)
   - NÃO decide lógica de negócio (apenas aloca/libera recursos)
   - Pool size configurável (padrão: 3 instâncias)
   - Graceful degradation: se 1 instância falhar, pool continua com 2
========================================================================== */

const _puppeteer = require('puppeteer');

const { STATUS_VALUES: STATUS_VALUES } = require('../../core/constants/tasks.js');

const _puppeteerCore = require('puppeteer-core');
const { log } = require('../../core/logger');
const { ConnectionOrchestrator } = require('../ConnectionOrchestrator');

class BrowserPoolManager {
    /**
     * @param {Object} config - Configuração do pool
     * @param {number} config.poolSize - Número de instâncias no pool (padrão: 3)
     * @param {string} config.allocationStrategy - round-robin | least-loaded | target-affinity (padrão: round-robin)
     * @param {number} config.healthCheckInterval - Intervalo de health check em ms (padrão: 30000)
     * @param {Object} config.chromium - Configurações de conexão Chrome
     */
    constructor(config = {}) {
        this.config = {
            poolSize: config.poolSize || 3,
            allocationStrategy: config.allocationStrategy || 'round-robin',
            healthCheckInterval: config.healthCheckInterval || 30000,
            chromium: config.chromium || {}
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
            restartsPerformed: 0
        };

        // Health check interval
        this.healthCheckTimer = null;

        // Estado
        this.initialized = false;
        this.shuttingDown = false;

        // [V800] Promise memoization para prevenir race em inicialização dupla
        this._initPromise = null;
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

        const orchestrator = new ConnectionOrchestrator(this.config.chromium);

        // Conecta a múltiplas instâncias Chrome
        // Em produção, cada instância pode estar em uma porta diferente (9222, 9223, 9224)
        // Por enquanto, usaremos a mesma conexão com contextos isolados

        for (let i = 0; i < this.config.poolSize; i++) {
            try {
                const browser = await orchestrator.connect();

                const poolEntry = {
                    id: `browser-${i}`,
                    browser,
                    pages: new Map(), // taskId -> page
                    health: {
                        status: STATUS_VALUES.HEALTHY,
                        lastCheck: Date.now(),
                        consecutiveFailures: 0
                    },
                    stats: {
                        allocations: 0,
                        activeTasks: 0,
                        totalUptime: Date.now()
                    }
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

        log('INFO', `[BrowserPool] Inicializado com ${this.pool.length}/${this.config.poolSize} instâncias`);
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

            // Gera taskId único temporário (será substituído pelo real)
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
                allocatedAt: Date.now()
            };

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
     */
    async _performHealthCheck() {
        this.stats.healthChecks++;

        for (const poolEntry of this.pool) {
            try {
                // Verifica se browser está conectado
                const isConnected = poolEntry.browser.isConnected();

                if (!isConnected) {
                    throw new Error('Browser desconectado');
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
                }
            } catch (error) {
                log('WARN', `[BrowserPool] Health check falhou para ${poolEntry.id}: ${error.message}`);

                poolEntry.health.consecutiveFailures++;

                if (poolEntry.health.consecutiveFailures >= 3) {
                    poolEntry.health.status = STATUS_VALUES.CRASHED;
                    this.stats.crashesDetected++;

                    log(
                        'ERROR',
                        `[BrowserPool] Instância ${poolEntry.id} marcada como CRASHED (${poolEntry.health.consecutiveFailures} falhas consecutivas)`
                    );

                    // TODO: Auto-restart (requer orquestração externa para reiniciar Chrome)
                    // Por enquanto, apenas marca como crashed
                }
            }
        }
    }

    /**
     * Retorna health status do pool.
     */
    async getHealth() {
        const healthyCount = this.pool.filter(e => e.health.status === STATUS_VALUES.HEALTHY).length;
        const unhealthyCount = this.pool.filter(e => e.health.status === STATUS_VALUES.UNHEALTHY).length;
        const crashedCount = this.pool.filter(e => e.health.status === STATUS_VALUES.CRASHED).length;

        return {
            status: healthyCount > 0 ? 'OPERATIONAL' : 'DEGRADED',
            poolSize: this.pool.length,
            healthy: healthyCount,
            unhealthy: unhealthyCount,
            crashed: crashedCount,
            stats: { ...this.stats }
        };
    }

    /**
     * Shutdown gracioso do pool.
     * Fecha todas as páginas e desconecta browsers.
     */
    async shutdown() {
        this.shuttingDown = true;

        log('INFO', '[BrowserPool] Iniciando shutdown gracioso...');

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
}

module.exports = BrowserPoolManager;
