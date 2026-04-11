// @ts-check
/**
 * src/copilot/config/mcp-servers.js
 *
 * Configurações canônicas de servidores MCP (Model Context Protocol) para o projeto. Centraliza as definições dos
 * servidores MCP disponíveis no ambiente DevContainer.
 *
 * @module copilot/config/mcp-servers
 * @see EventBus
 */

import {
    COPILOT_MCP_HTTP_TIMEOUT_MS,
    COPILOT_MCP_SERVERS,
    COPILOT_MCP_STDIO_TIMEOUT_MS,
    GITHUB_TOKEN,
} from '#copilot/config';
import { log } from '#copilot/observability';
import { DEFAULT_EXCLUDED_TOOLS } from './session-config.js';

/**
 * @typedef {object} McpServerConfig
 * @property {string} type - Tipo de transporte ('stdio' | 'http' | 'sse')
 * @property {string} [command] - Executável a iniciar (para stdio/local)
 * @property {string[]} [args] - Argumentos CLI (para stdio)
 * @property {Record<string, string>} [env] - Variáveis de ambiente adicionais
 * @property {string} [url] - URL do servidor HTTP/SSE remoto
 * @property {Record<string, string>} [headers] - Headers HTTP adicionais (para http/sse)
 * @property {number} [timeout] - Timeout em ms para tool calls neste servidor (GAP-CONF-002 fix)
 */

/**
 * @typedef {Record<string, McpServerConfig>} McpServersMap
 */

/** Timeout padrão para tool calls stdio MCP (ms). Configurável via COPILOT_MCP_STDIO_TIMEOUT_MS. */
const MCP_STDIO_TIMEOUT_MS = COPILOT_MCP_STDIO_TIMEOUT_MS;

/** Timeout padrão para tool calls HTTP MCP (ms). Configurável via COPILOT_MCP_HTTP_TIMEOUT_MS. */
const MCP_HTTP_TIMEOUT_MS = COPILOT_MCP_HTTP_TIMEOUT_MS;

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
        env: { GITHUB_TOKEN },
        timeout: MCP_STDIO_TIMEOUT_MS,
    },

    /**
     * Servidor Filesystem MCP — acesso ao filesystem local (root do workspace).
     */
    filesystem: {
        type: 'stdio',
        command: 'npx',
        args: ['@modelcontextprotocol/server-filesystem', '/workspaces/chatgpt-docker-puppeteer'],
        timeout: MCP_STDIO_TIMEOUT_MS,
    },

    /**
     * Servidor Memory MCP — grafos de conhecimento persistentes por sessão.
     */
    memory: {
        type: 'stdio',
        command: 'npx',
        args: ['@modelcontextprotocol/server-memory'],
        timeout: MCP_STDIO_TIMEOUT_MS,
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
            Authorization: `Bearer ${GITHUB_TOKEN}`,
        },
        timeout: MCP_HTTP_TIMEOUT_MS,
    },
};

const DEFAULT_ENABLED = COPILOT_MCP_SERVERS.split(',').filter(Boolean);

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
        if ((name === 'github' || name === 'github-official') && !GITHUB_TOKEN) {
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
