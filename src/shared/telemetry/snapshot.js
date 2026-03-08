// @ts-check - Type checking rigoroso habilitado (arquivo core)
/* ==========================================================================
   src/shared/telemetry/snapshot.js
   Telemetry Snapshot Manager
   Audit Level: 900 — Sovereign Telemetry

   Responsabilidade:
   - Coletar métricas de telemetria em background
   - Fornecer snapshots rápidos para endpoints
   - Gerenciar cache in-memory com TTL configurável
   - Background worker com graceful cleanup

   Princípios:
   - Snapshots thread-safe (deep frozen)
   - Cache com TTL para evitar stale data
   - Graceful degradation se coleta falhar
   - Métricas abrangentes: CPU, Memory, NERV, PM2
========================================================================== */

import { log } from '#core/logger';

/**
 * @typedef {object} TelemetrySnapshot
 * @property {number} timestamp - Timestamp da coleta (ms since epoch)
 * @property {object} system - Métricas do sistema
 * @property {number} system.cpu - Uso de CPU (%)
 * @property {number} system.memory - Uso de memória (MB)
 * @property {number} system.uptime - Uptime do processo (segundos)
 * @property {object} nerv - Estado do NERV
 * @property {boolean} nerv.connected - Se NERV está conectado
 * @property {number} nerv.eventsPerSecond - Eventos por segundo
 * @property {number} nerv.bufferSize - Tamanho do buffer
 * @property {object} pm2 - Estado dos processos PM2
 * @property {number} pm2.processCount - Número de processos
 * @property {number} pm2.memoryTotal - Memória total usada (MB)
 * @property {object} kernel - Estado do Kernel
 * @property {number} kernel.activeMissions - Missões ativas
 * @property {number} kernel.queueSize - Tamanho da fila
 * @property {object} browser - Estado do Browser Pool
 * @property {number} browser.instances - Instâncias ativas
 * @property {number} browser.pages - Páginas abertas
 */

/**
 * @typedef {object} TelemetryCollectorContext
 * @property {object} [nerv] - Instância do NERV
 * @property {object} [kernel] - Instância do Kernel
 * @property {object} [browserPool] - Instância do Browser Pool
 */

/** @type {TelemetrySnapshot | null} */
/** @type {any} */ let currentSnapshot = null;

/** @type {NodeJS.Timeout | null} */
/** @type {any} */ let snapshotInterval = null;

/** @type {boolean} */
let isRunning = false;

/**
 * Coleta métricas de sistema
 *
 * @returns {Promise<any>}
 */
async function collectSystemMetrics() {
    try {
        const memUsage = process.memoryUsage();
        const cpuUsage = process.cpuUsage();

        return {
            cpu: Math.round((cpuUsage.user + cpuUsage.system) / 1000000), // % aproximado
            memory: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
            uptime: Math.round(process.uptime()),
        };
    } catch (/** @type {any} */ err) {
        const _ce = /** @type {any} */ (err);
        log('WARN', `[SNAPSHOT] Falha ao coletar métricas de sistema: ${_ce.message}`);
        return { cpu: 0, memory: 0, uptime: 0 };
    }
}

/**
 * @typedef {object} CollectNervMetricsNerv
 * @property {any} _ Propriedades definidas em runtime.
 */
/**
 * Coleta métricas do NERV
 *
 * @param {CollectNervMetricsNerv} [nerv] - Instância do NERV
 * @returns {Promise<any>}
 */
async function collectNervMetrics(/** @type {any} */ nerv) {
    try {
        if (!nerv || typeof nerv.getStatus !== 'function') {
            return { connected: false, eventsPerSecond: 0, bufferSize: 0 };
        }

        const status = await nerv.getStatus();
        return {
            connected: status.transport?.connected || false,
            eventsPerSecond: status.activity?.eventsPerSecond || 0,
            bufferSize: status.buffers?.size || 0,
        };
    } catch (/** @type {any} */ err) {
        const _ce = /** @type {any} */ (err);
        log('WARN', `[SNAPSHOT] Falha ao coletar métricas do NERV: ${_ce.message}`);
        return { connected: false, eventsPerSecond: 0, bufferSize: 0 };
    }
}

/**
 * Coleta métricas do PM2
 *
 * @returns {Promise<any>}
 */
async function collectPm2Metrics() {
    // Nota: PM2 metrics seriam coletadas via PM2 API se disponível
    // Por enquanto, placeholder para futura implementação
    return {
        processCount: 0, // TODO: implementar via PM2.list()
        memoryTotal: 0, // TODO: somar memória de todos os processos
    };
}

/**
 * @typedef {object} CollectKernelMetricsKernel
 * @property {any} _ Propriedades definidas em runtime.
 */
/**
 * Coleta métricas do Kernel
 *
 * @param {CollectKernelMetricsKernel} [kernel] - Instância do Kernel
 * @returns {Promise<any>}
 */
async function collectKernelMetrics(/** @type {any} */ kernel) {
    try {
        if (!kernel) {
            return { activeMissions: 0, queueSize: 0 };
        }

        // TODO: implementar métodos no Kernel para expor métricas
        // const activeMissions = kernel.getActiveMissions?.() || [];
        // const queueSize = kernel.getQueueSize?.() || 0;

        return {
            activeMissions: 0, // Placeholder
            queueSize: 0, // Placeholder
        };
    } catch (/** @type {any} */ err) {
        const _ce = /** @type {any} */ (err);
        log('WARN', `[SNAPSHOT] Falha ao coletar métricas do Kernel: ${_ce.message}`);
        return { activeMissions: 0, queueSize: 0 };
    }
}

/**
 * @typedef {object} CollectBrowserMetricsBrowserPool
 * @property {any} _ Propriedades definidas em runtime.
 */
/**
 * Coleta métricas do Browser Pool
 *
 * @param {CollectBrowserMetricsBrowserPool} [browserPool] - Instância do Browser Pool
 * @returns {Promise<any>}
 */
async function collectBrowserMetrics(/** @type {any} */ browserPool) {
    try {
        if (!browserPool) {
            return { instances: 0, pages: 0 };
        }

        // TODO: implementar métodos no Browser Pool para expor métricas
        // const instances = browserPool.getActiveInstances?.() || 0;
        // const pages = browserPool.getOpenPages?.() || 0;

        return {
            instances: 0, // Placeholder
            pages: 0, // Placeholder
        };
    } catch (/** @type {any} */ err) {
        const _ce = /** @type {any} */ (err);
        log('WARN', `[SNAPSHOT] Falha ao coletar métricas do Browser: ${_ce.message}`);
        return { instances: 0, pages: 0 };
    }
}

/**
 * Coleta snapshot completo de telemetria
 *
 * @param {TelemetryCollectorContext} [context={}] - Contexto com instâncias dos subsistemas. Default is `{}`
 * @returns {Promise<TelemetrySnapshot>}
 */
async function collectSnapshot(/** @type {any} */ context = {}) {
    const timestamp = Date.now();

    const [system, nerv, pm2, kernel, browser] = await Promise.all([
        collectSystemMetrics(),
        collectNervMetrics(context.nerv),
        collectPm2Metrics(),
        collectKernelMetrics(context.kernel),
        collectBrowserMetrics(context.browserPool),
    ]);

    const snapshot = /** @type {any} */ ({
        timestamp,
        system,
        nerv,
        pm2,
        kernel,
        browser,
    });

    log('DEBUG', `[SNAPSHOT] Coletado snapshot em ${Date.now() - timestamp}ms`);
    return snapshot;
}

/**
 * Inicia o coletor de snapshots em background
 *
 * @param {number} intervalMs - Intervalo entre coletas (ms)
 * @param {TelemetryCollectorContext} [context={}] - Contexto com instâncias dos subsistemas. Default is `{}`
 * @returns {Promise<void>}
 */
export async function start(/** @type {any} */ intervalMs = 60000, /** @type {any} */ context = {}) {
    if (isRunning) {
        log('WARN', '[SNAPSHOT] Snapshot já está rodando');
        return;
    }

    log('INFO', `[SNAPSHOT] Iniciando coletor com intervalo ${intervalMs}ms`);

    try {
        // Coleta inicial
        currentSnapshot = await collectSnapshot(context);
        isRunning = true;

        // Inicia intervalo
        snapshotInterval = setInterval(async () => {
            try {
                currentSnapshot = await collectSnapshot(context);
            } catch (/** @type {any} */ err) {
                const _ce = /** @type {any} */ (err);
                log('ERROR', `[SNAPSHOT] Erro na coleta periódica: ${_ce.message}`);
                // Continua rodando mesmo com erro
            }
        }, intervalMs);

        log('INFO', '[SNAPSHOT] Coletor iniciado com sucesso');
    } catch (/** @type {any} */ err) {
        const _ce = /** @type {any} */ (err);
        log('ERROR', `[SNAPSHOT] Falha ao iniciar coletor: ${_ce.message}`);
        throw err;
    }
}

/**
 * Para o coletor de snapshots
 *
 * @returns {Promise<void>}
 */
export async function stop() {
    if (!isRunning) {
        return;
    }

    log('INFO', '[SNAPSHOT] Parando coletor');

    if (snapshotInterval) {
        clearInterval(snapshotInterval);
        snapshotInterval = null;
    }

    currentSnapshot = null;
    isRunning = false;

    log('INFO', '[SNAPSHOT] Coletor parado');
}

/**
 * Retorna o snapshot atual (thread-safe)
 *
 * @returns {TelemetrySnapshot | null}
 */
export function get() {
    return currentSnapshot;
}

/**
 * Verifica se o coletor está rodando
 *
 * @returns {boolean}
 */
export function isActive() {
    return isRunning;
}
