// @ts-check - Type checking rigoroso habilitado (arquivo core)
import * as PATHS from '#infra/fs/paths';
import { safeReadJSON } from '#infra/fs/safe_read';
import EventEmitter from 'node:events';
import { z } from 'zod';
import './env_bootstrap.js';
import { log } from './logger.js';

/**
 * @typedef {object} BrowserEndpoint
 * @property {string} url - URL do endpoint do browser.
 * @property {string} [wsEndpoint] - Endpoint WebSocket opcional.
 */

/**
 * @typedef {object} ConfigUpdateEvent
 * @property {Record<string, unknown>} new - Nova configuração.
 * @property {Record<string, unknown>} old - Configuração anterior.
 * @property {number} ts - Timestamp da atualização.
 * @property {string} correlationId - ID de correlação para rastreamento.
 */

/* --------------------------------------------------------------------------
   ENV VALIDATION (P8.5)
-------------------------------------------------------------------------- */

/**
 * Valida variáveis de ambiente obrigatórias e recomendadas.
 * Side-effects: Registra logs de erro/aviso se faltarem variáveis.
 */
function validateEnvFile() {
    const requiredEnvVars = ['NODE_ENV'];

    const recommendedEnvVars = ['SERVER_PORT', 'BROWSER_MODE', 'CHROME_PROXY_PORT'];

    const missing = requiredEnvVars.filter(v => !process.env[v]);
    const missingRecommended = recommendedEnvVars.filter(v => !process.env[v]);

    if (missing.length > 0) {
        log('ERROR', `[CONFIG] Missing required env vars: ${missing.join(', ')}`);
        log('ERROR', '[CONFIG] Configure .env/.env.local (or remoteEnv in the devcontainer) before boot');
    }

    if (missingRecommended.length > 0) {
        log('WARN', `[CONFIG] Missing recommended env vars: ${missingRecommended.join(', ')}`);
        log('WARN', '[CONFIG] Using defaults (may not be optimal for production)');
    }
}

function emitDeprecatedPortWarning() {
    if (!process.env.PORT || process.env.SERVER_PORT) {
        return;
    }

    log('WARN', '[DEPRECATED] PORT environment variable is deprecated.');
    log('WARN', '[DEPRECATED] Please use SERVER_PORT instead to avoid conflicts.');
    log('WARN', '[DEPRECATED] PORT will be removed in v6.0');
    log('WARN', '[DEPRECATED] Falling back to PORT value for now...');
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
        MAX_WORKERS: z.number().int().min(1).max(10).default(3),

        // --- Segurança & API ---
        SERVER_PORT: z.number().int().min(1024).max(65535).default(3008),
        // ✅ P0 FIX: Validate allowed origins to prevent hardcoded IP issues
        ALLOWED_ORIGINS: z
            .union([
                z.string(), // "http://foo.com,https://bar.com"
                z.array(z.string()), // ["http://foo.com"]
            ])
            .default(['http://localhost:3008']),
        DASHBOARD_AUTH_REQUIRED: z.boolean().default(process.env.DASHBOARD_AUTH_REQUIRED !== 'false'),
        DASHBOARD_AUTH_USERNAME: z.string().default(process.env.DASHBOARD_AUTH_USERNAME || ''),
        DASHBOARD_AUTH_PASSWORD: z.string().default(process.env.DASHBOARD_AUTH_PASSWORD || ''),
        DASHBOARD_SOCKET_AUTH_REQUIRED: z.boolean().default(process.env.DASHBOARD_SOCKET_AUTH_REQUIRED !== 'false'),
        DASHBOARD_COMMANDS_ENABLED: z.boolean().default(process.env.DASHBOARD_COMMANDS_ENABLED === 'true'),
        DASHBOARD_COMMAND_ROLE: z.string().default(process.env.DASHBOARD_COMMAND_ROLE || 'admin'),
        DASHBOARD_TASK_SYNC_MODE: z
            .enum(['ssot_feed', 'legacy_bridge'])
            .default(process.env.DASHBOARD_TASK_SYNC_MODE === 'legacy_bridge' ? 'legacy_bridge' : 'ssot_feed'),
        DASHBOARD_LEGACY_BRIDGE_CONTINGENCY: z
            .boolean()
            .default(process.env.DASHBOARD_LEGACY_BRIDGE_CONTINGENCY === 'true'),
        DASHBOARD_EMIT_TASK_UPDATED_COMPAT: z
            .boolean()
            .default(process.env.DASHBOARD_EMIT_TASK_UPDATED_COMPAT === 'true'),
        CONTROL_REQUIRE_REASON: z.boolean().default(process.env.CONTROL_REQUIRE_REASON !== 'false'),
        CONTROL_REQUIRE_IDEMPOTENCY_KEY: z.boolean().default(process.env.CONTROL_REQUIRE_IDEMPOTENCY_KEY !== 'false'),
        CONTROL_STRICT_PAUSE_TO_EDIT: z.boolean().default(process.env.CONTROL_STRICT_PAUSE_TO_EDIT !== 'false'),
        MAESTRO_ENTRY_AUTOSTART: z.boolean().default(process.env.MAESTRO_ENTRY_AUTOSTART === 'true'),
        BOOT_RETRY_BASE_MS: z.number().int().min(10).default(1000),
        BOOT_RETRY_MAX_MS: z.number().int().min(10).default(8000),
        BOOT_RETRY_MAX_ATTEMPTS: z.number().int().min(1).max(100).default(10),
        BOOT_DEGRADED_READY_ALLOWED: z.boolean().default(process.env.BOOT_DEGRADED_READY_ALLOWED !== 'false'),
        MCP_UPSTREAM_INSTALL_GLOBAL_HOOK: z.boolean().default(process.env.MCP_UPSTREAM_INSTALL_GLOBAL_HOOK === 'true'),
        RBAC_BOOTSTRAP_OWNER_USERNAME: z.string().default(process.env.RBAC_BOOTSTRAP_OWNER_USERNAME || ''),
        RBAC_BOOTSTRAP_OWNER_PASSWORD: z.string().default(process.env.RBAC_BOOTSTRAP_OWNER_PASSWORD || ''),
        UI_PREFS_PERSISTENCE: z.enum(['sqlite']).default('sqlite'),
        LEGACY_PATHS_CONTINGENCY: z.boolean().default(process.env.LEGACY_PATHS_CONTINGENCY === 'true'),

        // --- Driver Factory / Pool Configuration (Centralized) ---
        DRIVER_POOL_MAX_SIZE: z.number().int().min(1).max(20).default(5),
        DRIVER_POOL_MIN_SIZE: z.number().int().min(0).max(5).default(2),
        DRIVER_IDLE_TIMEOUT_MS: z.number().min(5000).default(300000), // 5 min
        DRIVER_WARMUP_TARGETS: z.union([z.string(), z.array(z.string())]).default('chatgpt,gemini'),
        DRIVER_POOL_ENABLED: z.boolean().default(true),
        DRIVER_BACKPRESSURE_TIMEOUT_MS: z.number().default(5000),
        DRIVER_BACKPRESSURE_TEMP: z.boolean().default(true),
        TASK_CONTROL_ABORT_TIMEOUT_MS: z.number().int().min(100).default(1500),
        TASK_CONTROL_ABORT_MAX_RETRIES: z.number().int().min(0).max(10).default(2),
        MISSION_STEP_DISPATCH_MODE: z
            .enum(['ssot_queue', 'legacy_direct'])
            .default(process.env.MISSION_STEP_DISPATCH_MODE === 'legacy_direct' ? 'legacy_direct' : 'ssot_queue'),
        MISSION_MANAGER_LEGACY_DISPATCH_ENABLED: z
            .boolean()
            .default(process.env.MISSION_MANAGER_LEGACY_DISPATCH_ENABLED === 'true'),

        // --- BrowserPool Configuration (formalized schema) ---
        BROWSER_POOL_SIZE: z.number().int().min(1).max(20).default(3),
        ALLOCATION_STRATEGY: z.enum(['round-robin', 'least-loaded', 'target-affinity']).default('round-robin'),
        HEALTH_CHECK_INTERVAL: z.number().int().min(1000).default(30000),
        BROWSER_PAGE_TTL_MS: z.number().int().min(1000).default(3600000),
        BROWSER_ALLOCATE_MAX_ATTEMPTS: z.number().int().min(1).optional(),
    })
    .passthrough(); // Preserva chaves de comentário "//"

/**
 * 2. GESTOR REATIVO DE CONFIGURAÇÃO
 * Implementa o padrão Singleton com capacidades de emissão de eventos.
 */
/**
 * Gerenciador reativo de configuração com cache em RAM e hot-reload.
 * Extends EventEmitter para notificar mudanças de configuração.
 * Side-effects: Emite evento 'updated' quando configuração muda.
 */
class ConfigurationManager extends EventEmitter {
    constructor() {
        super();
        // Inicializa o estado em RAM com os valores padrão (Baseline)
        this.currentConfig = ConfigSchema.parse({});
        this._frozenConfigCache = null; // Cached frozen snapshot for .all getter
        this.isInitialized = false;
        this._envValidationDone = false;
        this._deprecationWarningShown = false;
    }

    /**
     * Realiza a carga ou recarga (Hot-Reload) das configurações mestras.
     * Side-effects: Lê arquivo config.json, valida, atualiza cache, emite evento 'updated'.
     * @param {string} [correlationId='sys-boot'] - Rastro de causalidade para rastreio no log.
     * @returns {Promise<Record<string, unknown>>} A configuração consolidada e validada.
     * @throws {Error} Nunca lança erro - opera em modo fail-safe.
     */
    async reload(correlationId = 'sys-boot') {
        try {
            if (!this._envValidationDone) {
                validateEnvFile();
                this._envValidationDone = true;
            }

            if (!this._deprecationWarningShown) {
                emitDeprecatedPortWarning();
                this._deprecationWarningShown = true;
            }

            log('DEBUG', '[CONFIG] Sincronizando definições com o disco...', correlationId);

            // Leitura segura e assíncrona
            const userConfig = (await safeReadJSON(PATHS.CONFIG)) || {};

            // Validação de Integridade via Zod
            const result = ConfigSchema.safeParse(userConfig);

            if (result.success) {
                const oldConfig = { ...this.currentConfig };

                // [ATOMIC SWAP] Atualiza o cache apenas após validação total
                this.currentConfig = result.data;
                this._frozenConfigCache = Object.freeze({ ...result.data }); // Invalidate and recreate frozen cache
                this.isInitialized = true;

                log('INFO', '[CONFIG] Cache paramétrico atualizado.', correlationId);

                // Notifica o sistema sobre a mudança de definições
                this.emit('updated', {
                    new: this.currentConfig,
                    old: oldConfig,
                    ts: Date.now(),
                    correlationId,
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
        // Return cached frozen object to avoid recreating on every access
        if (!this._frozenConfigCache) {
            this._frozenConfigCache = Object.freeze({ ...this.currentConfig });
        }
        return this._frozenConfigCache;
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
            ...(wsEndpoint && { wsEndpoint }),
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

    get ALLOWED_ORIGINS() {
        return this.currentConfig.ALLOWED_ORIGINS;
    }
    get DASHBOARD_AUTH_REQUIRED() {
        return this.currentConfig.DASHBOARD_AUTH_REQUIRED;
    }
    get DASHBOARD_AUTH_USERNAME() {
        return this.currentConfig.DASHBOARD_AUTH_USERNAME;
    }
    get DASHBOARD_AUTH_PASSWORD() {
        return this.currentConfig.DASHBOARD_AUTH_PASSWORD;
    }
    get DASHBOARD_SOCKET_AUTH_REQUIRED() {
        return this.currentConfig.DASHBOARD_SOCKET_AUTH_REQUIRED;
    }
    get DASHBOARD_COMMANDS_ENABLED() {
        return this.currentConfig.DASHBOARD_COMMANDS_ENABLED;
    }
    get DASHBOARD_COMMAND_ROLE() {
        return this.currentConfig.DASHBOARD_COMMAND_ROLE || 'admin';
    }
    get DASHBOARD_TASK_SYNC_MODE() {
        return this.currentConfig.DASHBOARD_TASK_SYNC_MODE;
    }
    get DASHBOARD_LEGACY_BRIDGE_CONTINGENCY() {
        return this.currentConfig.DASHBOARD_LEGACY_BRIDGE_CONTINGENCY;
    }
    get DASHBOARD_EMIT_TASK_UPDATED_COMPAT() {
        return this.currentConfig.DASHBOARD_EMIT_TASK_UPDATED_COMPAT;
    }
    get CONTROL_REQUIRE_REASON() {
        return this.currentConfig.CONTROL_REQUIRE_REASON;
    }
    get CONTROL_REQUIRE_IDEMPOTENCY_KEY() {
        return this.currentConfig.CONTROL_REQUIRE_IDEMPOTENCY_KEY;
    }
    get CONTROL_STRICT_PAUSE_TO_EDIT() {
        return this.currentConfig.CONTROL_STRICT_PAUSE_TO_EDIT;
    }
    get MAESTRO_ENTRY_AUTOSTART() {
        return this.currentConfig.MAESTRO_ENTRY_AUTOSTART;
    }
    get BOOT_RETRY_BASE_MS() {
        return this.currentConfig.BOOT_RETRY_BASE_MS;
    }
    get BOOT_RETRY_MAX_MS() {
        return this.currentConfig.BOOT_RETRY_MAX_MS;
    }
    get BOOT_RETRY_MAX_ATTEMPTS() {
        return this.currentConfig.BOOT_RETRY_MAX_ATTEMPTS;
    }
    get BOOT_DEGRADED_READY_ALLOWED() {
        return this.currentConfig.BOOT_DEGRADED_READY_ALLOWED;
    }
    get MCP_UPSTREAM_INSTALL_GLOBAL_HOOK() {
        return this.currentConfig.MCP_UPSTREAM_INSTALL_GLOBAL_HOOK;
    }
    get RBAC_BOOTSTRAP_OWNER_USERNAME() {
        return this.currentConfig.RBAC_BOOTSTRAP_OWNER_USERNAME;
    }
    get RBAC_BOOTSTRAP_OWNER_PASSWORD() {
        return this.currentConfig.RBAC_BOOTSTRAP_OWNER_PASSWORD;
    }
    get UI_PREFS_PERSISTENCE() {
        return this.currentConfig.UI_PREFS_PERSISTENCE;
    }
    get LEGACY_PATHS_CONTINGENCY() {
        return this.currentConfig.LEGACY_PATHS_CONTINGENCY;
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

    // --- Server Configuration Getters ---
    get SERVER_PORT() {
        return this.currentConfig.SERVER_PORT || 3008;
    }
    get ENABLE_TASK_SYNC_BRIDGE() {
        return this.currentConfig.ENABLE_TASK_SYNC_BRIDGE || false;
    }

    // --- Driver Factory Getters ---
    get DRIVER_POOL_MAX_SIZE() {
        return this.currentConfig.DRIVER_POOL_MAX_SIZE;
    }
    get DRIVER_POOL_MIN_SIZE() {
        return this.currentConfig.DRIVER_POOL_MIN_SIZE;
    }
    get DRIVER_IDLE_TIMEOUT_MS() {
        return this.currentConfig.DRIVER_IDLE_TIMEOUT_MS;
    }
    get DRIVER_WARMUP_TARGETS() {
        const val = this.currentConfig.DRIVER_WARMUP_TARGETS;
        return Array.isArray(val)
            ? val
            : val
                  .split(',')
                  .map(s => s.trim())
                  .filter(Boolean);
    }
    get DRIVER_POOL_ENABLED() {
        return this.currentConfig.DRIVER_POOL_ENABLED;
    }
    get DRIVER_BACKPRESSURE_TIMEOUT_MS() {
        return this.currentConfig.DRIVER_BACKPRESSURE_TIMEOUT_MS;
    }
    get DRIVER_BACKPRESSURE_TEMP() {
        return this.currentConfig.DRIVER_BACKPRESSURE_TEMP;
    }
    get TASK_CONTROL_ABORT_TIMEOUT_MS() {
        return this.currentConfig.TASK_CONTROL_ABORT_TIMEOUT_MS;
    }
    get TASK_CONTROL_ABORT_MAX_RETRIES() {
        return this.currentConfig.TASK_CONTROL_ABORT_MAX_RETRIES;
    }
    get MISSION_STEP_DISPATCH_MODE() {
        return this.currentConfig.MISSION_STEP_DISPATCH_MODE;
    }
    get MISSION_MANAGER_LEGACY_DISPATCH_ENABLED() {
        return this.currentConfig.MISSION_MANAGER_LEGACY_DISPATCH_ENABLED;
    }
    get BROWSER_POOL_SIZE() {
        return this.currentConfig.BROWSER_POOL_SIZE;
    }
    get ALLOCATION_STRATEGY() {
        return this.currentConfig.ALLOCATION_STRATEGY;
    }
    get HEALTH_CHECK_INTERVAL() {
        return this.currentConfig.HEALTH_CHECK_INTERVAL;
    }
    get BROWSER_PAGE_TTL_MS() {
        return this.currentConfig.BROWSER_PAGE_TTL_MS;
    }
    get BROWSER_ALLOCATE_MAX_ATTEMPTS() {
        return this.currentConfig.BROWSER_ALLOCATE_MAX_ATTEMPTS;
    }

    /**
     * Backwards-compatible getter used by legacy callers.
     * Supports dot-separated paths (e.g. "a.b.c") and a fallback value when the key is absent.
     * Also falls back to process.env when the requested key exists there.
     *
     * @param {string} key - The key or dot-path to retrieve from the current configuration.
     * @param {object} [fallback] - Value to return when the key is not present.
     * @returns {object} The value from configuration, environment, or the provided fallback.
     */
    get(key, fallback) {
        try {
            if (typeof key !== 'string' || key.length === 0) return fallback;

            // Fast-path: top-level direct property
            if (Object.prototype.hasOwnProperty.call(this.currentConfig, key)) {
                const v = this.currentConfig[key];
                return v === undefined ? fallback : v;
            }

            // Dot-path traversal (e.g. 'a.b.c')
            const parts = key.split('.');
            let val = this.currentConfig;
            for (const p of parts) {
                if (val && Object.prototype.hasOwnProperty.call(val, p)) {
                    val = val[p];
                } else {
                    val = undefined;
                    break;
                }
            }

            if (val === undefined) {
                // As a last resort, check environment variables (string values)
                if (process.env[key] !== undefined) return process.env[key];
                return fallback;
            }

            return val;
        } catch (_e) {
            // Fail-safe: never throw from config getter
            return fallback;
        }
    }
}

/**
 * Instância singleton soberana do gerenciador de configuração.
 * Mantém cache em RAM e coordena hot-reload via eventos.
 * @type {ConfigurationManager}
 */
const manager = new ConfigurationManager();

export default manager;
