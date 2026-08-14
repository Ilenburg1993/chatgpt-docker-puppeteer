// @ts-check
/**
 * Façade pública para APIs de lock de I/O e arquivo de lock.
 *
 * Expõe mecanismos de sincronização para operações em path/resource (mutex) e
 * lockfile semantics para coordenação entre processos.
 *
 * @module copilot/infra/public/locks
 */

export {
    withIoResourceLock
} from '../io-locks.js';

export {
    acquireLock,
    releaseLock
} from '../lockfile.js';
