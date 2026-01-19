FILE_ORIGINAL: D:\chatgpt-docker-puppeteer\src\infra\io.js
PASTA_BASE: infra
DATA_DA_EXTRACAO: 2026-01-18 22:18:44
--------------------------------------------------------------------------------

/* ==========================================================================
   src/infra/io.js — UNIFIED FACADE (V730 — Singularity Edition)
   Audit Level: 730 — Hardened Unified I/O (Zero-Bug Tolerance)
   Status: CONSOLIDATED (Protocol 11)
   Responsabilidade: Ponto único de autoridade para todas as operações de I/O,
                     armazenamento, travas, inteligência de fila e higiene.
   Sincronizado com: paths.js V700, dna_store.js V730, task_store.js V700.
========================================================================== */

const fs = require('fs').promises;
const path = require('path');

// Subsistemas de Infraestrutura (Nível Baixo)
const PATHS = require('./fs/paths');
const fsCore = require('./fs/fs_core');
const controlStore = require('./fs/control_store');

// Subsistemas de Domínio (Nível de Aplicação)
const taskStore = require('./storage/task_store');
const responseStore = require('./storage/response_store');
const dnaStore = require('./storage/dna_store');
const lockManager = require('./locks/lock_manager');
const queueCache = require('./queue/cache');
const taskLoader = require('./queue/task_loader');
const queryEngine = require('./queue/query_engine');

module.exports = {
    /* ==========================================================================
       1. CAMADA FÍSICA E HIGIENE (SISTEMA OPERACIONAL)
    ========================================================================== */
    ROOT: PATHS.ROOT,
    QUEUE_DIR: PATHS.QUEUE,
    RESPONSE_DIR: PATHS.RESPONSE,
    sanitizeFilename: fsCore.sanitizeFilename,
    atomicWrite: fsCore.atomicWrite,
    safeReadJSON: fsCore.safeReadJSON,

    /**
     * Realiza a limpeza profunda de arquivos temporários órfãos (.tmp).
     * Varre simultaneamente os diretórios de Fila, Respostas e Storage.
     * @returns {Promise<number>} Total de arquivos removidos.
     */
    cleanupOrphans: async () => {
        let totalCleaned = 0;
        const targetDirs = [PATHS.QUEUE, PATHS.RESPONSE, path.dirname(PATHS.IDENTITY)];
        
        for (const dir of targetDirs) {
            try {
                const files = await fs.readdir(dir);
                const tmpFiles = files.filter(f => f.includes('.tmp'));
                
                for (const file of tmpFiles) {
                    await fs.unlink(path.join(dir, file)).catch(() => {});
                    totalCleaned++;
                }
            } catch (e) { /* Falha em diretório específico não interrompe a higiene */ }
        }
        return totalCleaned;
    },

    /* ==========================================================================
       2. GESTÃO DE TAREFAS (COM AUTO-INVALIDAÇÃO DE CACHE)
    ========================================================================== */
    
    /**
     * Salva uma tarefa e invalida o cache em RAM da fila imediatamente.
     */
    saveTask: async (task) => {
        const result = await taskStore.saveTask(task);
        queueCache.markDirty(); 
        return result;
    },

    /**
     * Remove uma tarefa e invalida o cache em RAM da fila.
     */
    deleteTask: async (id) => {
        await taskStore.deleteTask(id);
        queueCache.markDirty();
    },

    loadTask: taskStore.loadTask,
    clearQueue: taskStore.clearQueue, 

    /* ==========================================================================
       3. GESTÃO DE RESULTADOS (ARTEFATOS)
    ========================================================================== */
    loadResponse: responseStore.loadResponse,
    deleteResponse: responseStore.deleteResponse,

    /* ==========================================================================
       4. ENGINE DE CONSULTA (RAM - SNAPSHOT ESTÁVEL)
    ========================================================================== */
    findById: queryEngine.findById,
    findLast: queryEngine.findLast,
    findLastByTag: queryEngine.findLastByTag,
    findFirstByTag: queryEngine.findFirstByTag,

    /* ==========================================================================
       5. DNA, IDENTIDADE E LOCKS (SOBERANIA GENÔMICA)
    ========================================================================== */
    
    /**
     * Recupera o DNA completo (dynamic_rules.json).
     */
    getDna: dnaStore.getDna,

    /**
     * Persiste a evolução do DNA com metadados de autor.
     * Invalida o cache genômico interno automaticamente.
     */
    saveDna: dnaStore.saveDna,

    /**
     * [V730] Recupera as regras específicas para um domínio IA (ex: chatgpt.com).
     * Implementa fallback automático para seletores globais.
     */
    getTargetRules: dnaStore.getTargetRules,

    /**
     * [V730] Invalida o cache genômico em RAM.
     * Deve ser chamado quando o disco sofre alteração externa (Watcher).
     */
    invalidateDnaCache: dnaStore.invalidateCache,
    
    /**
     * Recupera a Identidade Soberana do robô de forma assíncrona.
     */
    getIdentity: async () => await fsCore.safeReadJSON(PATHS.IDENTITY),
    
    /**
     * Persiste a Identidade Soberana de forma atômica.
     */
    saveIdentity: async (data) => await fsCore.atomicWrite(
        PATHS.IDENTITY, 
        JSON.stringify(data, null, 2)
    ),

    acquireLock: lockManager.acquireLock,
    releaseLock: lockManager.releaseLock,

    /* ==========================================================================
       6. INTELIGÊNCIA DE FILA (ORQUESTRAÇÃO)
    ========================================================================== */
    getQueue: queueCache.getQueue,       
    setCacheDirty: queueCache.markDirty, 
    loadNextTask: taskLoader.loadNextTask,
    bulkRetryFailed: taskLoader.bulkRetryFailed,

    /* ==========================================================================
       7. CONTROLE OPERACIONAL (SINAIS GLOBAIS)
    ========================================================================== */
    checkControlPause: controlStore.checkControlPause
};