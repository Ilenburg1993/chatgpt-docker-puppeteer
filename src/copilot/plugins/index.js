// @ts-check
/**
 * src/copilot/plugins/index.js
 *
 * Barrel canônico do módulo `plugins/` — registro, descoberta e ativação de plugins.
 *
 * Este módulo é **L3** — mesmo nível de hooks, tools e bridges. Plugins podem integrar-se com tools, hooks e bridges
 * via DI container.
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
 * @property {(container: import('../core/di.js').Container) => void | Promise<void>} install - Função de instalação que
 *   recebe o container DI.
 * @property {string} [version] - Versão semântica do plugin (ex: '1.0.0').
 * @property {string} [description] - Descrição curta do propósito do plugin.
 * @property {string[]} [dependencies] - Nomes de plugins dos quais este depende.
 */

export { activatePlugins, createPluginRegistry, discoverPlugins, PluginRegistry } from './plugin-registry.js';

// ─── DI Tokens ────────────────────────────────────────────────────────────────
export { CIRCUIT_BREAKER_REGISTRY, PLUGIN_REGISTRY } from './di-tokens.js';
