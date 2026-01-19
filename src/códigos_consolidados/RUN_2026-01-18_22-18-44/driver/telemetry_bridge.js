FILE_ORIGINAL: D:\chatgpt-docker-puppeteer\src\driver\modules\telemetry_bridge.js
PASTA_BASE: driver
DATA_DA_EXTRACAO: 2026-01-18 22:18:44
--------------------------------------------------------------------------------

/* ==========================================================================
   src/driver/modules/telemetry_bridge.js
   Audit Level: 500 — Active Sensory Bridge (IPC 2.0 Singularity)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Escutar sinais vitais do Driver e traduzi-los para o IPC 2.0.
                     Implementa Throttling biomecânico e de progresso para 
                     otimização de tráfego e estabilidade da malha.
   Sincronizado com: BaseDriver V320, ipc_client V570, constants.js V400.
========================================================================== */

const ipc = require('../../infra/ipc_client');
const { IPCEvent } = require('../../shared/ipc/constants');
const { log } = require('../../core/logger');

class TelemetryBridge {
    /**
     * Inicializa os estados de controle de fluxo (Throttling).
     */
    constructor() {
        this.lastProgressReport = 0;
        this.lastMousePulse = 0;
        
        // Configurações de cadência (Audit Level 500 Standard)
        this.PROGRESS_THROTTLE_MS = 1000; // 1 segundo entre atualizações de progresso
        this.MOUSE_THROTTLE_MS = 150;    // 150ms para suavidade visual sem overhead
    }

    /**
     * Acopla a ponte sensorial a uma instância de Driver.
     * Implementa o padrão Observer para manter o Driver agnóstico à rede.
     * 
     * @param {object} driver - Instância de TargetDriver/BaseDriver.
     */
    attach(driver) {
        if (!driver || typeof driver.on !== 'function') {
            log('ERROR', '[BRIDGE] Falha ao acoplar: Driver inválido ou sem barramento de eventos.');
            return;
        }

        log('DEBUG', `[BRIDGE] Acoplando observador sensorial ao driver: ${driver.name}`);

        // Escuta o canal unificado de sinais vitais definido no BaseDriver V320
        driver.on('driver:vital', (signal) => {
            this._handleVitalSignal(signal);
        });
    }

    /**
     * Despachante interno de sinais.
     * Realiza o roteamento do sinal vital para o evento IPC correspondente.
     * 
     * @param {object} signal - Objeto contendo { type, payload, correlationId, ts }.
     */
    _handleVitalSignal(signal) {
        const { type, payload, correlationId } = signal;

        // Garantia de rastro: se o sinal não trouxer ID, usamos um placeholder de sistema
        const traceId = correlationId || 'sys-sensory-pulse';

        switch (type) {
            case 'SADI_PERCEPTION':
                // Percepção visual imediata (sem throttling)
                ipc.emitEvent(IPCEvent.SADI_SNAPSHOT, payload, traceId);
                break;

            case 'HUMAN_PULSE':
                // Movimentação física e digitação (com throttling biomecânico)
                this._handleHumanPulse(payload, traceId);
                break;

            case 'TRIAGE_ALERT':
                // Diagnósticos de Stall e erros de interface (imediato)
                ipc.emitEvent(IPCEvent.STALL_DETECTED, payload, traceId);
                break;

            case 'PROGRESS_UPDATE':
                // Atualizações de percentual e etapas (com throttling de progresso)
                this._handleProgress(payload, traceId);
                break;

            default:
                log('WARN', `[BRIDGE] Sinal vital ignorado por falta de mapeamento: ${type}`);
        }
    }

    /* ==========================================================================
       MOTORES DE FILTRAGEM (THROTTLING & TRAFFIC SHAPING)
    ========================================================================== */

    /**
     * Gerencia o pulso biomecânico (mouse/teclado).
     */
    _handleHumanPulse(payload, correlationId) {
        if (payload.type === 'MOUSE_MOVE') {
            const now = Date.now();
            // Bloqueia se o intervalo for menor que o limite de amostragem
            if (now - this.lastMousePulse < this.MOUSE_THROTTLE_MS) return;
            this.lastMousePulse = now;
        }
        
        // Encaminha para o IPC Client (que gerenciará o buffer se estiver offline)
        ipc.emitEvent(IPCEvent.HUMAN_PULSE, payload, correlationId);
    }

    /**
     * Gerencia o progresso da tarefa.
     */
    _handleProgress(payload, correlationId) {
        const now = Date.now();
        // Evita spam de mudanças de percentual na interface
        if (now - this.lastProgressReport < this.PROGRESS_THROTTLE_MS) return;
        this.lastProgressReport = now;

        ipc.emitEvent(IPCEvent.TASK_PROGRESS, payload, correlationId);
    }
}

/**
 * Exporta como Singleton.
 * O DriverLifecycleManager deve usar esta instância única para monitorar 
 * o driver ativo em cada ciclo de tarefa.
 */
module.exports = new TelemetryBridge();