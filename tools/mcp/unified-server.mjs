#!/usr/bin/env node
/**
 * Unified MCP Server for chatgpt-docker-puppeteer
 *
 * Exposes multiple tools to Claude Desktop:
 * - RAG search (local codebase)
 * - GitHub integration (search, PRs, issues)
 * - Future: Code graph, workspace context, etc.
 *
 * Usage:
 * node tools/mcp/unified-server.mjs
 *
 * Configure in Claude Desktop:
 * ~/Library/Application Support/Claude/claude_desktop_config.json (macOS)
 * %AppData%/Claude/claude_desktop_config.json (Windows)
 *
 * {
 *   "mcpServers": {
 *     "chatgpt-docker": {
 *       "command": "node",
 *       "args": ["/workspaces/chatgpt-docker-puppeteer/tools/mcp/unified-server.mjs"],
 *       "env": {
 *         "GITHUB_TOKEN": "ghp_...",
 *         "GITHUB_REPO": "owner/repo"
 *       }
 *     }
 *   }
 * }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

// Tool handlers
import { ragTools, handleRagTool } from './tools/rag-tools.mjs';
import { githubTools, handleGitHubTool } from './tools/github-tools.mjs';

const server = new Server(
  {
    name: 'chatgpt-docker-puppeteer',
    version: '3.0.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// Combine all tools
const ALL_TOOLS = [
  ...ragTools,
  ...githubTools,
];

/**
 * List all available tools
 */
server.setRequestHandler('tools/list', async () => {
  console.error('[MCP] Listing tools:', ALL_TOOLS.map(t => t.name).join(', '));
  return { tools: ALL_TOOLS };
});

/**
 * Execute tool by name
 */
server.setRequestHandler('tools/call', async (request) => {
  const toolName = request.params.name;
  const args = request.params.arguments || {};

  console.error(`[MCP] Calling tool: ${toolName} with args:`, JSON.stringify(args, null, 2));

  try {
    // Route to appropriate handler
    if (toolName.startsWith('rag_')) {
      return await handleRagTool(toolName, args);
    } else if (toolName.startsWith('github_')) {
      return await handleGitHubTool(toolName, args);
    } else {
      throw new Error(`Unknown tool: ${toolName}`);
    }
  } catch (error) {
    console.error(`[MCP] Tool error:`, error);
    return {
      content: [
        {
          type: 'text',
          text: `Error executing ${toolName}: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

/**
 * List available resources (optional - for future use)
 */
server.setRequestHandler('resources/list', async () => {
  return {
    resources: [
      {
        uri: 'rag://stats',
        name: 'RAG Cache Statistics',
        mimeType: 'application/json',
        description: 'Current RAG cache hit rate and performance stats',
      },
    ],
  };
});

/**
 * Read resource content (optional - for future use)
 */
server.setRequestHandler('resources/read', async (request) => {
  const uri = request.params.uri;

  if (uri === 'rag://stats') {
    const { getRagCacheStats } = await import('../rag/lib/facade.mjs');
    const stats = getRagCacheStats();

    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(stats, null, 2),
        },
      ],
    };
  }

  throw new Error(`Unknown resource: ${uri}`);
});

// Start server
async function main() {
  console.error('[MCP] Starting unified MCP server...');
  console.error('[MCP] Server name: chatgpt-docker-puppeteer');
  console.error('[MCP] Tools:', ALL_TOOLS.length);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('[MCP] Server ready! Waiting for requests from Claude Desktop...');
}

main().catch((error) => {
  console.error('[MCP] Fatal error:', error);
  process.exit(1);
});
