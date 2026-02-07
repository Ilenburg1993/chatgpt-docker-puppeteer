// @ts-check - Type checking rigoroso habilitado (arquivo core)
import 'dotenv/config';
import { z } from 'zod';
import EventEmitter from 'node:events';
import { log } from './logger.js';
import * as PATHS from '#infra/fs/paths';
import { safeReadJSON } from '#infra/fs/safe_read';
/* --------------------------------------------------------------------------
   ENV VALIDATION (P8.5)
-------------------------------------------------------------------------- */
function validateEnvFile() {
    const requiredEnvVars = ['NODE_ENV'];

    const recommendedEnvVars = ['SERVER_PORT', 'DASHBOARD_PORT', 'CHROME_REMOTE_DEBUGGING_ADDRESS'];

    const missing = requiredEnvVars.filter(v => !process.env[v]);
    const missingRecommended = recommendedEnvVars.filter(v => !process.env[v]);

    if (missing.length > 0) {
        log('ERROR', `[CONFIG] Missing required env vars: ${missing.join(', ')}`);
        log('ERROR', '[CONFIG] Copy .env.example to .env and configure');
    }

    if (missingRecommended.length > 0) {
        log('WARN', `[CONFIG] Missing recommended env vars: ${missingRecommended.join(', ')}`);
        log('WARN', '[CONFIG] Using defaults (may not be optimal for production)');
    }
}

// Run validation on module load
validateEnvFile();

/* --------------------------------------------------------------------------
   DEPRECATION WARNING: PORT → SERVER_PORT
-------------------------------------------------------------------------- */
if (process.env.PORT && !process.env.SERVER_PORT) {
    console.warn('');
    console.warn('\x1b[33m[DEPRECATED]\x1b[0m PORT environment variable is deprecated.');
    console.warn('\x1b[33m[DEPRECATED]\x1b[0m Please use SERVER_PORT instead to avoid conflicts.');
    console.warn('\x1b[33m[DEPRECATED]\x1b[0m PORT will be removed in v6.0');
    console.warn('\x1b[33m[DEPRECATED]\x1b[0m Falling back to PORT value for now...');
    console.warn('');
}

/**
 * 1. SCHEMA MESTRE (O Contrato Paramétrico)
 * Define a estrutura rigorosa e os limites de segurança para cada parâmetro.
 */
const ConfigSchema = z
    .object({
        // --- Infraestrutura Base ---
        // Nota: inclui modos usados pelo ConnectionOrchestrator (wsEndpoint, connect)
        BROWSER_MODE: z
            .enum(['launcher', 'connect', 'wsEndpoint', 'executablePath', 'auto', 'external'])
            .default('wsEndpoint'),
        DEBUG_PORT: z
            .string()
            .url()
            .default(`http://localhost:${process.env.CHROME_PROXY_PORT || 9224}`),

        // --- Chrome & Proxy Connection (Topologia Canônica) ---
        // Porta onde Chrome REAL roda (Windows Host)
        CHROME_PORT: z.number().int().min(1024).max(65535).default(9225),

        // Host onde Chrome REAL roda (usado pelo Proxy para encaminhar)
        CHROME_HOST: z.string().default(process.env.CHROME_HOST || 'host.docker.internal'),

        // Porta onde Proxy roda (DevContainer)
        CHROME_PROXY_PORT: z.number().int().min(1024).max(65535).default(9224),

        // Host onde Puppeteer acessa o Proxy (sempre localhost no container)
        CHROME_PROXY_HOST: z.string().default('localhost'),

        // Interface que o Proxy escuta (0.0.0.0 = todas as interfaces)
        CHROME_PROXY_BIND: z.string().default('0.0.0.0'),

        // Flag para habilitar/desabilitar proxy
        CHROME_PROXY_ENABLED: z.boolean().default(true),

        IDLE_SLEEP: z.number().min(500).default(3000),

        // --- Engine Rhythm (Ritmo do Motor) ---
        CYCLE_DELAY: z.number().min(0).default(2000),
        PAUSED_SLEEP: z.number().min(1000).default(2000),
        UNKNOWN_ENV_SLEEP: z.number().min(1000).default(3000),
        MIN_ENV_CONFIDENCE: z.number().min(0).max(1).default(1),

        // --- Comportamento do Modelo ---
        DEFAULT_MODEL_ID: z.string().default('gpt-5'),
        adaptive_mode: z.enum(['auto', 'manual']).default('auto'),

        // --- Timeouts e Paciência ---
        STABILITY_INTERVAL: z.number().min(500).default(2000),
        PROGRESS_TIMEOUT_MS: z.number().default(90000),
        HEARTBEAT_TIMEOUT_MS: z.number().default(15000),
        ECHO_CONFIRM_TIMEOUT_MS: z.number().default(5000),
        CONTEXT_RESOLUTION_TIMEOUT: z.number().default(30000),

        // --- Limites de Execução e SLA ---
        TASK_TIMEOUT_MS: z.number().default(1800000),
        RUNNING_RECOVERY_MS: z.number().default(2400000),
        MAX_CONTINUATIONS: z.number().int().default(25),
        MAX_OUT_BYTES: z.number().default(10485760),

        // --- Digitação Humana (Biomechanics) ---
        CHUNK_SIZE: z.number().int().min(50).max(500).default(150),
        ECHO_RETRIES: z.number().int().min(1).max(10).default(5),
        ADAPTIVE_DELAY_BASE: z.number().min(10).max(100).default(40),
        ADAPTIVE_DELAY_MAX: z.number().min(100).max(1000).default(250),

        // --- Políticas de Segurança ---
        allow_dom_assist: z.boolean().default(true),
        multi_tab_policy: z.enum(['AUTO_CLOSE', 'MANUAL', 'IGNORE']).default('AUTO_CLOSE'),
        USER_INACTIVITY_THRESHOLD_MS: z.number().min(1000).default(5000),
        USER_ABORT_ACTION: z.enum(['PAUSE', 'FAIL', 'IGNORE']).default('PAUSE'),

        // --- Governança de Domínio ---
        allowedDomains: z.array(z.string()).default(['chatgpt.com', 'claude.ai', 'gemini.google.com', 'openai.com']),

        // --- Tuning do Adaptativo ---
        ADAPTIVE_ALPHA: z.number().min(0).max(1).default(0.15),
        ADAPTIVE_COOLDOWN_MS: z.number().min(1000).default(5000),

        // --- Concurrency & Workers (P9.9) ---
        MAX_WORKERS: z.number().int().min(1).max(10).default(3)
    })
    .passthrough(); // Preserva chaves de comentário "//"

/**
 * 2. GESTOR REATIVO DE CONFIGURAÇÃO
 * Implementa o padrão Singleton com capacidades de emissão de eventos.
 */
class ConfigurationManager extends EventEmitter {
    constructor() {
        super();
        // Inicializa o estado em RAM com os valores padrão (Baseline)
        this.currentConfig = ConfigSchema.parse({});
        this.isInitialized = false;
    }

    /**
     * Realiza a carga ou recarga (Hot-Reload) das configurações mestras.
     * @param {string} correlationId - Rastro de causalidade para rastreio no log.
     * @returns {Promise<object>} A configuração consolidada e validada.
     */
    async reload(correlationId = 'sys-boot') {
        try {
            log('DEBUG', '[CONFIG] Sincronizando definições com o disco...', correlationId);

            // Leitura segura e assíncrona
            const userConfig = (await safeReadJSON(PATHS.CONFIG)) || {};

            // Validação de Integridade via Zod
            const result = ConfigSchema.safeParse(userConfig);

            if (result.success) {
                const oldConfig = { ...this.currentConfig };

                // [ATOMIC SWAP] Atualiza o cache apenas após validação total
                this.currentConfig = result.data;
                this.isInitialized = true;

                log('INFO', '[CONFIG] Cache paramétrico atualizado.', correlationId);

                // Notifica o sistema sobre a mudança de definições
                this.emit('updated', {
                    new: this.currentConfig,
                    old: oldConfig,
                    ts: Date.now(),
                    correlationId
                });
            } else {
                log('ERROR', `[CONFIG] Falha na validação do config.json: ${result.error.message}`, correlationId);
            }

            return this.currentConfig;
        } catch (err) {
            log('WARN', `[CONFIG] Erro crítico no reload: ${err.message}. Mantendo estado anterior.`, correlationId);
            return this.currentConfig;
        }
    }

    /**
     * Getters de Acesso Direto (Proxy para o Cache em RAM)
     * Permitem leitura síncrona de alta performance pelo Kernel.
     */
    get all() {
        return this.currentConfig;
    }

    get IDLE_SLEEP() {
        return this.currentConfig.IDLE_SLEEP;
    }
    get CYCLE_DELAY() {
        return this.currentConfig.CYCLE_DELAY;
    }
    get PAUSED_SLEEP() {
        return this.currentConfig.PAUSED_SLEEP;
    }
    get UNKNOWN_ENV_SLEEP() {
        return this.currentConfig.UNKNOWN_ENV_SLEEP;
    }
    get MIN_ENV_CONFIDENCE() {
        return this.currentConfig.MIN_ENV_CONFIDENCE;
    }
    get RUNNING_RECOVERY_MS() {
        return this.currentConfig.RUNNING_RECOVERY_MS;
    }
    get CONTEXT_RESOLUTION_TIMEOUT() {
        return this.currentConfig.CONTEXT_RESOLUTION_TIMEOUT;
    }
    get allowedDomains() {
        return this.currentConfig.allowedDomains;
    }

    // --- Getters Adicionais (Novos Parâmetros) ---
    get BROWSER_MODE() {
        return this.currentConfig.BROWSER_MODE;
    }

    // Compat: expose DEBUG_PORT (historical name) directly.
    get DEBUG_PORT() {
        return this.currentConfig.DEBUG_PORT || null;
    }
    // Compatibilidade: retorna BROWSER_URL se definido, senão utiliza DEBUG_PORT
    get BROWSER_URL() {
        return this.currentConfig.BROWSER_URL || this.currentConfig.DEBUG_PORT || this.currentConfig.DEBUG_URL || null;
    }

    /**
     * WebSocket endpoint do Chrome (opcional, para conexões diretas WS)
     * Fonte: 1. process.env.CHROME_WS_ENDPOINT 2. config.json WS_ENDPOINT 3. null
     */
    get WS_ENDPOINT() {
        return this.currentConfig.WS_ENDPOINT || null;
    }

    /**
     * Retorna browserEndpoint consolidado (objeto canônico para ConnectionOrchestrator)
     * Estrutura: { url: string, wsEndpoint?: string }
     *
     * Ordem de precedência:
     * - url: CHROME_WS_ENDPOINT > BROWSER_URL > DEBUG_PORT > localhost:CHROME_PROXY_PORT
     * - wsEndpoint: CHROME_WS_ENDPOINT (se definido)
     */
    get BROWSER_ENDPOINT() {
        const proxyPort = this.currentConfig.CHROME_PROXY_PORT || 9224;
        const defaultUrl = `http://${this.currentConfig.CHROME_PROXY_HOST || 'localhost'}:${proxyPort}`;

        // URL: prioriza env vars, depois config, depois default
        const url =
            process.env.CHROME_WS_ENDPOINT ||
            this.currentConfig.BROWSER_URL ||
            this.currentConfig.DEBUG_PORT ||
            defaultUrl;

        // wsEndpoint opcional (só se for WS URL)
        const wsEndpoint = this.currentConfig.WS_ENDPOINT || null;

        return {
            url,
            ...(wsEndpoint && { wsEndpoint })
        };
    }

    get DEFAULT_MODEL_ID() {
        return this.currentConfig.DEFAULT_MODEL_ID;
    }
    get adaptive_mode() {
        return this.currentConfig.adaptive_mode;
    }
    get STABILITY_INTERVAL() {
        return this.currentConfig.STABILITY_INTERVAL;
    }
    get PROGRESS_TIMEOUT_MS() {
        return this.currentConfig.PROGRESS_TIMEOUT_MS;
    }
    get HEARTBEAT_TIMEOUT_MS() {
        return this.currentConfig.HEARTBEAT_TIMEOUT_MS;
    }
    get ECHO_CONFIRM_TIMEOUT_MS() {
        return this.currentConfig.ECHO_CONFIRM_TIMEOUT_MS;
    }
    get TASK_TIMEOUT_MS() {
        return this.currentConfig.TASK_TIMEOUT_MS;
    }
    get MAX_CONTINUATIONS() {
        return this.currentConfig.MAX_CONTINUATIONS;
    }
    get MAX_OUT_BYTES() {
        return this.currentConfig.MAX_OUT_BYTES;
    }
    get CHUNK_SIZE() {
        return this.currentConfig.CHUNK_SIZE;
    }
    get ECHO_RETRIES() {
        return this.currentConfig.ECHO_RETRIES;
    }
    get ADAPTIVE_DELAY_BASE() {
        return this.currentConfig.ADAPTIVE_DELAY_BASE;
    }
    get ADAPTIVE_DELAY_MAX() {
        return this.currentConfig.ADAPTIVE_DELAY_MAX;
    }
    get allow_dom_assist() {
        return this.currentConfig.allow_dom_assist;
    }
    get multi_tab_policy() {
        return this.currentConfig.multi_tab_policy;
    }
    get USER_INACTIVITY_THRESHOLD_MS() {
        return this.currentConfig.USER_INACTIVITY_THRESHOLD_MS;
    }
    get USER_ABORT_ACTION() {
        return this.currentConfig.USER_ABORT_ACTION;
    }
    get ADAPTIVE_ALPHA() {
        return this.currentConfig.ADAPTIVE_ALPHA;
    }
    get ADAPTIVE_COOLDOWN_MS() {
        return this.currentConfig.ADAPTIVE_COOLDOWN_MS;
    }

    // --- Chrome & Proxy Connection Getters ---
    get CHROME_HOST() {
        return this.currentConfig.CHROME_HOST;
    }
    get CHROME_PROXY_HOST() {
        return this.currentConfig.CHROME_PROXY_HOST;
    }
    get CHROME_PROXY_BIND() {
        return this.currentConfig.CHROME_PROXY_BIND;
    }
    get CHROME_PROXY_ENABLED() {
        return this.currentConfig.CHROME_PROXY_ENABLED;
    }
    get CHROME_PORT() {
        return this.currentConfig.CHROME_PORT;
    }
    get CHROME_PROXY_PORT() {
        return this.currentConfig.CHROME_PROXY_PORT;
    }

    /**
     * Generic getter method for accessing config values with default fallback
     * @param {string} key - Configuration key
     * @param {*} defaultValue - Default value if key not found
     * @returns {*} Configuration value or default
     */
    get(key, defaultValue) {
        return this.currentConfig[key] !== undefined ? this.currentConfig[key] : defaultValue;
    }
}

// Exporta como Singleton Soberano
const manager = new ConfigurationManager();
export default manager;
