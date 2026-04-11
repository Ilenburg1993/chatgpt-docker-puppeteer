// @ts-check
/**
 * src/copilot/plugins/plugin-registry.js
 *
 * Registry de plugins copilot — registro, descoberta e ativação.
 *
 * @module copilot/plugins/plugin-registry
 */

import { log } from '#copilot/observability';

/**
 * @typedef {import('./index.js').CopilotPlugin} CopilotPlugin
 */

/**
 * Registry de plugins copilot.
 *
 * Gerencia registro, listagem e instalação de plugins via DI container.
 */
export class PluginRegistry {
    /** @type {Map<string, CopilotPlugin>} */
    #plugins = new Map();

    /** @type {Set<string>} */
    #installed = new Set();

    /**
     * Registra um plugin no registry.
     *
     * @param {CopilotPlugin} plugin
     * @throws {Error} Se plugin com mesmo nome já registrado.
     */
    register(plugin) {
        if (!plugin || !plugin.name || !plugin.type || typeof plugin.install !== 'function') {
            throw new TypeError('[PluginRegistry] plugin must have name, type, and install()');
        }
        if (this.#plugins.has(plugin.name)) {
            throw new Error(`[PluginRegistry] plugin "${plugin.name}" already registered`);
        }
        this.#plugins.set(plugin.name, plugin);
        log('DEBUG', `[PluginRegistry] registrado: ${plugin.name} (${plugin.type})`);
    }

    /**
     * Instala um plugin registrado, passando o DI container.
     *
     * @param {string} name
     * @param {import('../core/di.js').Container} container
     * @returns {Promise<void>}
     */
    async install(name, container) {
        const plugin = this.#plugins.get(name);
        if (!plugin) {
            throw new Error(`[PluginRegistry] plugin "${name}" not found`);
        }
        if (this.#installed.has(name)) {
            log('WARN', `[PluginRegistry] plugin "${name}" already installed, skipping`);
            return;
        }
        await plugin.install(container);
        this.#installed.add(name);
        log('INFO', `[PluginRegistry] instalado: ${name}`);
    }

    /**
     * Instala todos os plugins registrados.
     *
     * @param {import('../core/di.js').Container} container
     * @returns {Promise<void>}
     */
    async installAll(container) {
        for (const name of this.#plugins.keys()) {
            if (!this.#installed.has(name)) {
                await this.install(name, container);
            }
        }
    }

    /**
     * Lista todos os plugins registrados.
     *
     * @returns {{ name: string; type: string; installed: boolean }[]}
     */
    list() {
        return [...this.#plugins.values()].map((p) => ({
            name: p.name,
            type: p.type,
            installed: this.#installed.has(p.name),
        }));
    }

    /**
     * Verifica se um plugin está registrado.
     *
     * @param {string} name
     * @returns {boolean}
     */
    has(name) {
        return this.#plugins.has(name);
    }

    /**
     * Obtém um plugin pelo nome.
     *
     * @param {string} name
     * @returns {CopilotPlugin | undefined}
     */
    get(name) {
        return this.#plugins.get(name);
    }

    /**
     * Contagem de plugins registrados.
     *
     * @returns {number}
     */
    get size() {
        return this.#plugins.size;
    }

    /**
     * Limpa o registry.
     */
    clear() {
        this.#plugins.clear();
        this.#installed.clear();
    }
}

/**
 * Cria instância de PluginRegistry.
 *
 * @returns {PluginRegistry}
 */
export function createPluginRegistry() {
    return new PluginRegistry();
}
