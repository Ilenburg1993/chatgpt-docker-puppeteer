// @ts-check
import * as doctor from '#core/doctor';
import { notify } from '#server/engine/socket';
import { log } from '#core/logger';

/**
 * Referência privada para o temporizador do ciclo de amostragem.
 * Mantida fora do export para garantir a soberania do Singleton.
 */
/** @type {any} */
let pulseInterval = null;

/**
 * Cadência de amostragem (5000ms).
 * Define a resolução temporal da telemetria de hardware no Dashboard.
 */
const PULSE_RATE_MS = 5000;

/**
 * Inicializa o ciclo de emissão de telemetria de hardware.
 * Garante que apenas um loop de pulso esteja ativo por processo.
  * @returns {void}
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
         * - cpu_usage_percent: Uso real de CPU em percentual (0..100)
         * - cpu_load_1min/5min/15min: load average bruto
         * - cpu_load: [LEGACY] alias para cpu_usage_percent
         * - ram_free: [LEGACY] Espaço livre em GB (para Dashboard atual)
         * - ram_usage_pct: [NEW] Percentual de uso (para Dashboard V2)
         */
        const payload = {
            cpu_usage_percent: Number(metrics.cpu_usage_percent ?? metrics.cpu_load ?? 0),
            cpu_load_1min: Number(metrics.cpu_load_1min ?? 0),
            cpu_load_5min: Number(metrics.cpu_load_5min ?? 0),
            cpu_load_15min: Number(metrics.cpu_load_15min ?? 0),
            cpu_cores: Number(metrics.cpu_cores ?? 1),
            cpu_load: Number(metrics.cpu_usage_percent ?? metrics.cpu_load ?? 0), // legado
            ram_free: metrics.ram_free_gb,
            ram_usage_pct: metrics.ram_usage_pct,
            ts: metrics.ts || Date.now(),
        };

        // Broadcast global para todos os terminais conectados (Dashboards)
        // O método notify do socket.js V600 garante a entrega atômica.
        notify('sys_metrics', payload);
    } catch (/** @type {any} */ e) {
        const _e = /** @type {any} */ (e);
        // Falhas na telemetria de hardware são não-críticas e não devem parar o servidor
        log('ERROR', `[TELEMETRY_HW] Erro no ciclo de amostragem: ${_e.message}`);
    }
}

/**
 * Interrompe o ciclo de monitoramento e limpa recursos de memória.
 * Chamado pelo orquestrador de ciclo de vida (lifecycle.js) no shutdown.
  * @returns {void}
 */
function stop() {
    if (pulseInterval) {
        clearInterval(pulseInterval);
        pulseInterval = null;
        log('INFO', '[TELEMETRY_HW] Monitoramento de hardware encerrado.');
    }
}

export { init, stop };
