// @ts-check
import CONFIG from '#core/config';
import { log } from '#core/logger';
import { pm2Raw } from '#infra/system';
import { notify } from '#server/engine/socket';

/**
 * Processos sempre gerenciados (núcleo do ecosystem.config.cjs).
 */
const CORE_PROCESSES = ['agente-gpt', 'dashboard-web', 'chrome-proxy'];

/**
 * Processos opcionais — ativos quando ENABLE_AUDIT_AGENT_PM2_PROCESSES=true.
 */
const OPTIONAL_PROCESSES = ['inference-gateway', 'ollama-host-supervisor', 'audit-agent'];

/**
 * Conjunto completo de processos gerenciados (dinâmico). Inclui opcionais quando a variável de ambiente correspondente
 * está ativa.
 */
const MANAGED_PROCESSES = [
    ...CORE_PROCESSES,
    ...(String(process.env['ENABLE_AUDIT_AGENT_PM2_PROCESSES'] || '').toLowerCase() === 'true'
        ? OPTIONAL_PROCESSES
        : []),
];

/**
 * Estado operacional da ponte.
 */
let isBusActive = false;
/** @type {any} */
let healthCheckInterval = null;
/** @type {any} */
let reconnectTimer = null;
const lastProcessStates = new Map(); // Cache de estados

/**
 * Inicializa a escuta do barramento de eventos do PM2. Implementa lógica de auto-recuperação e reconexão resiliente.
 *
 * @returns {void}
 */
function init() {
    if (isBusActive) {
        return;
    }

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
            log('INFO', '[PM2_BRIDGE] Escuta de eventos PM2 ativa (todos os processos)');

            /**
             * Escuta eventos globais de TODOS os processos gerenciados pelo PM2. Monitora: agente-gpt, dashboard-web,
             * chrome-proxy
             */
            bus.on('process:event', (/** @type {any} */ data) => {
                const processName = data.process ? data.process.name : null;

                // Filtra apenas processos gerenciados
                if (MANAGED_PROCESSES.includes(processName)) {
                    const payload = {
                        name: processName,
                        event: data.event, // 'start', 'stop', 'restart', 'exit', 'online', 'error'
                        status: data.process.status,
                        pid: data.process.pid || null,
                        pm_id: data.process.pm_id || null,
                        restarts: data.process.restart_time || 0,
                        uptime: data.process.pm_uptime ? Date.now() - data.process.pm_uptime : 0,
                        memory: data.process.monit ? data.process.monit.memory : null,
                        cpu: data.process.monit ? data.process.monit.cpu : null,
                        ts: Date.now(),
                    };

                    log('DEBUG', `[PM2_BRIDGE] Evento: ${processName} → ${payload.event} (${payload.status})`);

                    // Atualiza cache local
                    lastProcessStates.set(processName, payload);

                    // Notifica o Dashboard através do Hub Central de Sockets
                    notify('pm2:process:event', payload);

                    // Notifica mudanças de status críticas
                    if (['exit', 'error', 'stop'].includes(data.event)) {
                        notify('pm2:process:critical', {
                            ...payload,
                            severity: 'critical',
                            message: `Processo ${processName} ${data.event}`,
                        });
                    }
                }
            });

            // Emite snapshot inicial de todos os processos
            _emitInitialSnapshot();
        });
    });

    _startHealthCheck();
}

/**
 * Emite snapshot inicial de todos os processos PM2. Chamado após conexão bem-sucedida ao barramento.
 */
function _emitInitialSnapshot() {
    pm2Raw.list((err, processes) => {
        if (err) {
            log('WARN', `[PM2_BRIDGE] Falha ao obter snapshot inicial: ${err.message}`);
            return;
        }

        const snapshot = processes
            .filter((/** @type {any} */ proc) => MANAGED_PROCESSES.includes(proc.name))
            .map((/** @type {any} */ proc) => ({
                name: proc.name,
                status: proc.pm2_env.status,
                pid: proc.pid,
                pm_id: proc.pm_id,
                restarts: proc.pm2_env.restart_time || 0,
                uptime: proc.pm2_env.pm_uptime ? Date.now() - proc.pm2_env.pm_uptime : 0,
                memory: proc.monit ? proc.monit.memory : null,
                cpu: proc.monit ? proc.monit.cpu : null,
                ts: Date.now(),
            }));

        log('INFO', `[PM2_BRIDGE] Snapshot inicial: ${snapshot.length} processos`);

        // Atualiza cache
        snapshot.forEach((proc) => lastProcessStates.set(proc.name, proc));

        // Notifica Dashboard
        notify('pm2:snapshot', {
            processes: snapshot,
            count: snapshot.length,
            ts: Date.now(),
        });
    });
}

/**
 * Watchdog de Saúde do Link: Verifica a integridade da conexão com o PM2 a cada 30s. Garante que a ponte se recupere
 * caso o daemon do PM2 seja reiniciado.
 *
 * ENHANCED: Também emite métricas periódicas de todos os processos.
 */
function _startHealthCheck() {
    if (healthCheckInterval) {
        clearInterval(healthCheckInterval);
    }

    const checkIntervalMs = Number(CONFIG.get('SERVER_PM2_HEALTH_CHECK_INTERVAL_MS', 30000)) || 30000;
    healthCheckInterval = setInterval(() => {
        if (!isBusActive) {
            return;
        }

        pm2Raw.list((err, processes) => {
            if (err) {
                log('WARN', '[PM2_BRIDGE] Link com daemon PM2 perdido. Reiniciando ponte...');
                isBusActive = false;
                init();
                return;
            }

            // Emite métricas atualizadas de todos os processos
            const metrics = processes
                .filter((/** @type {any} */ proc) => MANAGED_PROCESSES.includes(proc.name))
                .map((/** @type {any} */ proc) => ({
                    name: proc.name,
                    status: proc.pm2_env.status,
                    pid: proc.pid,
                    pm_id: proc.pm_id,
                    restarts: proc.pm2_env.restart_time || 0,
                    uptime: proc.pm2_env.pm_uptime ? Date.now() - proc.pm2_env.pm_uptime : 0,
                    memory: proc.monit ? proc.monit.memory : null,
                    cpu: proc.monit ? proc.monit.cpu : null,
                    ts: Date.now(),
                }));

            // Atualiza cache
            metrics.forEach((proc) => lastProcessStates.set(proc.name, proc));

            // Notifica Dashboard (throttled - apenas mudanças significativas)
            notify('pm2:metrics', {
                processes: metrics,
                count: metrics.length,
                ts: Date.now(),
            });

            log('DEBUG', `[PM2_BRIDGE] Health check OK: ${metrics.length} processos ativos`);
        });
    }, checkIntervalMs);
}

/**
 * Encerramento limpo do barramento. Chamado pelo orquestrador de ciclo de vida (lifecycle.js) no shutdown.
 *
 * @returns {void}
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

    lastProcessStates.clear();
    isBusActive = false;
    try {
        pm2Raw.disconnect();
    } catch (/** @type {any} */ disconnectErr) {
        const _e = /** @type {any} */ (disconnectErr);
        log(
            'DEBUG',
            `[PM2_BRIDGE] Disconnect error during stop: ${disconnectErr && _e.message ? _e.message : String(_e)}`,
        );
    }
    log('INFO', '[PM2_BRIDGE] Ponte de eventos encerrada.');
}

/**
 * Retorna estado atual de todos os processos (cache). Útil para health checks e diagnósticos.
 *
 * @returns {Map<string, object>} Mapa de estados (chave: nome do processo)
 */
function getProcessStates() {
    return new Map(lastProcessStates);
}

/**
 * Força refresh de snapshot de todos os processos. Chamado por health endpoints ou triggers externos.
 *
 * @returns {Promise<object[]>} Array de estados de processos
 */
async function refreshSnapshot() {
    return new Promise((resolve, reject) => {
        pm2Raw.list((err, processes) => {
            if (err) {
                reject(err);
                return;
            }

            const snapshot = processes
                .filter((/** @type {any} */ proc) => MANAGED_PROCESSES.includes(proc.name))
                .map((/** @type {any} */ proc) => ({
                    name: proc.name,
                    status: proc.pm2_env.status,
                    pid: proc.pid,
                    pm_id: proc.pm_id,
                    restarts: proc.pm2_env.restart_time || 0,
                    uptime: proc.pm2_env.pm_uptime ? Date.now() - proc.pm2_env.pm_uptime : 0,
                    memory: proc.monit ? proc.monit.memory : null,
                    cpu: proc.monit ? proc.monit.cpu : null,
                    ts: Date.now(),
                }));

            // Atualiza cache
            snapshot.forEach((proc) => lastProcessStates.set(proc.name, proc));

            resolve(snapshot);
        });
    });
}

export { CORE_PROCESSES, getProcessStates, init, MANAGED_PROCESSES, OPTIONAL_PROCESSES, refreshSnapshot, stop };
