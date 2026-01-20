/* ==========================================================================
   src/server/realtime/bus/pm2_bridge.js
   Audit Level: 700 — PM2 Event Bridge (Singularity Edition)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Capturar eventos de ciclo de vida do Agente no PM2 
                     e transmitir via barramento Socket.io para o Mission Control.
   Sincronizado com: system.js V45, engine/socket.js V600, main.js V700.
========================================================================== */

const { pm2Raw } = require('../../../infra/system');
const { notify } = require('../../engine/socket');
const { log } = require('../../../core/logger');

/**
 * Nome do processo alvo conforme definido no ecossistema PM2.
 */
const AGENTE_NAME = 'agente-gpt';

/**
 * Estado operacional da ponte.
 */
let isBusActive = false;
let healthCheckInterval = null;
let reconnectTimer = null;

/**
 * Inicializa a escuta do barramento de eventos do PM2.
 * Implementa lógica de auto-recuperação e reconexão resiliente.
 */
function init() {
    if (isBusActive) return;

    // Limpeza de timers de reconexão pendentes
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }

    log('INFO', '[PM2_BRIDGE] Conectando ao barramento de eventos do PM2...');

    // Conecta ao daemon do PM2 usando a interface bruta da Infraestrutura
    pm2Raw.connect((err) => {
        if (err) {
            log('ERROR', `[PM2_BRIDGE] Falha ao conectar ao daemon: ${err.message}`);
            // Tenta reconectar em 5 segundos (Backoff Passivo)
            reconnectTimer = setTimeout(init, 5000);
            return;
        }

        // Abre o barramento de mensagens (Bus) para escuta de eventos do SO
        pm2Raw.launchBus((busErr, bus) => {
            if (busErr) {
                log('ERROR', `[PM2_BRIDGE] Falha ao abrir barramento de dados: ${busErr.message}`);
                isBusActive = false;
                return;
            }

            isBusActive = true;
            log('INFO', '[PM2_BRIDGE] Escuta de eventos de processo ativa.');

            /**
             * Escuta eventos globais de todos os processos gerenciados pelo PM2.
             * Filtra cirurgicamente apenas os eventos do Agente Soberano.
             */
            bus.on('process:event', (data) => {
                const processName = data.process ? data.process.name : null;

                if (processName === AGENTE_NAME) {
                    const payload = {
                        event: data.event,      // 'start', 'stop', 'restart', 'exit', 'online'
                        status: data.process.status,
                        ts: Date.now()
                    };

                    log('DEBUG', `[PM2_BRIDGE] Evento de Processo: ${payload.event} (${payload.status})`);
                    
                    // Notifica o Dashboard através do Hub Central de Sockets
                    notify('status_update', payload);
                }
            });
        });
    });

    _startHealthCheck();
}

/**
 * Watchdog de Saúde do Link: Verifica a integridade da conexão com o PM2 a cada 30s.
 * Garante que a ponte se recupere caso o daemon do PM2 seja reiniciado.
 */
function _startHealthCheck() {
    if (healthCheckInterval) clearInterval(healthCheckInterval);

    healthCheckInterval = setInterval(() => {
        if (!isBusActive) return;

        pm2Raw.list((err) => {
            if (err) {
                log('WARN', '[PM2_BRIDGE] Link com daemon PM2 perdido. Reiniciando ponte...');
                isBusActive = false;
                init();
            }
        });
    }, 30000);
}

/**
 * Encerramento limpo do barramento.
 * Chamado pelo orquestrador de ciclo de vida (lifecycle.js) no shutdown.
 */
function stop() {
    if (healthCheckInterval) {
        clearInterval(healthCheckInterval);
        healthCheckInterval = null;
    }
    
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    
    isBusActive = false;
    log('INFO', '[PM2_BRIDGE] Ponte de eventos encerrada.');
}

module.exports = {
    init,
    stop
};