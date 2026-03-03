// @ts-check

/**
 * Shared Health Check Module
 *
 * Módulo centralizado para verificação de saúde de serviços.
 * Usado por Audit Agent, Diagnostic Agent e outros consumidores.
 *
 * Este módulo fornece:
 * - Verificação de saúde do Ollama (localhost:11434)
 * - Verificação de saúde do Inference Gateway
 * - Verificação de recursos do sistema (CPU, memória)
 * - Status consolidado (healthy/degraded/unhealthy)
 *
 * Variáveis de ambiente:
 * - OLLAMA_HOST: Host do Ollama (padrão: http://localhost:11434)
 * - INFERENCE_GATEWAY_HOST: Host do Gateway (padrão: 127.0.0.1)
 * - INFERENCE_GATEWAY_PORT: Porta do Gateway (padrão: 3099)
 * - DIAGNOSTIC_DEFAULT_TIMEOUT_MS: Timeout em ms (padrão: 30000)
 */

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Status de saúde possíveis
 * @enum {string}
 */
export const HEALTH_STATUS = Object.freeze({
    HEALTHY: 'healthy',
    DEGRADED: 'degraded',
    UNHEALTHY: 'unhealthy',
    UNKNOWN: 'unknown',
});

/**
 * profundidade de verificação
 * @enum {string}
 */
export const DEPTH_LEVEL = Object.freeze({
    QUICK: 'quick',
    DEEP: 'deep',
});

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Obtém o host do Ollama
 * @returns {string}
 */
export function getOllamaHost() {
    return process.env.OLLAMA_HOST || 'http://localhost:11434';
}

/**
 * Obtém a URL base do Inference Gateway
 * @returns {string}
 */
export function getGatewayUrl() {
    const host = process.env.INFERENCE_GATEWAY_HOST || '127.0.0.1';
    const port = Number(process.env.INFERENCE_GATEWAY_PORT || 3099);
    return `http://${host}:${port}`;
}

/**
 * Obtém o timeout configurado
 * @param {number} defaultTimeout
 * @returns {number}
 */
export function getHealthCheckTimeout(defaultTimeout = 30000) {
    const envTimeout = process.env.DIAGNOSTIC_DEFAULT_TIMEOUT_MS;
    if (envTimeout === undefined || envTimeout === null) {
        return defaultTimeout;
    }
    const parsed = Number(envTimeout);
    return isNaN(parsed) ? defaultTimeout : Math.max(1000, parsed);
}

// ============================================================================
// HEALTH CHECK FUNCTIONS
// ============================================================================

/**
 * Verifica saúde do Ollama
 * @param {string} depth - Profundidade da verificação (quick, deep)
 * @returns {Promise<{
 *   connected: boolean,
 *   host: string,
 *   responseTimeMs: number|null,
 *   models: Array<{name: string, size: number, modified_at: string}>,
 *   version: string|null,
 *   error: string|null
 * }>}
 */
export async function checkOllamaHealth(depth = 'quick') {
    const start = Date.now();
    const ollamaHost = getOllamaHost();

    /** @type {Object} */
    const result = {
        connected: false,
        host: ollamaHost,
        responseTimeMs: null,
        models: [],
        version: null,
        error: null,
    };

    try {
        const timeoutMs = getHealthCheckTimeout();
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        const response = await fetch(`${ollamaHost}/api/tags`, {
            method: 'GET',
            signal: controller.signal,
        });

        clearTimeout(timeoutId);
        result.responseTimeMs = Date.now() - start;

        if (response.ok) {
            result.connected = true;
            const data = await response.json();
            result.models = (data.models || []).map(m => ({
                name: m.name,
                size: m.size,
                modified_at: m.modified_at,
            }));

            if (depth === 'deep') {
                result.version = await getOllamaVersion(ollamaHost);
            }
        } else {
            result.error = `HTTP ${response.status}: ${response.statusText}`;
        }
    } catch (error) {
        result.error = error.message;
        result.responseTimeMs = Date.now() - start;
    }

    return result;
}

/**
 * Obtém versão do Ollama
 * @param {string} ollamaHost
 * @returns {Promise<string|null>}
 */
async function getOllamaVersion(ollamaHost) {
    try {
        const response = await fetch(`${ollamaHost}/api/version`, {
            method: 'GET',
        });

        if (response.ok) {
            const data = await response.json();
            return data.version || null;
        }
    } catch {
        // Ignora erros de versão
    }
    return null;
}

/**
 * Verifica saúde do Inference Gateway
 * @param {string} depth - Profundidade da verificação (quick, deep)
 * @returns {Promise<{
 *   connected: boolean,
 *   url: string,
 *   responseTimeMs: number|null,
 *   policiesLoaded: boolean,
 *   modelsAvailable: number,
 *   error: string|null
 * }>}
 */
export async function checkGatewayHealth(depth = 'quick') {
    const start = Date.now();
    const gatewayUrl = getGatewayUrl();

    /** @type {Object} */
    const result = {
        connected: false,
        url: gatewayUrl,
        responseTimeMs: null,
        policiesLoaded: false,
        modelsAvailable: 0,
        error: null,
    };

    try {
        const timeoutMs = getHealthCheckTimeout();
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        const response = await fetch(`${gatewayUrl}/health`, {
            method: 'GET',
            signal: controller.signal,
        });

        clearTimeout(timeoutId);
        result.responseTimeMs = Date.now() - start;

        if (response.ok) {
            result.connected = true;
            const data = await response.json();
            result.policiesLoaded = data.policiesLoaded ?? false;

            if (depth === 'deep') {
                try {
                    const modelsResponse = await fetch(`${gatewayUrl}/v1/models`, {
                        method: 'GET',
                    });
                    if (modelsResponse.ok) {
                        const modelsData = await modelsResponse.json();
                        result.modelsAvailable = modelsData.data?.length || 0;
                    }
                } catch {
                    // Ignora erro de models
                }
            }
        } else {
            result.error = `HTTP ${response.status}: ${response.statusText}`;
        }
    } catch (error) {
        result.error = error.message;
        result.responseTimeMs = Date.now() - start;
    }

    return result;
}

/**
 * Verifica saúde do sistema (recursos)
 * @param {string} depth - Profundidade da verificação (quick, deep)
 * @returns {Promise<{
 *   status: string,
 *   memory: {totalMb: number, usedMb: number, freeMb: number, usagePercent: number},
 *   cpu: {count: number, loadAverage: number[]},
 *   uptime: number,
 *   platform?: string,
 *   arch?: string,
 *   hostname?: string,
 *   nodeVersion?: string
 * }>}
 */
export async function checkSystemHealth(depth = 'quick') {
    // Dynamic import para evitar problemas de inicialização
    const os = await import('node:os');

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memUsagePercent = (usedMem / totalMem) * 100;

    /** @type {Object} */
    const result = {
        status: HEALTH_STATUS.HEALTHY,
        memory: {
            totalMb: Math.round(totalMem / 1024 / 1024),
            usedMb: Math.round(usedMem / 1024 / 1024),
            freeMb: Math.round(freeMem / 1024 / 1024),
            usagePercent: Math.round(memUsagePercent * 100) / 100,
        },
        cpu: {
            count: os.cpus().length,
            loadAverage: os.loadavg(),
        },
        uptime: os.uptime(),
    };

    // Determina status baseado em recursos
    if (memUsagePercent > 90) {
        result.status = HEALTH_STATUS.UNHEALTHY;
    } else if (memUsagePercent > 75) {
        result.status = HEALTH_STATUS.DEGRADED;
    }

    if (depth === 'deep') {
        result.platform = os.platform();
        result.arch = os.arch();
        result.hostname = os.hostname();
        result.nodeVersion = process.version;
    }

    return result;
}

/**
 * Calcula status geral baseado nos resultados individuais
 * @param {Object} ollama - Resultado do Ollama
 * @param {Object} gateway - Resultado do Gateway
 * @param {Object} system - Resultado do sistema
 * @returns {string}
 */
export function calculateOverallStatus(ollama, gateway, system) {
    /** @type {string[]} */
    const statuses = [ollama.connected ? HEALTH_STATUS.HEALTHY : HEALTH_STATUS.UNHEALTHY, system.status];

    // Gateway é opcional, então só considera se estiver conectado
    if (gateway.connected !== undefined) {
        statuses.push(gateway.connected ? HEALTH_STATUS.HEALTHY : HEALTH_STATUS.DEGRADED);
    }

    if (statuses.includes(HEALTH_STATUS.UNHEALTHY)) {
        return HEALTH_STATUS.UNHEALTHY;
    }
    if (statuses.includes(HEALTH_STATUS.DEGRADED)) {
        return HEALTH_STATUS.DEGRADED;
    }
    return HEALTH_STATUS.HEALTHY;
}

// ============================================================================
// MAIN HEALTH CHECK FUNCTION
// ============================================================================

/**
 * Opções para verificação de saúde completa
 * @typedef {Object} HealthCheckOptions
 * @property {string} [depth='quick'] - Profundidade (quick, deep)
 * @property {boolean} [includeOllama=true] - Incluir verificação do Ollama
 * @property {boolean} [includeGateway=true] - Incluir verificação do Gateway
 * @property {boolean} [includeSystem=true] - Incluir verificação do sistema
 */

/**
 * Resultado da verificação de saúde
 * @typedef {Object} HealthCheckResult
 * @property {string} status - Status geral
 * @property {Object} ollama - Resultado do Ollama
 * @property {Object} gateway - Resultado do Gateway
 * @property {Object} system - Resultado do sistema
 * @property {string} timestamp - Timestamp da verificação
 * @property {number} durationMs - Duração em ms
 */

/**
 * Executa verificação completa de saúde
 * @param {HealthCheckOptions} options
 * @returns {Promise<HealthCheckResult>}
 */
export async function checkHealth(options = {}) {
    const { depth = 'quick', includeOllama = true, includeGateway = true, includeSystem = true } = options;

    const start = Date.now();

    // Executa verificações em paralelo
    const checks = [];

    if (includeOllama) {
        checks.push(checkOllamaHealth(depth));
    }
    if (includeGateway) {
        checks.push(checkGatewayHealth(depth));
    }
    if (includeSystem) {
        checks.push(checkSystemHealth(depth));
    }

    /** @type {Object[]} */
    const results = await Promise.all(checks);

    /** @type {Object} */
    const ollama = includeOllama ? results.shift() : { connected: false, error: 'disabled' };
    /** @type {Object} */
    const gateway = includeGateway ? results.shift() : { connected: false, error: 'disabled' };
    /** @type {Object} */
    const system = includeSystem ? results.shift() : { status: HEALTH_STATUS.UNKNOWN };

    const status = calculateOverallStatus(ollama, gateway, system);

    return {
        status,
        ollama,
        gateway,
        system,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - start,
    };
}

// ============================================================================
// FACTORY FUNCTION (CLASS-BASED)
// ============================================================================

/**
 * Classe para verificação de saúde dos serviços
 * Mantida para compatibilidade com código existente
 */
export class SharedHealthChecker {
    /**
     * @param {Object} [options]
     * @param {string} [options.depth]
     */
    constructor(options = {}) {
        this.options = options;
        this.lastCheck = null;
        this.checkCount = 0;
    }

    /**
     * Inicializa o serviço
     */
    async init() {
        // No-op for shared module
    }

    /**
     * Para o serviço
     */
    async stop() {
        // No-op for shared module
    }

    /**
     * Executa verificação de saúde em todos os serviços
     * @param {Object} [opts] - Opções de verificação
     * @param {string} [opts.depth] - Profundidade da verificação
     * @returns {Promise<HealthCheckResult>}
     */
    async checkAll(opts = {}) {
        const depth = opts.depth || this.options?.depth || 'quick';
        const result = await checkHealth({ depth });

        this.lastCheck = result;
        this.checkCount++;

        return result;
    }

    /**
     * Alias para checkAll para compatibilidade
     * @param {Object} [opts]
     * @returns {Promise<HealthCheckResult>}
     */
    async check(opts = {}) {
        return this.checkAll(opts);
    }

    /**
     * Calcula status geral
     * @param {Object} ollama
     * @param {Object} gateway
     * @param {Object} system
     * @returns {string}
     */
    calculateOverallStatus(ollama, gateway, system) {
        return calculateOverallStatus(ollama, gateway, system);
    }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Cria verificador de saúde para Diagnostic Agent
 * @returns {SharedHealthChecker}
 */
export function createDiagnosticHealthChecker() {
    return new SharedHealthChecker();
}

/**
 * Cria verificador de saúde para Audit Agent
 * @returns {SharedHealthChecker}
 */
export function createAuditHealthChecker() {
    return new SharedHealthChecker();
}

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

/**
 * Barrel compatível com consumidores legados do módulo de health-check compartilhado.
 * @type {{
 *   HEALTH_STATUS: typeof HEALTH_STATUS,
 *   DEPTH_LEVEL: typeof DEPTH_LEVEL,
 *   getOllamaHost: typeof getOllamaHost,
 *   getGatewayUrl: typeof getGatewayUrl,
 *   getHealthCheckTimeout: typeof getHealthCheckTimeout,
 *   checkOllamaHealth: typeof checkOllamaHealth,
 *   checkGatewayHealth: typeof checkGatewayHealth,
 *   checkSystemHealth: typeof checkSystemHealth,
 *   calculateOverallStatus: typeof calculateOverallStatus,
 *   checkHealth: typeof checkHealth,
 *   SharedHealthChecker: typeof SharedHealthChecker,
 *   createDiagnosticHealthChecker: typeof createDiagnosticHealthChecker,
 *   createAuditHealthChecker: typeof createAuditHealthChecker
 * }}
 */
export default {
    HEALTH_STATUS,
    DEPTH_LEVEL,
    getOllamaHost,
    getGatewayUrl,
    getHealthCheckTimeout,
    checkOllamaHealth,
    checkGatewayHealth,
    checkSystemHealth,
    calculateOverallStatus,
    checkHealth,
    SharedHealthChecker,
    createDiagnosticHealthChecker,
    createAuditHealthChecker,
};
