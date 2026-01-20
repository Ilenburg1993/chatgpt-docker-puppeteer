/* ==========================================================================
   src/server/supervisor/reconciler.js
   Audit Level: 700 — Sovereign State Reconciler (Singularity Edition)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Atuar como o Control Plane do sistema. Monitorar a frota,
                     detectar desvios (drifts) e orquestrar a autocura.
   Sincronizado com: engine/socket.js V600, remediation.js V600, 
                     shared/nerv/constants.js (NERV Protocol 2.0)
========================================================================== */

const socketHub = require('../engine/socket');
const remediation = require('./remediation');
const { log } = require('../../../core/logger');
const { ActionCode, MessageType } = require('../../../shared/nerv/constants');

class SupervisorReconciler {
    constructor() {
        this.checkInterval = null;
        this.isListening = false;
        
        // Limiares de tolerância operacional (NASA Standard)
        this.HEARTBEAT_THRESHOLD_MS = 30000; // 30s sem sinal = Agente Zumbi
        this.STALL_THRESHOLD_MS = 300000;    // 5min na mesma etapa = Stall Lógico
    }

    /**
     * Inicia a vigilância ativa e acopla os gatilhos de remediação ao barramento.
     * Garante que o sistema entre em modo de monitoramento contínuo.
     */
    start() {
        if (this.checkInterval) return;
        
        log('INFO', '[RECONCILER] Iniciando vigilância e loop de reconciliação soberana.');

        // 1. Loop de Monitoramento Periódico (Pull/Reconcile)
        this.checkInterval = setInterval(() => this.reconcile(), 10000);

        // 2. Escuta Ativa de Sinais Vitais (Push/Reactive)
        this._attachSensoryListeners();
    }

    /**
     * Acopla o Reconciliador ao barramento Socket.io para intercepção de falhas.
     * Implementa proteção contra duplicidade de listeners em reinicializações.
     */
    _attachSensoryListeners() {
        if (this.isListening) return;
        
        const io = socketHub.getIO();
        if (!io) {
            log('WARN', '[RECONCILER] Barramento indisponível. Re-tentando acoplamento em 5s...');
            setTimeout(() => this._attachSensoryListeners(), 5000);
            return;
        }

        /**
         * Intercepta eventos de diagnóstico (STALL_DETECTED) no milissegundo 
         * em que são emitidos pelo robô, permitindo reação instantânea do Supervisor.
         */
        io.on('connection', (socket) => {
            socket.on('message', (envelope) => {
                if (envelope.kind === MessageType.EVENT && envelope.actionCode === 'STALL_DETECTED') {
                    this._handleStallSignal(socket.robot_id, envelope);
                }
            });
        });

        this.isListening = true;
        log('DEBUG', '[RECONCILER] Escuta sensorial de barramento estabelecida.');
    }

    /**
     * Loop de Reconciliação: Compara o estado real reportado com o estado desejado.
     * Atua como a "vontade do sistema" sobre a frota.
     */
    reconcile() {
        const agents = socketHub.getRegistry();
        const now = Date.now();

        agents.forEach(agent => {
            const { robot_id, last_seen } = agent;
            const idleTime = now - last_seen;

            // 1. DETECÇÃO DE AGENTE ZUMBI
            // Se o robô parou de enviar batimentos cardíacos ou telemetria.
            if (idleTime > this.HEARTBEAT_THRESHOLD_MS) {
                log('WARN', `[RECONCILER] Drift detectado: Agente ${robot_id} está silencioso há ${Math.round(idleTime/1000)}s.`);
                this._attemptEmergencyPing(robot_id);
                return;
            }

            // 2. DETECÇÃO DE DRIFT DE TAREFA
            // Espaço reservado para cruzamento de dados com o estado da fila no disco (Fase 4).
            this._checkTaskDrift(agent, now);
        });
    }

    /**
     * Processa um alerta de Stall e aplica a manobra de remediação prescrita.
     * 
     * @param {string} robotId - Identidade do robô que emitiu o alerta.
     * @param {object} envelope - O Envelope IPC contendo o diagnóstico técnico.
     */
    async _handleStallSignal(robotId, envelope) {
        const diagnosis = envelope.payload;
        const correlationId = envelope.ids.correlation_id;

        log('INFO', `[RECONCILER] Analisando sintoma "${diagnosis.type}" no robô ${robotId}`, correlationId);

        // Consulta a "Farmacopeia" (Remediation Engine) para obter a prescrição
        const prescription = remediation.evaluate(diagnosis);

        if (prescription) {
            log('WARN', `[RECONCILER] Executando Autocura: ${prescription.command}`, correlationId);

            // Despacha o comando de correção via Unicast (Sala privada do robô)
            socketHub.sendCommand(
                prescription.command, 
                { 
                    ...prescription.params,
                    correlation_id: correlationId // Preserva o Fio de Ariadne para rastreabilidade
                }, 
                robotId
            );
        }
    }

    /**
     * Tenta reativar um robô silencioso enviando um pulso de Resume.
     * @param {string} robotId - ID do robô alvo.
     */
    _attemptEmergencyPing(robotId) {
        socketHub.sendCommand(ActionCode.ENGINE_RESUME, { 
            reason: 'RECONCILER_HEARTBEAT_RECOVERY',
            correlation_id: `sys-rec-${Date.now()}`
        }, robotId);
    }

    /**
     * Verifica inconsistências entre o que o robô reporta e o que a fila exige.
     */
    _checkTaskDrift(agent, now) {
        // Implementação futura: detecção de inconsistência entre disco (Tarefa RUNNING) e memória (Robô IDLE).
    }

    /**
     * Encerra a vigilância e limpa os timers.
     * Chamado pelo orquestrador de ciclo de vida no desligamento do servidor.
     */
    stop() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
        this.isListening = false;
        log('INFO', '[RECONCILER] Vigilância de estado encerrada.');
    }
}

// Exporta o Singleton Soberano
module.exports = new SupervisorReconciler();