// @ts-check
/**
 * src/copilot/core/mutex.js
 *
 * Mutex baseado em promise-chain para serialização de operações assíncronas.
 * Substitui os padrões de mutex inline espalhados pelo código (tools/todo/store.js,
 * terminal/dialog/engine.js, agent/dialog/loop-manager.js, etc.).
 *
 * Uso:
 * ```js
 * const m = createMutex();
 * const release = await m.acquire();
 * try {
 *     // seção crítica
 * } finally {
 *     release();
 * }
 *
 * // Ou usando o helper withMutex:
 * const result = await withMutex(m, async () => { ... });
 * ```
 *
 * @module copilot/core/mutex
 */

/**
 * @typedef {object} Mutex
 * @property {() => Promise<() => void>} acquire - Adquire o lock. Retorna função de release.
 * @property {() => boolean} isLocked - Retorna true se o mutex está bloqueado.
 */

/**
 * Cria um novo mutex serial baseado em promise-chain.
 *
 * @returns {Mutex}
 */
export function createMutex() {
    /** @type {Promise<void>} */
    let _tail = Promise.resolve();
    let _locked = false;

    return {
        /**
         * Adquire o lock. Aguarda na fila se já estiver bloqueado.
         *
         * @returns {Promise<() => void>} Função de release a ser chamada na cláusula finally.
         */
        acquire() {
            /** @type {() => void} */
            let release;
            const token = new Promise(/** @param {(v: void) => void} resolve */ (resolve) => {
                release = resolve;
            });
            const prev = _tail;
            _tail = prev.then(() => token);
            return prev.then(() => {
                _locked = true;
                return () => {
                    _locked = false;
                    release();
                };
            });
        },

        /**
         * Retorna true se o mutex está atualmente bloqueado.
         *
         * @returns {boolean}
         */
        isLocked() {
            return _locked;
        },
    };
}

/**
 * Pool de mutexes por chave string. Permite serialização por recurso nomeado
 * (ex: `mutexPool.for('session:abc').acquire()`).
 *
 * @typedef {object} MutexPool
 * @property {(key: string) => Mutex} for - Retorna (ou cria) um mutex para a chave fornecida.
 * @property {() => number} size - Retorna o número de mutexes no pool.
 * @property {(key: string) => boolean} delete - Remove um mutex do pool (se não estiver locked).
 */

/**
 * Cria um pool de mutexes identificados por chave.
 *
 * @returns {MutexPool}
 */
export function createMutexPool() {
    /** @type {Map<string, Mutex>} */
    const _pool = new Map();

    return {
        /**
         * Retorna o mutex para a chave, criando-o se necessário.
         *
         * @param {string} key
         * @returns {Mutex}
         */
        for(key) {
            if (!_pool.has(key)) {
                _pool.set(key, createMutex());
            }
            return /** @type {Mutex} */ (_pool.get(key));
        },

        /**
         * Número de mutexes no pool.
         *
         * @returns {number}
         */
        size() {
            return _pool.size;
        },

        /**
         * Remove mutex do pool se não estiver locked.
         *
         * @param {string} key
         * @returns {boolean} true se removido
         */
        delete(key) {
            const m = _pool.get(key);
            if (!m || m.isLocked()) return false;
            return _pool.delete(key);
        },
    };
}

/**
 * Executa `fn` dentro de um mutex, garantindo release mesmo em caso de erro.
 *
 * @template T
 * @param {Mutex} mutex
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withMutex(mutex, fn) {
    const release = await mutex.acquire();
    try {
        return await fn();
    } finally {
        release();
    }
}
