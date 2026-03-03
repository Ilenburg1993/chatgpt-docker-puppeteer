// @ts-check - Type checking rigoroso habilitado (arquivo core)
import os from 'node:os';
import v8 from 'node:v8';

/**
 * Estatísticas detalhadas de heap memory do V8.
 * @typedef {object} HeapStats
 * @property {number} heap_used_mb - Memória heap usada em MB.
 * @property {number} heap_total_mb - Memória heap total em MB.
 * @property {number} heap_limit_mb - Limite de heap em MB.
 * @property {number} heap_usage_percent - Percentual de uso do heap.
 * @property {number} total_heap_size_executable_mb - Tamanho executável do heap em MB.
 * @property {number} total_physical_size_mb - Tamanho físico total em MB.
 * @property {number} total_available_size_mb - Tamanho disponível em MB.
 * @property {number} used_heap_size_mb - Alias para heap_used_mb.
 * @property {number} malloced_memory_mb - Memória alocada em MB.
 * @property {number} peak_malloced_memory_mb - Pico de memória alocada em MB.
 * @property {boolean} does_zap_garbage - Se o garbage collector zera memória liberada.
 * @property {number} number_of_native_contexts - Número de contextos nativos.
 * @property {number} number_of_detached_contexts - Número de contextos destacados.
 */

/**
 * Retorna estatísticas detalhadas de heap memory.
 * P9.1: Adiciona visibilidade para prevenir OOM.
 * @returns {HeapStats} Estatísticas do heap V8.
 */
function getHeapStats() {
    const heapStats = v8.getHeapStatistics();

    const heap_used_mb = Math.round(heapStats.used_heap_size / 1024 / 1024);
    const heap_total_mb = Math.round(heapStats.total_heap_size / 1024 / 1024);
    const heap_limit_mb = Math.round(heapStats.heap_size_limit / 1024 / 1024);
    const heap_usage_percent = Math.round((heapStats.used_heap_size / heapStats.heap_size_limit) * 100);

    return {
        heap_used_mb,
        heap_total_mb,
        heap_limit_mb,
        heap_usage_percent,
        // Campos adicionais úteis para debugging
        total_heap_size_executable_mb: Math.round(heapStats.total_heap_size_executable / 1024 / 1024),
        total_physical_size_mb: Math.round(heapStats.total_physical_size / 1024 / 1024),
        total_available_size_mb: Math.round(heapStats.total_available_size / 1024 / 1024),
        used_heap_size_mb: heap_used_mb,
        malloced_memory_mb: Math.round(heapStats.malloced_memory / 1024 / 1024),
        peak_malloced_memory_mb: Math.round(heapStats.peak_malloced_memory / 1024 / 1024),
        does_zap_garbage: /** @type {boolean} */ (/** @type {unknown} */ (heapStats.does_zap_garbage)),
        number_of_native_contexts: heapStats.number_of_native_contexts,
        number_of_detached_contexts: heapStats.number_of_detached_contexts,
    };
}

/**
 * Estatísticas de CPU do sistema.
 * @typedef {object} CPUStats
 * @property {string} model - Modelo do processador.
 * @property {number} cores - Número de núcleos.
 * @property {number} usage_percent - Uso de CPU em percentual real (0..100).
 * @property {string} load_1min - Carga média de 1 minuto.
 * @property {string} load_5min - Carga média de 5 minutos.
 * @property {string} load_15min - Carga média de 15 minutos.
 */

/** @type {{ idle: number, total: number } | null} */
let previousCpuSnapshot = null;

function snapshotCpuTimes() {
    const cpus = os.cpus();
    let idle = 0;
    let total = 0;
    for (const cpu of cpus) {
        const times = cpu?.times;
        if (!times) continue;
        idle += Number(times.idle || 0);
        total +=
            Number(times.user || 0) +
            Number(times.nice || 0) +
            Number(times.sys || 0) +
            Number(times.idle || 0) +
            Number(times.irq || 0);
    }
    if (total <= 0) return null;
    return { idle, total };
}

function estimateCpuUsageFromLoadAvg() {
    const load1 = os.loadavg()[0] || 0;
    const cores = Math.max(1, os.cpus().length || 1);
    const normalized = (load1 / cores) * 100;
    return Math.max(0, Math.min(100, normalized));
}

function measureCpuUsagePercent() {
    const current = snapshotCpuTimes();
    if (!current) {
        return Number(estimateCpuUsageFromLoadAvg().toFixed(1));
    }
    if (!previousCpuSnapshot) {
        previousCpuSnapshot = current;
        return Number(estimateCpuUsageFromLoadAvg().toFixed(1));
    }

    const totalDelta = current.total - previousCpuSnapshot.total;
    const idleDelta = current.idle - previousCpuSnapshot.idle;
    previousCpuSnapshot = current;

    if (totalDelta <= 0) {
        return Number(estimateCpuUsageFromLoadAvg().toFixed(1));
    }

    const activeDelta = Math.max(0, totalDelta - Math.max(0, idleDelta));
    const usage = (activeDelta / totalDelta) * 100;
    return Number(Math.max(0, Math.min(100, usage)).toFixed(1));
}

/**
 * Retorna estatísticas de CPU.
 * @returns {CPUStats} Estatísticas de CPU do sistema.
 */
function getCPUStats() {
    const cpus = os.cpus();
    const loadAvg = os.loadavg();
    const usagePercent = measureCpuUsagePercent();

    return {
        model: cpus[0]?.model || 'unknown',
        cores: cpus.length,
        usage_percent: usagePercent,
        load_1min: loadAvg[0].toFixed(2),
        load_5min: loadAvg[1].toFixed(2),
        load_15min: loadAvg[2].toFixed(2),
    };
}

/**
 * Estatísticas de memória do sistema.
 * @typedef {object} MemoryStats
 * @property {number} total_mb - Memória total em MB.
 * @property {number} free_mb - Memória livre em MB.
 * @property {number} used_mb - Memória usada em MB.
 * @property {number} usage_percent - Percentual de uso da memória.
 */

/**
 * Retorna estatísticas de memória do sistema.
 * @returns {MemoryStats} Estatísticas de memória do sistema.
 */
function getMemoryStats() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    return {
        total_mb: Math.round(totalMem / 1024 / 1024),
        free_mb: Math.round(freeMem / 1024 / 1024),
        used_mb: Math.round(usedMem / 1024 / 1024),
        usage_percent: Math.round((usedMem / totalMem) * 100),
    };
}

/**
 * Informações gerais do sistema.
 * @typedef {object} SystemInfo
 * @property {string} platform - Plataforma do sistema operacional.
 * @property {string} arch - Arquitetura do processador.
 * @property {string} hostname - Nome do host.
 * @property {number} uptime_seconds - Tempo de atividade em segundos.
 * @property {string} node_version - Versão do Node.js.
 * @property {number} pid - ID do processo.
 */

/**
 * Retorna informações gerais do sistema.
 * @returns {SystemInfo} Informações do sistema e processo.
 */
function getSystemInfo() {
    return {
        platform: os.platform(),
        arch: os.arch(),
        hostname: os.hostname(),
        uptime_seconds: Math.round(os.uptime()),
        node_version: process.version,
        pid: process.pid,
    };
}

/**
 * Todas as métricas de hardware consolidadas.
 * @typedef {object} HardwareMetrics
 * @property {number} timestamp - Timestamp da coleta em ms.
 * @property {HeapStats} heap - Estatísticas do heap V8.
 * @property {MemoryStats} memory - Estatísticas de memória do sistema.
 * @property {CPUStats} cpu - Estatísticas de CPU.
 * @property {SystemInfo} system - Informações do sistema.
 */

/**
 * Retorna todas as métricas de hardware em um único objeto.
 * Útil para dashboards e health checks.
 * @returns {HardwareMetrics} Todas as métricas de hardware consolidadas.
 */
function getAllMetrics() {
    return {
        timestamp: Date.now(),
        heap: getHeapStats(),
        memory: getMemoryStats(),
        cpu: getCPUStats(),
        system: getSystemInfo(),
    };
}

export { getAllMetrics, getCPUStats, getHeapStats, getMemoryStats, getSystemInfo };
