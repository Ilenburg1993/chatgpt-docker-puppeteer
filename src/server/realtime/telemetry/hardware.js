/* ==========================================================================
   src/server/realtime/telemetry/hardware.js
   Audit Level: 700 — Infrastructure Pulse Emitter (Singularity Edition)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Coletar métricas de hardware do motor de diagnóstico e 
                     transmitir via barramento Socket.io em tempo real.
   Sincronizado com: doctor.js V39, engine/socket.js V600, main.js V700.
========================================================================== */

const doctor = require('../../../core/doctor');
const { notify } = require('../../engine/socket');
const { log } = require('../../../core/logger');

/**
 * Referência privada para o temporizador do ciclo de amostragem.
 * Mantida fora do export para garantir a soberania do Singleton.
 */
let pulseInterval = null;

/**
 * Cadência de amostragem (5000ms).
 * Define a resolução temporal da telemetria de hardware no Dashboard.
 */
const PULSE_RATE_MS = 5000;

/**
 * Inicializa o ciclo de emissão de telemetria de hardware.
 * Garante que apenas um loop de pulso esteja ativo por processo.
 */
function init() {
    if (pulseInterval) {
        log('WARN', '[TELEMETRY_HW] Tentativa de inicialização duplicada bloqueada.');
        return;
    }

    log('INFO', '[TELEMETRY_HW] Ativando pulso de monitoramento de hardware.');

    // Ignition Burst: Envia o primeiro conjunto de dados sem aguardar o intervalo
    _pushMetrics();

    // Configuração do loop contínuo de telemetria
    pulseInterval = setInterval(() => {
        _pushMetrics();
    }, PULSE_RATE_MS);
}

/**
 * Coleta dados do motor de diagnóstico e realiza o broadcast via Hub de Eventos.
 * Implementa a ponte de compatibilidade para o Dashboard V1 e V2.
 */
function _pushMetrics() {
    try {
        /**
         * O doctor.js atua como a autoridade de leitura física.
         * Se o motor de diagnóstico falhar, o sistema registra e aguarda o próximo ciclo.
         */
        if (typeof doctor.getHardwareMetrics !== 'function') {
            throw new Error('Interface de telemetria do Doctor indisponível.');
        }

        const metrics = doctor.getHardwareMetrics();

        /**
         * PAYLOAD DE TRANSMISSÃO (IPC 2.0 Standard)
         * - cpu_load: Carga média (0.00 a N.NN)
         * - ram_free: [LEGACY] Espaço livre em GB (para Dashboard atual)
         * - ram_usage_pct: [NEW] Percentual de uso (para Dashboard V2)
         */
        const payload = {
            cpu_load: metrics.cpu_load,
            ram_free: metrics.ram_free_gb,      
            ram_usage_pct: metrics.ram_usage_pct, 
            ts: metrics.ts || Date.now()
        };

        // Broadcast global para todos os terminais conectados (Dashboards)
        // O método notify do socket.js V600 garante a entrega atômica.
        notify('sys_metrics', payload);

    } catch (e) {
        // Falhas na telemetria de hardware são não-críticas e não devem parar o servidor
        log('ERROR', `[TELEMETRY_HW] Erro no ciclo de amostragem: ${e.message}`);
    }
}

/**
 * Interrompe o ciclo de monitoramento e limpa recursos de memória.
 * Chamado pelo orquestrador de ciclo de vida (lifecycle.js) no shutdown.
 */
function stop() {
    if (pulseInterval) {
        clearInterval(pulseInterval);
        pulseInterval = null;
        log('INFO', '[TELEMETRY_HW] Monitoramento de hardware encerrado.');
    }
}

module.exports = {
    init,
    stop
};