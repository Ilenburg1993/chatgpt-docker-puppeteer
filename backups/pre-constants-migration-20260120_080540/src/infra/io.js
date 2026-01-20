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

/**
 * @module io
 * @description Facade unificada para operações de I/O, armazenamento e gerenciamento de fila.
 * Consolidação de todos os subsistemas de infraestrutura em uma interface única.
 *
 * @property {string} ROOT - Diretório raiz do projeto
 * @property {string} QUEUE_DIR - Diretório da fila de tarefas
 * @property {string} RESPONSE_DIR - Diretório de respostas
 *
 * @example
 * const io = require('./infra/io');
 * const task = await io.loadTask('task-123');
 * await io.saveResponse('task-123', 'Response text');
 */
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

    async cleanupOrphans() {
        let totalCleaned = 0;
        const targetDirs = [PATHS.QUEUE, PATHS.RESPONSE, path.dirname(PATHS.IDENTITY)];

        for (const dir of targetDirs) {
            try {
                // eslint-disable-next-line no-await-in-loop
                const files = await fs.readdir(dir);
                const tmpFiles = files.filter(f => f.includes('.tmp'));

                for (const file of tmpFiles) {
                    // eslint-disable-next-line no-await-in-loop
                    await fs.unlink(path.join(dir, file)).catch(() => {});
                    totalCleaned++;
                }
            } catch (_e) {
                /* Falha em diretório específico não interrompe a higiene */
            }
        }
        return totalCleaned;
    },

    /* ==========================================================================
       2. GESTÃO DE TAREFAS (COM AUTO-INVALIDAÇÃO DE CACHE)
    ========================================================================== */

    /**
     * Salva uma tarefa e invalida o cache em RAM da fila imediatamente.
     * [P5.2 FIX] Invalida ANTES do write para garantir consistency mesmo em crash.
     */
    async saveTask(task) {
        queueCache.markDirty(); // Invalida primeiro (defensivo)
        const result = await taskStore.saveTask(task);
        return result;
    },

    /**
     * Remove uma tarefa e invalida o cache em RAM da fila.
     * [P5.2 FIX] Invalida ANTES do delete para garantir consistency.
     */
    async deleteTask(id) {
        queueCache.markDirty(); // Invalida primeiro (defensivo)
        await taskStore.deleteTask(id);
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
    getIdentity: async () => fsCore.safeReadJSON(PATHS.IDENTITY),

    /**
     * Persiste a Identidade Soberana de forma atômica.
     */
    saveIdentity: async data => fsCore.atomicWrite(PATHS.IDENTITY, JSON.stringify(data, null, 2)),

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
