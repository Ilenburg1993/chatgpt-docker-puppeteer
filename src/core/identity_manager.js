/* ==========================================================================
   src/core/identity_manager.js
   Audit Level: 510 — Sovereign Identity Manager (Canonical)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Gerenciar a identidade soberana do robô.
                     - robot_id: DNA persistente (imutável no disco)
                     - instance_id: Vida efêmera (gerada a cada boot)
                     - Capabilities: Declaração de habilidades técnicas
   Sincronizado com: io.js V52, shared/nerv/schemas.js (NERV Protocol 2.0)
========================================================================== */

const { v4: uuidv4 } = require('uuid');
const io = require('@infra/io');
const { log } = require('./logger');

// Importação do Shared Kernel (Validação Nativa)
const { validateRobotIdentity } = require('@shared/nerv/schemas');
const { ActorRole, PROTOCOL_VERSION } = require('@shared/nerv/constants');

class IdentityManager {
    constructor() {
        this.robotId = null; // DNA persistente (Identidade do Robô)
        this.instanceId = uuidv4(); // Vida efêmera (Identidade do Processo)

        // Capabilities V2.0: Feature Set Completo + Versioning
        this.capabilities = [
            // Core Driver Features
            'BROWSER_CONTROL_V3',              // Puppeteer + BrowserPool + ConnectionOrchestrator
            'MULTI_BROWSER_SUPPORT',           // Chrome + Chromium + Edge
            'FRAME_NAVIGATION_V2',             // Cross-origin iframe navigation

            // Perception & Interface Detection (SADI)
            'SADI_V19',                        // Sensory Analysis Deep Intelligence
            'ADAPTIVE_SELECTORS',              // Dynamic selector evolution
            'SHADOW_DOM_TRAVERSAL',            // Deep shadow root queries
            'SVG_SIGNATURE_MATCHING',          // Icon geometry recognition

            // Human Simulation & Anti-Detection
            'HUMAN_BIOMECHANICS_V2',           // Mouse jitter, typing errors, cognitive delays
            'GHOST_CURSOR',                    // Invisible cursor movement simulation
            'ADAPTIVE_TIMEOUTS_V2',            // Dynamic retry with exponential backoff

            // Task System & Processing
            'TASK_SCHEMA_V5',                  // Latest task structure (execution, mission, result V2)
            'RESPONSE_CAPTURE_V2',             // Multi-format response storage (txt, md, json, html)
            'AUTOMATIC_MIGRATION_V4_V5',       // Backward compatibility V4 ↔ V5
            'CONTEXT_RECURSION_V1',            // Recursive context accumulation

            // IPC & Communication
            'NERV_PROTOCOL_V2',                // Event-driven IPC backbone
            'WEBSOCKET_IPC',                   // Real-time dashboard communication
            'CIRCUIT_BREAKER_V1',              // Fault tolerance patterns

            // Mission System
            'MISSION_ORCHESTRATION',           // Multi-step workflow execution (em construção)
            'CHECKPOINT_RECOVERY',             // Resume from last successful step
            'LLM_AS_JUDGE',                    // AI-powered validation (planejado)

            // Safety & Validation
            'INPUT_SANITIZATION',              // Path traversal prevention
            'SCHEMA_VALIDATION_ZOD',           // Type-safe data structures
            'ATOMIC_WRITES',                   // Corruption-resistant file operations
            'DNA_EVOLUTION_TRACKING'           // Selector learning & versioning
        ];
    }

    /**
     * Inicializa a identidade soberana.
     * Tenta carregar o DNA existente ou realiza o "Nascimento" do robô.
     * Deve ser invocado no início da Main Sequence do index.js.
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
                    protocol: PROTOCOL_VERSION
                });

                log('WARN', `[IDENTITY] Novo DNA gerado (Nascimento): ${this.robotId}`);
            }
        } catch (err) {
            log('FATAL', `[IDENTITY] Falha crítica ao inicializar identidade: ${err.message}`);
            throw err;
        }
    }

    /**
     * Retorna o objeto de identidade completo e validado.
     * Esta é a ÚNICA saída autorizada para o Handshake do IPC 2.0.
     *
     * @returns {object} Identidade homologada conforme o Shared Kernel.
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
                started_at: new Date().toISOString()
            }
        };

        // [V510] Validação Nativa: Performance máxima para o barramento IPC
        return validateRobotIdentity(identity);
    }

    /**
     * Acessores controlados para uso interno do motor.
     */
    getRobotId() {
        return this.robotId;
    }

    getInstanceId() {
        return this.instanceId;
    }
}

// Singleton canônico: Garante que o robô não tenha "crise de identidade"
module.exports = new IdentityManager();
