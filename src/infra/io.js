// @ts-check
import { promises as fs } from 'node:fs';
import path from 'node:path';
import * as controlStore from './fs/control_store.js';
import * as fsCore from './fs/fs_core.js';
import * as PATHS from './fs/paths.js';
import * as lockManager from './locks/lock_manager.js';
import * as queueCache from './queue/cache.js';
import * as queryEngine from './queue/query_engine.js';
import * as taskLoader from './queue/task_loader.js';
import * as dnaEvolution from './storage/dna_evolution.js';
import * as dnaStore from './storage/dna_store.js';
import * as responseStore from './storage/response_store.js';
import * as taskStore from './storage/task_store.js';

/**
 * Diretório raiz do projeto.
 * @type {string}
 */
export const ROOT = PATHS.ROOT;

/**
 * Diretório da fila de tarefas.
 * @type {string}
 */
export const QUEUE_DIR = PATHS.QUEUE;

/**
 * Diretório de respostas.
 * @type {string}
 */
export const RESPONSE_DIR = PATHS.RESPONSE;

/**
 * Sanitiza nome de arquivo para uso seguro.
 * @type {function(string): string}
 */
export const sanitizeFilename = fsCore.sanitizeFilename;

/**
 * Escreve arquivo de forma atômica.
 * @type {function(string, string|Buffer|Uint8Array, BufferEncoding?): Promise<boolean>}
 */
export const atomicWrite = fsCore.atomicWrite;

/**
 * Lê JSON de forma segura com fallbacks.
 * @type {function(string, *): Promise<unknown>}
 */
export const safeReadJSON = fsCore.safeReadJSON;

/**
 * Limpa arquivos temporários órfãos (.tmp) dos diretórios críticos do sistema.
 *
 * **Side-effects:** Remove arquivos do sistema de arquivos.
 * **Idempotente:** Pode ser chamado múltiplas vezes sem efeitos colaterais.
 *
 * @returns {Promise<number>} Número total de arquivos removidos
 */
export const cleanupOrphans = async function () {
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

/**
 * Salva uma tarefa na fila com validação de profundidade máxima.
 *
 * **Side-effects:** Persiste dados no sistema de arquivos, invalida cache da fila.
 * **Semântica:** Protege contra ataques DoS limitando profundidade da fila.
 *
 * @param {object} task - Objeto da tarefa a ser salva
 * @returns {Promise<object>} Resultado da operação de salvamento
 * @throws {Error} Quando o limite de profundidade da fila é atingido
 */
export const saveTask = async function (task) {
    // ✅ DoS Prevention: Queue depth limit - configurable via environment variable
    const MAX_QUEUE_DEPTH = parseInt(process.env.MAX_QUEUE_DEPTH, 10) || 10000;
    const currentQueue = await getQueue();

    if (currentQueue.length >= MAX_QUEUE_DEPTH) {
        throw new Error(
            `Queue depth limit reached (${MAX_QUEUE_DEPTH}). Clear queue or increase limit via MAX_QUEUE_DEPTH env var`
        );
    }

    queueCache.markDirty(); // Invalida primeiro (defensivo)
    const result = await taskStore.saveTask(task);
    return result;
};

/**
 * Remove uma tarefa da fila pelo ID.
 *
 * **Side-effects:** Remove arquivo do sistema de arquivos, invalida cache da fila.
 *
 * @param {string} id - ID da tarefa a ser removida
 * @returns {Promise<void>}
 */
export const deleteTask = async function (id) {
    queueCache.markDirty(); // Invalida primeiro (defensivo)
    await taskStore.deleteTask(id);
};

/**
 * Carrega uma tarefa da fila com validação de segurança contra symlinks.
 *
 * **Side-effects:** Lê do sistema de arquivos.
 * **Semântica:** Previne ataques de symlink no diretório da fila.
 *
 * @param {string} id - ID da tarefa a ser carregada
 * @returns {Promise<object|null>} Tarefa carregada ou null se não encontrada
 * @throws {Error} Quando detecta tentativa de ataque via symlink
 */
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

/**
 * Limpa toda a fila de tarefas.
 * @type {function(): Promise<void>}
 */
export const clearQueue = taskStore.clearQueue;

/**
 * Carrega resposta por ID.
 * @type {function(string): Promise<object>}
 */
export const loadResponse = responseStore.loadResponse;

/**
 * Remove resposta por ID.
 * @type {function(string): Promise<void>}
 */
export const deleteResponse = responseStore.deleteResponse;

/**
 * Busca tarefa por ID.
 * @type {function(string): Promise<object>}
 */
export const findById = queryEngine.findById;

/**
 * Busca última tarefa.
 * @type {function(): Promise<object>}
 */
export const findLast = queryEngine.findLast;

/**
 * Busca última tarefa por tag.
 * @type {function(string): Promise<object>}
 */
export const findLastByTag = queryEngine.findLastByTag;

/**
 * Busca primeira tarefa por tag.
 * @type {function(string): Promise<object>}
 */
export const findFirstByTag = queryEngine.findFirstByTag;

/**
 * Obtém DNA atual.
 * @type {function(): Promise<object>}
 */
export const getDna = dnaStore.getDna;

/**
 * Salva DNA.
 * @type {function(object, string?): Promise<boolean>}
 */
export const saveDna = dnaStore.saveDna;

/**
 * Obtém regras de target do DNA.
 * @type {function(string): Promise<object>}
 */
export const getTargetRules = dnaStore.getTargetRules;

/**
 * Invalida cache do DNA.
 * @type {function(): void}
 */
export const invalidateDnaCache = dnaStore.invalidateCache;

/**
 * Faz rollback do DNA.
 * @type {function(): Promise<void>}
 */
export const rollbackDna = dnaStore.rollbackDna;

/**
 * Obtém histórico do DNA.
 * @type {function(): Array<object>}
 */
export const getDnaHistory = dnaStore.getDnaHistory;

/**
 * Evolui DNA usando protocolo SADI.
 * @type {function(object, string, string): Promise<{accepted: boolean, reason?: string, stats?: object, error?: string}>}
 */
export const evolveWithSadiProtocol = dnaEvolution.evolveWithSadiProtocol;

/**
 * Evolui DNA usando protocolo completo.
 * @type {function(object, string, string): Promise<boolean>}
 */
export const evolveWithFullProtocol = dnaEvolution.evolveWithFullProtocol;

/**
 * Obtém estatísticas de evolução.
 * @type {function(): object}
 */
export const getEvolutionStats = dnaEvolution.getEvolutionStats;
/**
 * Carrega a identidade do robô do arquivo de identidade.
 *
 * **Side-effects:** Lê do sistema de arquivos.
 *
 * @returns {Promise<object|null>} Dados da identidade ou null se não encontrado
 */
export const getIdentity = async () => fsCore.safeReadJSON(PATHS.IDENTITY);
/**
 * Salva a identidade do robô no arquivo de identidade.
 *
 * **Side-effects:** Escreve no sistema de arquivos de forma atômica.
 *
 * @param {object} data - Dados da identidade a serem salvos
 * @returns {Promise<boolean>} true se a operação foi bem-sucedida
 */
export const saveIdentity = async data => fsCore.atomicWrite(PATHS.IDENTITY, JSON.stringify(data, null, 2));

/**
 * Adquire lock por ID.
 * @type {function(string): Promise<object>}
 */
export const acquireLock = lockManager.acquireLock;
/**
 * Libera lock por ID.
 * @type {function(string): Promise<void>}
 */
export const releaseLock = lockManager.releaseLock;

/**
 * Obtém fila atual do cache.
 * @type {function(): Promise<object>}
 */
export const getQueue = queueCache.getQueue;

/**
 * Marca cache como sujo.
 * @type {function(): void}
 */
export const setCacheDirty = queueCache.markDirty;

/**
 * Carrega próxima tarefa da fila.
 * @type {function(): Promise<object>}
 */
export const loadNextTask = taskLoader.loadNextTask;

/**
 * Retenta tarefas falhadas em lote.
 * @type {function(Array<string>): Promise<number>}
 */
export const bulkRetryFailed = taskLoader.bulkRetryFailed;

/**
 * Carrega todas as tarefas da fila em memória.
 *
 * **Side-effects:** Lê dados do cache da fila.
 *
 * @returns {Promise<Array<object>>} Array com todas as tarefas da fila
 */
export const loadAllTasks = async () => {
    const queue = await queueCache.getQueue();
    return queue.tasks || [];
};

/**
 * Verifica se o sistema está em pausa por controle.
 * @type {function(): Promise<boolean>}
 */
export const checkControlPause = controlStore.checkControlPause;
