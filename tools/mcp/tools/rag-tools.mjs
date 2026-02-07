/**
 * RAG Tools for MCP Server
 *
 * Provides semantic code search using the RAG v3.0 system
 * (Hybrid Search + Reranking + MMR)
 */

import { ragHybridSearch, ragHealth, getRagCacheStats } from '../../rag/lib/facade.mjs';

/**
 * Tool definitions for Claude
 */
export const ragTools = [
  {
    name: 'rag_search',
    description: `Search the chatgpt-docker-puppeteer codebase using semantic hybrid search.

This combines:
- Vector search (understands semantic meaning)
- Full-text search (finds exact terms)
- Multi-signal reranking (6 signals)
- MMR diversity (avoids redundant results)

Best for:
- Finding where specific variables/functions are defined or used
- Understanding how a feature is implemented
- Discovering related code across the codebase
- Getting code examples for a specific concept

Examples:
- "Where is CHROME_PROXY_PORT defined and used?"
- "How does the kernel loop work?"
- "All functions that handle adaptive CPU throttling"
- "Error handling in the driver module"`,
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query (supports natural language and exact terms)',
        },
        topK: {
          type: 'number',
          description: 'Number of results to return (default: 5, max: 20)',
          default: 5,
        },
        pathPrefix: {
          type: 'string',
          description: 'Optional: Only search in files under this path (e.g., "src/kernel")',
        },
        ext: {
          type: 'string',
          description: 'Optional: Only search files with this extension (e.g., ".js", ".mjs")',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'rag_health',
    description: 'Check RAG system health (database, Ollama, cache stats)',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

/**
 * Handle RAG tool execution
 */
export async function handleRagTool(toolName, args) {
  switch (toolName) {
    case 'rag_search':
      return await handleRagSearch(args);

    case 'rag_health':
      return await handleRagHealth();

    default:
      throw new Error(`Unknown RAG tool: ${toolName}`);
  }
}

/**
 * Execute semantic search
 */
async function handleRagSearch({ query, topK = 5, pathPrefix, ext }) {
  console.error(`[RAG Tool] Searching for: "${query}" (topK=${topK})`);

  // Validate topK
  const validTopK = Math.min(Math.max(topK, 1), 20);

  try {
    const result = await ragHybridSearch({
      query,
      topK: validTopK,
      pathPrefix,
      ext,
      rerank: true,
      mmr: true,
      mmrLambda: 0.7,
    });

    console.error(`[RAG Tool] Found ${result.results.length} results`);

    // Format results for Claude
    if (result.results.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No results found for "${query}".\n\nTry:\n- Broader query terms\n- Different keywords\n- Removing filters (pathPrefix, ext)`,
          },
        ],
      };
    }

    // Build formatted response
    let formatted = `# Search Results for: "${query}"\n\n`;
    formatted += `Found ${result.results.length} relevant code chunks:\n\n`;
    formatted += `**Search Method:** Hybrid (Vector + FTS) with Reranking + MMR\n`;
    formatted += `**Model:** ${result.model} (${result.dim}D)\n\n`;
    formatted += `---\n\n`;

    for (const [idx, r] of result.results.entries()) {
      formatted += `## [${idx + 1}] ${r.path}:${r.start_line}-${r.end_line}\n\n`;

      // Add metadata
      formatted += `**Relevance Score:** ${r.rerank_score?.toFixed(3) || r.score.toFixed(3)}\n`;
      formatted += `**Language:** ${r.language || 'unknown'}\n`;

      if (r.rerank_signals) {
        formatted += `**Signals:** sem=${r.rerank_signals.semantic} lex=${r.rerank_signals.lexical} rec=${r.rerank_signals.recency}\n`;
      }

      formatted += `\n`;

      // Add code with syntax highlighting
      formatted += `\`\`\`${r.language || 'text'}\n`;
      formatted += r.text;
      formatted += `\n\`\`\`\n\n`;

      formatted += `---\n\n`;
    }

    // Add cache stats if available
    const cacheStats = getRagCacheStats();
    if (cacheStats.hits > 0) {
      formatted += `\n*Cache: ${cacheStats.hits} hits, ${cacheStats.misses} misses (${(cacheStats.hitRate * 100).toFixed(1)}% hit rate)*\n`;
    }

    return {
      content: [
        {
          type: 'text',
          text: formatted,
        },
      ],
    };
  } catch (error) {
    console.error(`[RAG Tool] Search error:`, error);
    throw new Error(`RAG search failed: ${error.message}`);
  }
}

/**
 * Get RAG system health
 */
async function handleRagHealth() {
  console.error('[RAG Tool] Checking health...');

  try {
    const health = await ragHealth();
    const cacheStats = getRagCacheStats();

    let status = '# RAG System Health\n\n';

    status += `**Overall Status:** ${health.ok ? '✅ OK' : '❌ FAILED'}\n\n`;

    status += `## Components\n\n`;
    status += `- **Directories:** ${health.writable ? '✅' : '❌'} Writable\n`;
    status += `- **Manifest:** ${health.manifest_ok ? '✅' : '❌'} Valid\n`;
    status += `- **Ollama:** ${health.ollama.ok ? '✅' : '❌'} ${health.ollama.ok ? 'Connected' : 'Unreachable'}\n`;
    status += `- **Embedding Model:** ${health.ollama.hasModel ? '✅' : '❌'} ${health.ollama.model || 'Not found'}\n`;
    status += `- **LanceDB:** ${health.lancedb.ok ? '✅' : '❌'} ${health.lancedb.ok ? 'Accessible' : 'Error'}\n\n`;

    if (health.ollama.models) {
      status += `## Available Models\n\n`;
      for (const model of health.ollama.models) {
        status += `- ${model}\n`;
      }
      status += `\n`;
    }

    status += `## Cache Statistics\n\n`;
    status += `- **Size:** ${cacheStats.size}/${cacheStats.maxSize} entries\n`;
    status += `- **Hits:** ${cacheStats.hits}\n`;
    status += `- **Misses:** ${cacheStats.misses}\n`;
    status += `- **Hit Rate:** ${(cacheStats.hitRate * 100).toFixed(1)}%\n`;

    if (cacheStats.hits > 0) {
      status += `- **Efficiency:** Saved ${cacheStats.hits} embedding calls (~${(cacheStats.hits * 200).toFixed(0)}ms)\n`;
    }

    return {
      content: [
        {
          type: 'text',
          text: status,
        },
      ],
    };
  } catch (error) {
    console.error(`[RAG Tool] Health check error:`, error);
    throw new Error(`RAG health check failed: ${error.message}`);
  }
}
