#!/usr/bin/env node
/**
 * Unified MCP Server for chatgpt-docker-puppeteer (v5.0)
 *
 * Exposes multiple tools via Tool Registry to Claude Desktop:
 * - RAG search (local codebase)
 * - Ollama Cloud generation (qwen3-coder-next, qwen3-next)
 * - Ollama Local embeddings (nomic-embed-text)
 * - GitHub integration (via upstream MCP - optional)
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
 *         "OLLAMA_CLOUD_ENABLED": "true",
 *         "OLLAMA_CLOUD_API_KEY": "your_key_here",
 *         "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_..."
 *       }
 *     }
 *   }
 * }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

// Tool Registry (DRY Architecture)
import { registry, initialize, normalizeToolResultPayload } from '../../src/integration/tool-registry.mjs';

const server = new Server(
  {
    name: 'chatgpt-docker-puppeteer',
    version: '5.0.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

/** @type {Map<string, AbortController>} */
const activeRequests = new Map();

/**
 * List all available tools from Tool Registry
 */
server.setRequestHandler('tools/list', async () => {
  const tools = registry.getAllMetadata();
  console.error('[MCP] Listing tools:', tools.map(t => t.name).join(', '));
  return { tools };
});

/**
 * Execute tool by name via Tool Registry
 */
server.setRequestHandler('tools/call', async (request) => {
  const toolName = request.params.name;
  const args = request.params.arguments || {};
  const requestId = request?.id !== undefined && request?.id !== null
    ? String(request.id)
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  console.error(`[MCP] Calling tool: ${toolName} with args:`, JSON.stringify(args, null, 2));

  const controller = new AbortController();
  activeRequests.set(requestId, controller);
  const timeoutMs = Number(process.env.MCP_TOOL_TIMEOUT || 90000);
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const result = await registry.execute(toolName, args, { signal: controller.signal });

    // MCP expects content array format
    // If result is already in MCP format, return as-is
    if (result && typeof result === 'object' && Array.isArray(result.content)) {
      return result;
    }

    const normalized = normalizeToolResultPayload(result);

    // Otherwise, wrap in MCP format
    return {
      content: [
        {
          type: 'text',
          text: normalized.text
        }
      ],
      structuredContent: {
        ...(normalized.json !== undefined ? { data: normalized.json } : {}),
        flags: normalized.flags
      }
    };
  } catch (error) {
    if (controller.signal.aborted) {
      return {
        content: [
          {
            type: 'text',
            text: `Tool "${toolName}" timed out/cancelled after ${timeoutMs}ms`
          }
        ],
        isError: true
      };
    }
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
  } finally {
    clearTimeout(timeoutId);
    activeRequests.delete(requestId);
  }
});

if (typeof server.setNotificationHandler === 'function') {
  server.setNotificationHandler('notifications/cancelled', async (notification) => {
    const targetId = notification?.params?.requestId ?? notification?.params?.id ?? notification?.params?.request_id;
    const key = targetId !== undefined && targetId !== null ? String(targetId) : null;
    if (!key) return {};
    const controller = activeRequests.get(key);
    if (controller) {
      controller.abort();
      activeRequests.delete(key);
      console.error(`[MCP] Cancelled active request ${key}`);
    }
    return {};
  });
}

/**
 * List available resources (optional - for future use)
 */
server.setRequestHandler('resources/list', async () => {
  return {
    resources: [
      {
        uri: 'rag://stats',
        name: 'RAG Runtime Statistics',
        mimeType: 'application/json',
        description: 'RAG cache, index freshness, chunk schema and expand health',
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
    const { getRagCacheStats, getRagIndexStatus, getRagStorageStats } = await import('../rag/lib/facade.mjs');
    const stats = getRagCacheStats();
    const index = await getRagIndexStatus();
    const storage = await getRagStorageStats();

    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({
            ...stats,
            index,
            storage,
            expand_health: {
              enabled: true,
              default_lines: Number(process.env.RAG_EXPAND_DEFAULT_LINES || 40),
              max_lines: Number(process.env.RAG_EXPAND_MAX_LINES || 240)
            }
          }, null, 2),
        },
      ],
    };
  }

  throw new Error(`Unknown resource: ${uri}`);
});

// Start server
async function main() {
  console.error('[MCP] Starting unified MCP server (v5.0)...');
  console.error('[MCP] Server name: chatgpt-docker-puppeteer');
  console.error('[MCP] Initializing Tool Registry...');

  // Initialize Tool Registry (RAG + Ollama Cloud/Local + Upstreams)
  await initialize();

  const stats = registry.getStats();
  console.error(`[MCP] Tools registered: ${stats.totalTools}`);
  console.error(`[MCP] Available tools: ${stats.tools.join(', ')}`);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('[MCP] Server ready! Waiting for requests from Claude Desktop...');
}

main().catch((error) => {
  console.error('[MCP] Fatal error:', error);
  process.exit(1);
});
