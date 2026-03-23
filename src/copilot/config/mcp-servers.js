// @ts-check
/**
 * src/copilot/config/mcp-servers.js
 *
 * Configurações canônicas de servidores MCP (Model Context Protocol) para o projeto. Centraliza as definições dos
 * servidores MCP disponíveis no ambiente DevContainer.
 *
 * @module copilot/config/mcp-servers
 */

/**
 * @typedef {object} McpServerConfig
 * @property {string} type - Tipo de transporte ('stdio' | 'sse')
 * @property {string} command - Executável a iniciar (para stdio)
 * @property {string[]} [args] - Argumentos CLI (para stdio)
 * @property {Record<string, string>} [env] - Variáveis de ambiente adicionais
 * @property {string} [url] - URL do servidor SSE
 * @property {Record<string, string>} [headers] - Headers HTTP adicionais (para SSE)
 */

/**
 * @typedef {Record<string, McpServerConfig>} McpServersMap
 */

/**
 * Mapa de servidores MCP pré-configurados para este workspace.
 *
 * Ative um servidor passando as chaves desejadas para `buildMcpConfig()`.
 *
 * @type {McpServersMap}
 */
export const MCP_SERVERS = {
    /**
     * Servidor GitHub MCP — acesso a issues, PRs, commits, arquivos. Requer GITHUB_TOKEN no ambiente.
     */
    github: {
        type: 'stdio',
        command: 'npx',
        args: ['@modelcontextprotocol/server-github'],
        env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN ?? '' },
    },

    /**
     * Servidor Filesystem MCP — acesso ao filesystem local (root do workspace).
     */
    filesystem: {
        type: 'stdio',
        command: 'npx',
        args: ['@modelcontextprotocol/server-filesystem', '/workspaces/chatgpt-docker-puppeteer'],
    },

    /**
     * Servidor Memory MCP — grafos de conhecimento persistentes por sessão.
     */
    memory: {
        type: 'stdio',
        command: 'npx',
        args: ['@modelcontextprotocol/server-memory'],
    },
};

/**
 * Nomes dos servidores MCP habilitados por padrão no Always-Alive Agent. Pode ser sobrescrito via variável de ambiente
 * COPILOT_MCP_SERVERS (CSV).
 *
 * @type {string[]}
 */
const DEFAULT_ENABLED = (process.env.COPILOT_MCP_SERVERS ?? '').split(',').filter(Boolean);

/**
 * Constrói o objeto `mcpServers` para injetar na SessionConfig.
 *
 * @param {string[]} [enabled] - Nomes dos servidores a incluir. Se omitido, usa DEFAULT_ENABLED. Se DEFAULT_ENABLED
 *   também for vazio, retorna undefined (sem MCP).
 * @returns {McpServersMap | undefined}
 */
export function buildMcpConfig(enabled = DEFAULT_ENABLED) {
    if (enabled.length === 0) return undefined;

    /** @type {McpServersMap} */
    const result = {};
    for (const name of enabled) {
        if (MCP_SERVERS[name]) {
            result[name] = MCP_SERVERS[name];
        }
    }

    return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Lista os nomes dos servidores MCP disponíveis neste módulo.
 *
 * @returns {string[]}
 */
export function listAvailableMcpServers() {
    return Object.keys(MCP_SERVERS);
}
