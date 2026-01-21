/* ==========================================================================
   src/core/config.js
   Audit Level: 740 — Sovereign Reactive Configuration (Singularity Edition)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Centralizar, validar e prover acesso reativo aos parâmetros
                     de ritmo e comportamento do sistema (config.json).
   Sincronizado com: io.js V730, execution_engine.js V1.6.0, paths.js V700.
========================================================================== */

const { z } = require('zod');
const EventEmitter = require('events');
const { log } = require('./logger');
const PATHS = require('../infra/fs/paths');
const { safeReadJSON } = require('../infra/fs/safe_read');

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

/**
 * 1. SCHEMA MESTRE (O Contrato Paramétrico)
 * Define a estrutura rigorosa e os limites de segurança para cada parâmetro.
 */
const ConfigSchema = z
    .object({
        // --- Infraestrutura Base ---
        BROWSER_MODE: z.enum(['launcher', 'external', 'auto']).default('launcher'),
        DEBUG_PORT: z.string().url().default('http://localhost:9222'),
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
        ADAPTIVE_COOLDOWN_MS: z.number().min(1000).default(5000)
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
}

// Exporta como Singleton Soberano
const manager = new ConfigurationManager();
module.exports = manager;
