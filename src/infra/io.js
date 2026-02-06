import { promises as fs } from 'node:fs';
import path from 'node:path';
import * as PATHS from './fs/paths.js';
import * as fsCore from './fs/fs_core.js';
import * as controlStore from './fs/control_store.js';
import * as taskStore from './storage/task_store.js';
import * as responseStore from './storage/response_store.js';
import * as dnaStore from './storage/dna_store.js';
import * as dnaEvolution from './storage/dna_evolution.js';
import * as lockManager from './locks/lock_manager.js';
import * as queueCache from './queue/cache.js';
import * as taskLoader from './queue/task_loader.js';
import * as queryEngine from './queue/query_engine.js';

export const ROOT = PATHS.ROOT;
export const QUEUE_DIR = PATHS.QUEUE;
export const RESPONSE_DIR = PATHS.RESPONSE;
export const sanitizeFilename = fsCore.sanitizeFilename;
export const atomicWrite = fsCore.atomicWrite;
export const safeReadJSON = fsCore.safeReadJSON;

export const cleanupOrphans = async function() {
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
        } catch (_) {
            /* Falha em diretório específico não interrompe a higiene */
        }
    }
    return totalCleaned;
};

export const saveTask = async function(task) {
    // ✅ DoS Prevention: Queue depth limit
    const MAX_QUEUE_DEPTH = 10000; // TODO: mover para config.json
    const currentQueue = await getQueue();

    if (currentQueue.length >= MAX_QUEUE_DEPTH) {
        throw new Error(
            `Queue depth limit reached (${MAX_QUEUE_DEPTH}). Clear queue or increase limit in config.json`
        );
    }

    queueCache.markDirty(); // Invalida primeiro (defensivo)
    const result = await taskStore.saveTask(task);
    return result;
};

export const deleteTask = async function(id) {
    queueCache.markDirty(); // Invalida primeiro (defensivo)
    await taskStore.deleteTask(id);
};

export const loadTask = async id => {
    // [P8.8] SECURITY: Validate not a symlink (prevent symlink attacks)
    const filePath = path.join(PATHS.QUEUE, `${id}.json`);
    try {
        const stats = await fs.lstat(filePath);
        if (stats.isSymbolicLink()) {
            throw new Error('SECURITY_SYMLINK_DENIED: Symbolic links not allowed in queue');
        }
    } catch (err) {
        if (err.message && err.message.includes('SECURITY_SYMLINK_DENIED')) {
            throw err;
        }
        // File doesn't exist or other error, let taskLoader handle it
    }

    return taskStore.loadTask(id);
};

export const clearQueue = taskStore.clearQueue;
export const loadResponse = responseStore.loadResponse;
export const deleteResponse = responseStore.deleteResponse;
export const findById = queryEngine.findById;
export const findLast = queryEngine.findLast;
export const findLastByTag = queryEngine.findLastByTag;
export const findFirstByTag = queryEngine.findFirstByTag;
export const getDna = dnaStore.getDna;
export const saveDna = dnaStore.saveDna;
export const getTargetRules = dnaStore.getTargetRules;
export const invalidateDnaCache = dnaStore.invalidateCache;
export const rollbackDna = dnaStore.rollbackDna;
export const getDnaHistory = dnaStore.getDnaHistory;
export const evolveWithSadiProtocol = dnaEvolution.evolveWithSadiProtocol;
export const evolveWithFullProtocol = dnaEvolution.evolveWithFullProtocol;
export const getEvolutionStats = dnaEvolution.getEvolutionStats;
export const getIdentity = async () => fsCore.safeReadJSON(PATHS.IDENTITY);
export const saveIdentity = async data => fsCore.atomicWrite(PATHS.IDENTITY, JSON.stringify(data, null, 2));
export const acquireLock = lockManager.acquireLock;
export const releaseLock = lockManager.releaseLock;
export const getQueue = queueCache.getQueue;
export const setCacheDirty = queueCache.markDirty;
export const loadNextTask = taskLoader.loadNextTask;
export const bulkRetryFailed = taskLoader.bulkRetryFailed;

export const loadAllTasks = async () => {
    const queue = await queueCache.getQueue();
    return queue.tasks || [];
};

export const checkControlPause = controlStore.checkControlPause;
