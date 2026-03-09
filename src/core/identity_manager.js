// @ts-check - Type checking rigoroso habilitado (arquivo core)
import * as io from '#infra/io';
import { ActorRole, PROTOCOL_VERSION } from '#shared/nerv/constants';
import { validateRobotIdentity } from '#shared/nerv/schemas';
import { v4 as uuidv4 } from 'uuid';
import { log } from './logger.js';

/**
 * @typedef {object} RobotIdentity
 * @property {string} robot_id - ID único e persistente do robô.
 * @property {string} instance_id - ID efêmero da instância atual.
 * @property {string} role - Papel do ator no sistema NERV.
 * @property {string} version - Versão do protocolo.
 * @property {string[]} capabilities - Lista de capacidades suportadas.
 * @property {object} metadata - Metadados da instância.
 * @property {string} metadata.platform - Plataforma do sistema.
 * @property {string} metadata.node_version - Versão do Node.js.
 * @property {string} metadata.started_at - Timestamp de inicialização.
 */

/**
 * @typedef {object} StoredIdentity
 * @property {string} robot_id - ID do robô armazenado.
 * @property {string} [born_at] - Data de nascimento do robô.
 * @property {string} [protocol] - Versão do protocolo.
 */

/**
 * Gerenciador de identidade soberana do robô. Mantém DNA persistente (robot_id) e identidade efêmera (instance_id).
 * Side-effects: Lê/escreve identidade em armazenamento persistente, valida identidade.
 */
class IdentityManager {
    constructor() {
        this.robotId = null; // DNA persistente (Identidade do Robô)
        this.instanceId = uuidv4(); // Vida efêmera (Identidade do Processo)

        // Capabilities V2.0: Feature Set Completo + Versioning
        this.capabilities = [
            // Core Driver Features
            'BROWSER_CONTROL_V3', // Puppeteer + BrowserPool + ConnectionOrchestrator
            'MULTI_BROWSER_SUPPORT', // Chrome + Chromium + Edge
            'FRAME_NAVIGATION_V2', // Cross-origin iframe navigation

            // Perception & Interface Detection (SADI)
            'SADI_V19', // Sensory Analysis Deep Intelligence
            'ADAPTIVE_SELECTORS', // Dynamic selector evolution
            'SHADOW_DOM_TRAVERSAL', // Deep shadow root queries
            'SVG_SIGNATURE_MATCHING', // Icon geometry recognition

            // Human Simulation & Anti-Detection
            'HUMAN_BIOMECHANICS_V2', // Mouse jitter, typing errors, cognitive delays
            'GHOST_CURSOR', // Invisible cursor movement simulation
            'ADAPTIVE_TIMEOUTS_V2', // Dynamic retry with exponential backoff

            // Task System & Processing
            'TASK_SCHEMA_V5', // Latest task structure (execution, mission, result V2)
            'RESPONSE_CAPTURE_V2', // Multi-format response storage (txt, md, json, html)
            'AUTOMATIC_MIGRATION_V4_V5', // Backward compatibility V4 ↔ V5
            'CONTEXT_RECURSION_V1', // Recursive context accumulation

            // IPC & Communication
            'NERV_PROTOCOL_V2', // Event-driven IPC backbone
            'WEBSOCKET_IPC', // Real-time dashboard communication
            'CIRCUIT_BREAKER_V1', // Fault tolerance patterns

            // Mission System
            'MISSION_ORCHESTRATION', // Multi-step workflow execution (em construção)
            'CHECKPOINT_RECOVERY', // Resume from last successful step
            'LLM_AS_JUDGE', // AI-powered validation (planejado)

            // Safety & Validation
            'INPUT_SANITIZATION', // Path traversal prevention
            'SCHEMA_VALIDATION_ZOD', // Type-safe data structures
            'ATOMIC_WRITES', // Corruption-resistant file operations
            'DNA_EVOLUTION_TRACKING', // Selector learning & versioning
        ];
    }

    /**
     * Inicializa a identidade soberana. Tenta carregar o DNA existente ou realiza o "Nascimento" do robô. Side-effects:
     * Lê identidade armazenada, gera nova se necessário, salva no armazenamento.
     *
     * @returns {Promise<void>} Não retorna valor.
     * @throws {Error} Lança erro se falhar ao inicializar identidade.
     */
    async initialize() {
        try {
            // [V510] Delegação total de I/O para a Fachada Unificada
            const stored = await io.getIdentity();

            if (stored?.robot_id) {
                this.robotId = stored.robot_id;
                log('INFO', `[IDENTITY] DNA carregado com sucesso: ${this.robotId}`);
            } else {
                // O Nascimento: Geração de DNA imutável
                this.robotId = uuidv4();

                await io.saveIdentity({
                    robot_id: this.robotId,
                    born_at: new Date().toISOString(),
                    protocol: PROTOCOL_VERSION,
                });

                log('WARN', `[IDENTITY] Novo DNA gerado (Nascimento): ${this.robotId}`);
            }
        } catch (/** @type {any} */ _rawErr) {
            const err = /** @type {any} */ (_rawErr);
            log('FATAL', `[IDENTITY] Falha crítica ao inicializar identidade: ${err.message}`);
            throw err;
        }
    }

    /**
     * Retorna o objeto de identidade completo e validado. Esta é a ÚNICA saída autorizada para o Handshake do IPC 2.0.
     *
     * @returns {RobotIdentity} Identidade homologada conforme o Shared Kernel.
     * @throws {Error} Lança erro se identidade não foi inicializada.
     */
    getFullIdentity() {
        if (!this.robotId) {
            throw new Error('[IDENTITY] Tentativa de acesso à identidade antes da inicialização.');
        }

        const identity = {
            robot_id: this.robotId,
            instance_id: this.instanceId,
            role: ActorRole.KERNEL, // Atualizado: vocabulário NERV
            version: PROTOCOL_VERSION,
            capabilities: this.capabilities,
            metadata: {
                platform: process.platform,
                node_version: process.version,
                started_at: new Date().toISOString(),
            },
        };

        // [V510] Validação Nativa: Performance máxima para o barramento IPC
        return validateRobotIdentity(identity);
    }

    /**
     * Acessores controlados para uso interno do motor.
     */
    /**
     * Retorna o ID persistente do robô.
     *
     * @returns {string | null} ID do robô ou null se não inicializado.
     */
    getRobotId() {
        return this.robotId;
    }

    /**
     * Retorna o ID efêmero da instância atual.
     *
     * @returns {string} ID da instância atual.
     */
    getInstanceId() {
        return this.instanceId;
    }
}

/**
 * Instância singleton do gerenciador de identidade. Side-effects: Mantém estado de identidade em memória, persiste DNA.
 *
 * @type {IdentityManager}
 */
export default new IdentityManager();
