// @ts-check
/**
 * Contrato de plugin para Bridges do Copilot.
 *
 * Define a interface mínima que um Bridge plugin deve implementar para conectar
 * o sistema a serviços externos (Git, GitHub, MCP, Nerv, etc.).
 * Os módulos `nerv-bridge.js`, `mcp-tool-bridge.js` e `git-bridge.js` satisfazem
 * variações deste contrato.
 *
 * @module copilot/sdk/bridge-contract
 */

/**
 * Interface mínima de um Bridge plugin baseado em eventos (padrão Nerv).
 *
 * Bridges de eventos conectam o agente a um barramento de eventos externo,
 * permitindo emitir e receber sinais do sistema operacional.
 *
 * @typedef {Object} EventBridgePlugin
 * @property {(eventBus: object) => void} mount
 *   Conecta o bridge a um barramento de eventos (ex: Nerv).
 * @property {() => void} unmount
 *   Desconecta o bridge do barramento de eventos.
 * @property {() => boolean} isMounted
 *   Retorna `true` se o bridge está conectado.
 * @property {(actionCode: string, payload?: object) => void} emitNerv
 *   Emite um evento no barramento conectado.
 */

/**
 * Interface mínima de um Bridge plugin baseado em ferramentas (padrão MCP).
 *
 * Bridges de ferramentas expõem tools de um registry remoto para o agente,
 * gerando Custom Tools SDK em runtime.
 *
 * @typedef {Object} ToolBridgePlugin
 * @property {() => ToolBridgeStatus} getMcpStatus
 *   Retorna o status de conexão do bridge de ferramentas.
 * @property {() => Promise<object[]>} listMcpTools
 *   Lista as ferramentas disponíveis no registry remoto.
 * @property {() => Promise<object[]>} buildMcpTools
 *   Gera Custom Tools SDK para cada ferramenta remota.
 */

/**
 * Status de conexão de um ToolBridgePlugin.
 *
 * @typedef {Object} ToolBridgeStatus
 * @property {boolean} portOpen - Se a porta do MCP server está acessível.
 * @property {number} toolCount - Número de tools registradas.
 * @property {string} [lastError] - Último erro de conexão.
 */

/**
 * Interface mínima de um Bridge plugin baseado em comandos (padrão Git).
 *
 * Bridges de comandos executam operações via CLI e retornam resultados estruturados.
 *
 * @typedef {Object} CommandBridgePlugin
 * @property {(opts?: object) => Promise<object>} status
 *   Retorna o status do sistema externo (ex: `git status`).
 * @property {(opts?: object) => Promise<object[]>} log
 *   Retorna log/histórico do sistema externo.
 */

export {};
