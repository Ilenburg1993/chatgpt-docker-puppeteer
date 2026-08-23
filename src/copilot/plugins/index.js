// @ts-check
/**
 * src/copilot/plugins/index.js
 *
 * Barrel canônico do módulo `plugins/` — registro, descoberta e ativação de plugins.
 *
 * Este módulo é **L3** — mesmo nível de hooks, tools e bridges. Plugins podem integrar-se com tools, hooks e bridges
 * via an explicit install context supplied by composition.
 *
 * **Status**: fundação estrutural com PluginRegistry funcional.
 *
 * @module copilot/plugins
 * @see EventBus
 */

/**
 * Contrato mínimo de um plugin copilot.
 *
 * @typedef {object} CopilotPlugin
 * @property {string} name - Identificador único do plugin.
 * @property {'tool' | 'hook' | 'bridge' | 'service'} type - Tipo do plugin.
 * @property {(context: Readonly<Record<string, unknown>>) => void | Promise<void>} install - Installation receives only the explicit capabilities supplied by the caller.
 * @property {string} [version] - Versão semântica do plugin (ex: '1.0.0').
 * @property {string} [description] - Descrição curta do propósito do plugin.
 * @property {string[]} [dependencies] - Nomes de plugins dos quais este depende.
 */

export { PluginRegistry, activatePlugins, createPluginRegistry, discoverPlugins } from './plugin-registry.js';
