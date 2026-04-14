// @ts-check
/**
 * src/copilot/core/di.js — [L0] Lightweight DI container.
 *
 * Container de injeção de dependências minimalista: tokens tipados, lifecycle (singleton / transient / scoped), child
 * containers via `fork()` e ordered cleanup via `dispose()`.
 *
 * Zero dependências internas — opera exclusivamente com primitivas JS.
 *
 * @module copilot/core/di
 * @see EventBus
 */

// ─── Token ────────────────────────────────────────────────────────────────────

/**
 * @template T
 * @typedef {Object} Token
 * @property {string} name - Nome legível do token (para erros e debug).
 * @property {symbol} _id - Identificador único interno.
 * @property {T} [_phantom] - Phantom field para preservar generic em TS/JSDoc.
 */

/** @type {number} */
let _tokenSeq = 0;

/**
 * Cria um token tipado para registrar/resolver dependências no container.
 *
 * @example
 *     const SDK_LOGGER = createToken('SDK_LOGGER');
 *
 * @template T
 * @param {string} name - Nome legível do token (ex.: `'SDK_LOGGER'`).
 * @returns {Token<T>}
 */
export function createToken(name) {
    if (!name || typeof name !== 'string') {
        throw new TypeError('Token name must be a non-empty string');
    }
    return /** @type {Token<T>} */ ({
        name,
        _id: Symbol(`di:${name}:${++_tokenSeq}`),
    });
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

/**
 * @typedef {'singleton' | 'transient' | 'scoped'} Lifecycle
 *
 *   - **singleton**: instância única, resolvida uma vez e cacheada.
 *   - **transient**: nova instância a cada `resolve()`.
 *   - **scoped**: singleton dentro de um child container (`fork()`), transient no root.
 */

// ─── Registration ─────────────────────────────────────────────────────────────

/**
 * @template T
 * @typedef {Object} Registration
 * @property {Token<T>} token
 * @property {(container: Container) => T} factory
 * @property {Lifecycle} lifecycle
 * @property {number} [order] - Ordem de registro (para dispose reverso).
 */

// ─── Container ────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} Container
 * @property {<T>(token: Token<T>, factory: (c: Container) => T, lifecycle?: Lifecycle) => Container} register
 * @property {<T>(token: Token<T>) => T} resolve
 * @property {<T>(token: Token<T>) => boolean} has
 * @property {(tokens: ReadonlyArray<Token<any>>) => void} validateRequired
 * @property {() => Container} fork
 * @property {() => void} dispose
 * @property {() => ReadonlyArray<string>} tokens
 */

/**
 * Cria um container DI com suporte a lifecycle, fork e dispose.
 *
 * @example
 *     const c = createContainer();
 *     c.register(SDK_LOGGER, () => myLogFn, 'singleton');
 *     const log = c.resolve(SDK_LOGGER);
 *
 * @param {Container} [parent] - Container pai (para child containers via fork).
 * @returns {Container}
 */
export function createContainer(parent) {
    /** @type {Map<symbol, Registration<any>>} */
    const registrations = new Map();

    /** @type {Map<symbol, any>} */
    const singletonCache = new Map();

    /** @type {Container[]} */
    const children = [];

    /** @type {number} */
    let regOrder = 0;

    /** @type {boolean} */
    let disposed = false;

    /**
     * Verifica se o container já foi descartado.
     */
    function assertNotDisposed() {
        if (disposed) throw new Error('Container already disposed');
    }

    /** @type {Container} */
    const container = {
        /**
         * Registra uma factory para o token informado.
         *
         * @template T
         * @param {Token<T>} token
         * @param {(c: Container) => T} factory
         * @param {Lifecycle} [lifecycle='singleton'] Default is `'singleton'`
         * @returns {Container} `this` para chaining.
         */
        register(token, factory, lifecycle = 'singleton') {
            assertNotDisposed();
            if (!token || !token._id) throw new TypeError('Invalid token');
            if (typeof factory !== 'function') throw new TypeError(`Factory for '${token.name}' must be a function`);
            registrations.set(token._id, { token, factory, lifecycle, order: regOrder++ });
            // Invalida cache ao re-registrar (singleton pode mudar)
            singletonCache.delete(token._id);
            return container;
        },

        /**
         * Resolve o valor associado ao token.
         *
         * @template T
         * @param {Token<T>} token
         * @returns {T}
         * @throws {Error} Se o token não está registrado.
         */
        resolve(token) {
            assertNotDisposed();
            if (!token || !token._id) throw new TypeError('Invalid token');

            const reg = registrations.get(token._id);
            if (reg) {
                return /** @type {T} */ (_resolveRegistration(reg));
            }

            // Delega ao parent se não encontrado localmente
            if (parent) return parent.resolve(token);

            throw new Error(`Token '${token.name}' not registered`);
        },

        /**
         * Verifica se o token está registrado (localmente ou no parent).
         *
         * @template T
         * @param {Token<T>} token
         * @returns {boolean}
         */
        has(token) {
            if (disposed) return false;
            if (!token || !token._id) return false;
            if (registrations.has(token._id)) return true;
            return parent ? parent.has(token) : false;
        },

        /**
         * Cria um child container que herda registros do parent. Registros `scoped` criam caches independentes no
         * child.
         *
         * @returns {Container}
         */
        fork() {
            assertNotDisposed();
            const child = createContainer(container);
            children.push(child);
            return child;
        },

        /**
         * Descarta o container e todos os children (ordem reversa). Singletons com método `dispose()` / `close()` /
         * `destroy()` são invocados.
         */
        dispose() {
            if (disposed) return;
            disposed = true;

            // Dispose children primeiro (depth-first)
            for (let i = children.length - 1; i >= 0; i--) {
                children[i]?.dispose();
            }
            children.length = 0;

            // Dispose singletons em ordem reversa de registro
            const entries = /** @type {[symbol, Registration<any>][]} */ ([...registrations.entries()]);
            entries.sort((a, b) => (b[1].order ?? 0) - (a[1].order ?? 0));

            for (const [id] of entries) {
                const instance = singletonCache.get(id);
                if (instance && typeof instance === 'object') {
                    const disposeFn = instance.dispose ?? instance.close ?? instance.destroy;
                    if (typeof disposeFn === 'function') {
                        try {
                            disposeFn.call(instance);
                        } catch {
                            // Swallow dispose errors — best effort cleanup
                        }
                    }
                }
                singletonCache.delete(id);
            }
            registrations.clear();
        },

        /**
         * Lista nomes dos tokens registrados (debug).
         *
         * @returns {ReadonlyArray<string>}
         */
        tokens() {
            return [...registrations.values()].map((r) => r.token.name);
        },

        /**
         * Valida que todos os tokens obrigatórios estão registrados. Lança `Error` agregado listando os faltantes.
         *
         * @param {ReadonlyArray<Token<any>>} required
         * @throws {Error} Se algum token obrigatório não estiver registrado.
         */
        validateRequired(required) {
            assertNotDisposed();
            const missing = required.filter((t) => !container.has(t)).map((t) => t.name);
            if (missing.length > 0) {
                throw new Error(`DI: missing required tokens: ${missing.join(', ')}`);
            }
        },
    };

    /**
     * Resolve uma Registration respeitando lifecycle.
     *
     * @param {Registration<any>} reg
     * @returns {any}
     */
    function _resolveRegistration(reg) {
        const { lifecycle, token } = reg;

        if (lifecycle === 'transient') {
            return reg.factory(container);
        }

        // singleton ou scoped (scoped = singleton no child, transient no root)
        if (lifecycle === 'scoped' && !parent) {
            return reg.factory(container);
        }

        // singleton / scoped-in-child: cache
        if (singletonCache.has(token._id)) {
            return singletonCache.get(token._id);
        }

        const instance = reg.factory(container);
        singletonCache.set(token._id, instance);
        return instance;
    }

    return container;
}
