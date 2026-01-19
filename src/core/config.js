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
const io = require('../infra/io');

/**
 * 1. SCHEMA MESTRE (O Contrato Paramétrico)
 * Define a estrutura rigorosa e os limites de segurança para cada parâmetro.
 */
const ConfigSchema = z.object({
    // --- Infraestrutura Base ---
    DEBUG_PORT: z.string().url().default('http://localhost:9222'),
    IDLE_SLEEP: z.number().min(500).default(3000),
    
    // --- Engine Rhythm (Ritmo do Motor) ---
    CYCLE_DELAY: z.number().min(0).default(2000),
    PAUSED_SLEEP: z.number().min(1000).default(2000),
    UNKNOWN_ENV_SLEEP: z.number().min(1000).default(3000),
    MIN_ENV_CONFIDENCE: z.number().min(0).max(1).default(1),
    
    // --- Limites de Execução e SLA ---
    TASK_TIMEOUT_MS: z.number().default(1800000),
    RUNNING_RECOVERY_MS: z.number().default(2400000),
    MAX_CONTINUATIONS: z.number().int().default(25),
    MAX_OUT_BYTES: z.number().default(10485760),
    
    // --- Timeouts de Protocolo e Contexto ---
    PROGRESS_TIMEOUT_MS: z.number().default(90000),
    HEARTBEAT_TIMEOUT_MS: z.number().default(15000),
    ECHO_CONFIRM_TIMEOUT_MS: z.number().default(5000),
    CONTEXT_RESOLUTION_TIMEOUT: z.number().default(30000),
    
    // --- Governança de Domínio ---
    allowedDomains: z.array(z.string()).default([
        'chatgpt.com', 
        'claude.ai', 
        'gemini.google.com',
        'openai.com'
    ])
}).passthrough(); // Preserva chaves de comentário "//"

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

            // Leitura segura e assíncrona via Fachada de IO
            const userConfig = await io.safeReadJSON(PATHS.CONFIG) || {};
            
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
    get all() { return this.currentConfig; }
    
    get IDLE_SLEEP() { return this.currentConfig.IDLE_SLEEP; }
    get CYCLE_DELAY() { return this.currentConfig.CYCLE_DELAY; }
    get PAUSED_SLEEP() { return this.currentConfig.PAUSED_SLEEP; }
    get UNKNOWN_ENV_SLEEP() { return this.currentConfig.UNKNOWN_ENV_SLEEP; }
    get MIN_ENV_CONFIDENCE() { return this.currentConfig.MIN_ENV_CONFIDENCE; }
    get RUNNING_RECOVERY_MS() { return this.currentConfig.RUNNING_RECOVERY_MS; }
    get CONTEXT_RESOLUTION_TIMEOUT() { return this.currentConfig.CONTEXT_RESOLUTION_TIMEOUT; }
    get allowedDomains() { return this.currentConfig.allowedDomains; }
}

// Exporta como Singleton Soberano
const manager = new ConfigurationManager();
module.exports = manager;