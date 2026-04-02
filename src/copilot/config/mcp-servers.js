// @ts-check
/**
 * src/copilot/config/mcp-servers.js
 *
 * Configurações canônicas de servidores MCP (Model Context Protocol) para o projeto. Centraliza as definições dos
 * servidores MCP disponíveis no ambiente DevContainer.
 *
 * @module copilot/config/mcp-servers
 */

import { log } from '#copilot/observability/logger';
import { DEFAULT_EXCLUDED_TOOLS } from './session-config.js';

/**
 * @typedef {object} McpServerConfig
 * @property {string} type - Tipo de transporte ('stdio' | 'http' | 'sse')
 * @property {string} [command] - Executável a iniciar (para stdio/local)
 * @property {string[]} [args] - Argumentos CLI (para stdio)
 * @property {Record<string, string>} [env] - Variáveis de ambiente adicionais
 * @property {string} [url] - URL do servidor HTTP/SSE remoto
 * @property {Record<string, string>} [headers] - Headers HTTP adicionais (para http/sse)
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
        env: { GITHUB_TOKEN: process.env['GITHUB_TOKEN'] ?? '' },
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

    /**
     * GitHub MCP Server oficial (HTTP) — acesso completo à API GitHub via MCP remoto.
     *
     * Usa o servidor HTTP oficial em `https://api.githubcopilot.com/mcp/` com autenticação via `GITHUB_TOKEN`. Fornece
     * as mesmas tools que os agentes built-in `explore` e `research` usam internamente (github-mcp-server/*).
     *
     * Requer: `GITHUB_TOKEN` no ambiente.
     */
    'github-official': {
        type: 'http',
        url: 'https://api.githubcopilot.com/mcp/',
        headers: {
            Authorization: `Bearer ${process.env['GITHUB_TOKEN'] ?? ''}`,
        },
    },
};

const DEFAULT_ENABLED = (process.env['COPILOT_MCP_SERVERS'] ?? '').split(',').filter(Boolean);

/**
 * Constrói o objeto `mcpServers` para injetar na SessionConfig.
 *
 * @param {string[]} [enabled] - Nomes dos servidores a incluir. Se omitido, usa DEFAULT_ENABLED. Se DEFAULT_ENABLED
 *   também for vazio, retorna undefined (sem MCP).
 * @returns {McpServersMap | undefined}
 */
export function buildMcpConfig(enabled = DEFAULT_ENABLED) {
    if (enabled.length === 0) return undefined;

    // GAP-Q01 fix: avisar quando MCP server 'memory' está habilitado mas excluído via DEFAULT_EXCLUDED_TOOLS
    if (enabled.includes('memory') && DEFAULT_EXCLUDED_TOOLS.includes('memory')) {
        log(
            'WARN',
            "[MCP] Servidor 'memory' está em COPILOT_MCP_SERVERS mas 'memory' está em DEFAULT_EXCLUDED_TOOLS — a ferramenta será carregada mas excluída da sessão.",
        );
    }

    /** @type {McpServersMap} */
    const result = {};
    for (const name of enabled) {
        if (!MCP_SERVERS[name]) continue;

        // UPG-PROP-09 (fix): validar credenciais obrigatórias antes de registrar o servidor MCP
        if ((name === 'github' || name === 'github-official') && !process.env['GITHUB_TOKEN']) {
            log(
                'WARN',
                `[MCP] Servidor '${name}' requer GITHUB_TOKEN — variável ausente no ambiente. Servidor pulado.`,
            );
            continue;
        }

        result[name] = MCP_SERVERS[name];
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
