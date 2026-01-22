/* ==========================================================================
   src/infra/queue/cache.js
   Audit Level: 700 — Sovereign Queue Observer (Singularity Edition)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade:
     - Autoridade central de OBSERVAÇÃO da fila de tarefas.
     - Produção de snapshot consistente do estado do disco em RAM.
     - Colapso de múltiplos gatilhos em uma única varredura (Debounce).
     - Heartbeat de segurança contra falhas de watchers físicos.

   Sincronizado com: paths.js V700, fs_watcher.js V600, io.js V700.
========================================================================== */

const fs = require('fs');
const path = require('path');
const pLimit = require('p-limit'); // P9.7: Concurrency control
const { log } = require('@core/logger');
const PATHS = require('../fs/paths');

// --- CONFIGURAÇÃO DE CADÊNCIA ---
const CACHE_HEARTBEAT_MS = 5000; // Varredura forçada a cada 5s
const OBSERVATION_WINDOW_MS = 300; // Janela de estabilização para eventos de disco
const WATCHER_DEBOUNCE_MS = 100; // Debounce para file watcher (P1.2)

// --- ESTADO VOLÁTIL DO CACHE ---
let globalQueueCache = [];
let isCacheDirty = true;
let lastFullScan = 0;
let currentScanPromise = null;
let windowTimer = null;
const watcherDebounceTimer = null; // Timer de debounce para watcher (P1.2)

// P9.6: Contadores de cache metrics
let cacheHits = 0;
let cacheMisses = 0;

/**
 * Lista arquivos de tarefa existentes no diretório físico.
 * @returns {string[]} Lista de caminhos absolutos para arquivos .json.
 */
function listTaskFiles() {
    try {
        return fs
            .readdirSync(PATHS.QUEUE)
            .filter(file => file.endsWith('.json'))
            .map(file => path.join(PATHS.QUEUE, file));
    } catch (err) {
        log('ERROR', `[CACHE] Falha ao listar diretório da fila: ${err.message}`);
        return [];
    }
}

/**
 * Carrega o conteúdo de uma tarefa individual.
 * @param {string} filePath - Caminho do arquivo.
 */
async function loadTask(filePath) {
    try {
        const raw = await fs.promises.readFile(filePath, 'utf-8');
        return JSON.parse(raw);
    } catch (_err) {
        // Falha silenciosa para arquivos em processo de escrita/deleção
        return null;
    }
}

/**
 * Executa uma varredura completa do disco e atualiza o snapshot em RAM.
 * Implementa o padrão Singleton para evitar concorrência de I/O.
 */
async function scanQueue() {
    if (currentScanPromise) {
        return currentScanPromise;
    }

    currentScanPromise = (async () => {
        try {
            const files = listTaskFiles();

            // P9.7: Limita a 10 reads simultâneos para prevenir I/O spikes
            const limit = pLimit(10);
            const results = await Promise.all(files.map(file => limit(() => loadTask(file))));

            // Filtra nulos (falhas de leitura) e atualiza o estado global
            globalQueueCache = results.filter(Boolean);
            lastFullScan = Date.now();
            isCacheDirty = false;

            log('DEBUG', `[CACHE] Snapshot da fila atualizado: ${globalQueueCache.length} tarefas (p-limit: 10).`);
            return globalQueueCache;
        } finally {
            currentScanPromise = null;
        }
    })();

    return currentScanPromise;
}

/**
 * Abre uma janela de observação para estabilizar gatilhos externos.
 * Sinais de sensores (Watchers) apenas marcam o cache como sujo e chamam esta função.
 */
function openObservationWindow() {
    if (windowTimer) {
        return;
    }

    windowTimer = setTimeout(async () => {
        windowTimer = null;
        if (isCacheDirty) {
            await scanQueue();
        }
    }, OBSERVATION_WINDOW_MS);
}

/**
 * API PÚBLICA: Retorna o snapshot atual da fila.
 * Implementa o Heartbeat de segurança para garantir consistência eventual.
 * P9.6: Adiciona tracking de cache hits/misses
 */
async function getQueue() {
    const now = Date.now();
    const needsHeartbeat = now - lastFullScan > CACHE_HEARTBEAT_MS;

    if (needsHeartbeat || isCacheDirty) {
        // P9.6: Cache miss - precisa fazer scan
        cacheMisses++;
        isCacheDirty = true;
        openObservationWindow();
    } else {
        // P9.6: Cache hit - retorna snapshot existente
        cacheHits++;
    }

    // Se houver uma varredura em curso, aguarda; senão retorna o último snapshot
    if (currentScanPromise) {
        return currentScanPromise;
    }

    return globalQueueCache;
}

/**
 * Sinalização Externa: Marca o cache como inconsistente.
 * Chamado exclusivamente por sensores (fs_watcher) ou comandos IPC.
 */
function markDirty() {
    isCacheDirty = true;
    openObservationWindow();
}

/**
 * P9.6: Retorna métricas de cache para observabilidade.
 * @returns {Object} Cache metrics
 */
function getCacheMetrics() {
    const total = cacheHits + cacheMisses;
    const hitRate = total > 0 ? ((cacheHits / total) * 100).toFixed(2) : 0;

    return {
        hits: cacheHits,
        misses: cacheMisses,
        total,
        hitRate: parseFloat(hitRate),
        queueSize: globalQueueCache.length,
        lastScan: lastFullScan,
        isDirty: isCacheDirty
    };
}

module.exports = {
    getQueue,
    markDirty,
    getCacheMetrics
};
