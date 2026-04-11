// @ts-check
/**
 * src/copilot/plugins/index.js
 *
 * Barrel canônico do módulo `plugins/` — registro, descoberta e ativação de plugins.
 *
 * Este módulo é **L3** — mesmo nível de hooks, tools e bridges. Plugins podem integrar-se com tools, hooks e bridges
 * via DI container.
 *
 * **Status**: fundação estrutural. Plugin registry será adicionado em N-2b.
 *
 * @module copilot/plugins
 */

/**
 * Contrato mínimo de um plugin copilot.
 *
 * @typedef {object} CopilotPlugin
 * @property {string} name - Identificador único do plugin.
 * @property {'tool' | 'hook' | 'bridge' | 'service'} type - Tipo do plugin.
 * @property {(container: import('../core/di.js').Container) => void | Promise<void>} install - Função de instalação que
 *   recebe o container DI.
 */

// Placeholder — registry será adicionado em N-2b
// export { PluginRegistry } from './plugin-registry.js';
