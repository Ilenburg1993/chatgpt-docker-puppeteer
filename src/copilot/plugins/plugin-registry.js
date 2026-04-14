// @ts-check
/**
 * src/copilot/plugins/plugin-registry.js
 *
 * Registry de plugins copilot — registro, descoberta e ativação.
 *
 * @module copilot/plugins/plugin-registry
 * @see EventBus
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
        // N-2c: validar dependências antes de instalar
        if (plugin.dependencies?.length) {
            for (const dep of plugin.dependencies) {
                if (!this.#installed.has(dep)) {
                    throw new Error(`[PluginRegistry] plugin "${name}" requires "${dep}" to be installed first`);
                }
            }
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

/**
 * Descobre e carrega plugins a partir de diretórios convencionais no filesystem.
 *
 * Escaneia por arquivos `*.js` nos subdiretórios `tools/`, `hooks/`, `bridges/`, `services/` dentro de `baseDir`. Cada
 * arquivo deve exportar um default que satisfaça o contrato CopilotPlugin.
 *
 * @param {string} baseDir - Diretório raiz de plugins (ex: `src/copilot/plugins`).
 * @param {PluginRegistry} registry - Registry onde registrar os plugins encontrados.
 * @returns {Promise<string[]>} Nomes dos plugins registrados.
 */
export async function discoverPlugins(baseDir, registry) {
    const { readdir } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { pathToFileURL } = await import('node:url');

    const subdirs = ['tools', 'hooks', 'bridges', 'services'];
    /** @type {string[]} */
    const registered = [];

    for (const sub of subdirs) {
        const dir = join(baseDir, sub);
        /** @type {import('node:fs').Dirent[]} */
        let entries;
        try {
            entries = await readdir(dir, { withFileTypes: true });
        } catch {
            // Diretório não existe — ok, pular
            continue;
        }
        for (const entry of entries) {
            if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
            const filePath = join(dir, entry.name);
            try {
                const mod = await import(pathToFileURL(filePath).href);
                const plugin = mod.default ?? mod;
                if (plugin && typeof plugin.name === 'string' && typeof plugin.install === 'function') {
                    if (!plugin.type) plugin.type = sub.replace(/s$/, ''); // tools→tool, hooks→hook
                    registry.register(plugin);
                    registered.push(plugin.name);
                } else {
                    log('WARN', `[discoverPlugins] ${filePath}: módulo não exporta plugin válido, ignorando`);
                }
            } catch (/** @type {any} */ err) {
                log('ERROR', `[discoverPlugins] falha ao carregar ${filePath}: ${err?.message ?? err}`);
            }
        }
    }
    return registered;
}

/**
 * Ativa plugins com base em configuração.
 *
 * Recebe um array de nomes (whitelist) e instala apenas os plugins correspondentes no registry. Se `enabledNames` for
 * `undefined` ou `null`, instala todos (comportamento padrão).
 *
 * @param {PluginRegistry} registry - Registry com plugins já registrados.
 * @param {import('../core/di.js').Container} container - Container DI.
 * @param {string[] | null | undefined} [enabledNames] - Nomes dos plugins a ativar. Se omitido, ativa todos.
 * @returns {Promise<string[]>} Nomes dos plugins efetivamente instalados.
 */
export async function activatePlugins(registry, container, enabledNames) {
    if (!enabledNames) {
        await registry.installAll(container);
        return registry
            .list()
            .filter((p) => p.installed)
            .map((p) => p.name);
    }
    /** @type {string[]} */
    const activated = [];
    for (const name of enabledNames) {
        if (registry.has(name)) {
            await registry.install(name, container);
            activated.push(name);
        } else {
            log('WARN', `[activatePlugins] plugin "${name}" configurado mas não encontrado no registry`);
        }
    }
    return activated;
}
