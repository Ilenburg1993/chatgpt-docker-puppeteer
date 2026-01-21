/* ==========================================================================
   src/core/hardware.js
   Audit Level: 100 — Hardware Monitoring & System Metrics
   Status: NEW (P9.1 Performance Optimization)

   Responsabilidade:
   - Expor métricas de hardware (heap, CPU, memory)
   - Integração com v8.getHeapStatistics()
   - Fornecer dados para health checks e observabilidade
========================================================================== */

const v8 = require('v8');
const os = require('os');

/**
 * Retorna estatísticas detalhadas de heap memory.
 * P9.1: Adiciona visibilidade para prevenir OOM.
 *
 * @returns {Object} Heap statistics
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
        does_zap_garbage: heapStats.does_zap_garbage,
        number_of_native_contexts: heapStats.number_of_native_contexts,
        number_of_detached_contexts: heapStats.number_of_detached_contexts
    };
}

/**
 * Retorna estatísticas de CPU.
 *
 * @returns {Object} CPU statistics
 */
function getCPUStats() {
    const cpus = os.cpus();
    const loadAvg = os.loadavg();

    return {
        model: cpus[0]?.model || 'unknown',
        cores: cpus.length,
        load_1min: loadAvg[0].toFixed(2),
        load_5min: loadAvg[1].toFixed(2),
        load_15min: loadAvg[2].toFixed(2)
    };
}

/**
 * Retorna estatísticas de memória do sistema.
 *
 * @returns {Object} Memory statistics
 */
function getMemoryStats() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    return {
        total_mb: Math.round(totalMem / 1024 / 1024),
        free_mb: Math.round(freeMem / 1024 / 1024),
        used_mb: Math.round(usedMem / 1024 / 1024),
        usage_percent: Math.round((usedMem / totalMem) * 100)
    };
}

/**
 * Retorna informações gerais do sistema.
 *
 * @returns {Object} System info
 */
function getSystemInfo() {
    return {
        platform: os.platform(),
        arch: os.arch(),
        hostname: os.hostname(),
        uptime_seconds: Math.round(os.uptime()),
        node_version: process.version,
        pid: process.pid
    };
}

/**
 * Retorna todas as métricas de hardware em um único objeto.
 * Útil para dashboards e health checks.
 *
 * @returns {Object} All hardware metrics
 */
function getAllMetrics() {
    return {
        timestamp: Date.now(),
        heap: getHeapStats(),
        memory: getMemoryStats(),
        cpu: getCPUStats(),
        system: getSystemInfo()
    };
}

module.exports = {
    getHeapStats,
    getCPUStats,
    getMemoryStats,
    getSystemInfo,
    getAllMetrics
};
