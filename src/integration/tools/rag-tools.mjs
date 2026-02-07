/**
 * RAG Tools for Tool Registry
 *
 * Wraps existing RAG v3.0 backend (tools/rag/lib/facade.mjs)
 * Implements tools for semantic code search and health checks
 *
 * Tools:
 * - rag_search: Hybrid semantic search (Vector + FTS + Reranking + MMR)
 * - rag_health: RAG system health check (LanceDB, Ollama, cache)
 */

import {
    ragHybridSearch,
    ragHealth,
    getRagCacheStats
} from '../../../tools/rag/lib/facade.mjs';

/**
 * rag_search tool: Hybrid semantic search
 *
 * Searches the chatgpt-docker-puppeteer codebase using:
 * - Vector search (semantic understanding)
 * - Full-text search (exact term matching)
 * - Multi-signal reranking (6 signals)
 * - MMR diversity (avoids redundant results)
 *
 * @param {Object} params - Search parameters
 * @param {string} params.query - Search query (natural language or exact terms)
 * @param {number} params.topK - Number of results (default: 5, max: 20)
 * @param {string} params.pathPrefix - Optional: Filter by path (e.g., "src/kernel")
 * @param {string} params.ext - Optional: Filter by extension (e.g., ".js", ".mjs")
 * @returns {Promise<string>} Formatted Markdown response with code chunks
 */
async function ragSearchHandler({ query, topK = 5, pathPrefix, ext }) {
    console.error(`[RAG Tool] rag_search: "${query}" (topK=${topK})`);

    // Validate and sanitize
    if (!query || typeof query !== 'string') {
        throw new Error('Query must be a non-empty string');
    }

    const validTopK = Math.min(Math.max(parseInt(topK) || 5, 1), 20);

    try {
        const result = await ragHybridSearch({
            query,
            topK: validTopK,
            pathPrefix,
            ext,
            rerank: true,
            mmr: true,
            mmrLambda: 0.7
        });

        console.error(`[RAG Tool] Found ${result.results.length} results`);

        // No results
        if (result.results.length === 0) {
            return `# Search Results for: "${query}"\n\nNo results found.\n\n**Try:**\n- Broader query terms\n- Different keywords\n- Removing filters (pathPrefix, ext)`;
        }

        // Format as Markdown
        let formatted = `# Search Results for: "${query}"\n\n`;
        formatted += `Found **${result.results.length}** relevant code chunks\n\n`;
        formatted += `**Search Method:** Hybrid (Vector + FTS) with Reranking + MMR\n`;
        formatted += `**Model:** ${result.model} (${result.dim}D)\n\n`;
        formatted += `---\n\n`;

        for (const [idx, r] of result.results.entries()) {
            formatted += `## [${idx + 1}] ${r.path}:${r.start_line}-${r.end_line}\n\n`;

            // Metadata
            formatted += `**Relevance Score:** ${r.rerank_score?.toFixed(3) || r.score.toFixed(3)}\n`;
            formatted += `**Language:** ${r.language || 'unknown'}\n`;

            if (r.rerank_signals && typeof r.rerank_signals.semantic === 'number') {
                formatted += `**Signals:** semantic=${r.rerank_signals.semantic.toFixed(2)} `;
                formatted += `lexical=${r.rerank_signals.lexical.toFixed(2)} `;
                formatted += `recency=${r.rerank_signals.recency.toFixed(2)}\n`;
            }

            formatted += `\n`;

            // Code with syntax highlighting
            formatted += `\`\`\`${r.language || 'text'}\n`;
            formatted += r.text;
            if (!r.text.endsWith('\n')) {
                formatted += '\n';
            }
            formatted += `\`\`\`\n\n`;

            formatted += `---\n\n`;
        }

        // Cache stats
        const cacheStats = getRagCacheStats();
        if (cacheStats.hits > 0) {
            const hitRate = (cacheStats.hitRate * 100).toFixed(1);
            const savedMs = (cacheStats.hits * 200).toFixed(0);
            formatted += `\n*💾 Cache: ${cacheStats.hits} hits, ${cacheStats.misses} misses (${hitRate}% hit rate, saved ~${savedMs}ms)*\n`;
        }

        return formatted;
    } catch (error) {
        console.error('[RAG Tool] rag_search error:', error);
        throw new Error(`RAG search failed: ${error.message}`);
    }
}

/**
 * rag_health tool: RAG system health check
 *
 * Checks the health of all RAG components:
 * - LanceDB (vector database)
 * - Ollama (embedding model)
 * - Cache statistics
 *
 * @returns {Promise<string>} Formatted Markdown health report
 */
async function ragHealthHandler() {
    console.error('[RAG Tool] rag_health check...');

    try {
        const health = await ragHealth();
        const cacheStats = getRagCacheStats();

        let status = '# RAG System Health\n\n';

        // Overall status
        status += `**Overall Status:** ${health.ok ? '✅ OK' : '❌ FAILED'}\n\n`;

        // Components
        status += `## Components\n\n`;
        status += `- **Directories:** ${health.writable ? '✅' : '❌'} ${health.writable ? 'Writable' : 'Not writable'}\n`;
        status += `- **Manifest:** ${health.manifest_ok ? '✅' : '❌'} ${health.manifest_ok ? 'Valid' : 'Invalid/Missing'}\n`;
        status += `- **Ollama:** ${health.ollama.ok ? '✅' : '❌'} ${health.ollama.ok ? 'Connected' : 'Unreachable'}\n`;
        status += `- **Embedding Model:** ${health.ollama.hasModel ? '✅' : '❌'} ${health.ollama.model || 'Not found'}\n`;
        status += `- **LanceDB:** ${health.lancedb.ok ? '✅' : '❌'} ${health.lancedb.ok ? 'Accessible' : 'Error'}\n\n`;

        // Available models
        if (health.ollama.models && health.ollama.models.length > 0) {
            status += `## Available Ollama Models\n\n`;
            for (const model of health.ollama.models) {
                status += `- ${model}\n`;
            }
            status += `\n`;
        }

        // Cache statistics
        status += `## Cache Statistics\n\n`;
        status += `- **Size:** ${cacheStats.size}/${cacheStats.maxSize} entries\n`;
        status += `- **Hits:** ${cacheStats.hits}\n`;
        status += `- **Misses:** ${cacheStats.misses}\n`;
        status += `- **Hit Rate:** ${(cacheStats.hitRate * 100).toFixed(1)}%\n`;

        if (cacheStats.hits > 0) {
            const savedMs = (cacheStats.hits * 200).toFixed(0);
            status += `- **Efficiency:** Saved ${cacheStats.hits} embedding calls (~${savedMs}ms)\n`;
        }

        return status;
    } catch (error) {
        console.error('[RAG Tool] rag_health error:', error);
        throw new Error(`RAG health check failed: ${error.message}`);
    }
}

/**
 * Register RAG tools in the Tool Registry
 *
 * @param {ToolRegistry} registry - Tool registry instance
 */
export async function registerRagTools(registry) {
    console.error('[RAG Tools] Registering tools...');

    // rag_search
    registry.register(
        'rag_search',
        {
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
                        description: 'The search query (supports natural language and exact terms)'
                    },
                    topK: {
                        type: 'number',
                        description: 'Number of results to return (default: 5, max: 20)',
                        default: 5
                    },
                    pathPrefix: {
                        type: 'string',
                        description: 'Optional: Only search in files under this path (e.g., "src/kernel")'
                    },
                    ext: {
                        type: 'string',
                        description: 'Optional: Only search files with this extension (e.g., ".js", ".mjs")'
                    }
                },
                required: ['query']
            }
        },
        ragSearchHandler
    );

    // rag_health
    registry.register(
        'rag_health',
        {
            description: 'Check RAG system health (database, Ollama, cache stats)',
            inputSchema: {
                type: 'object',
                properties: {}
            }
        },
        ragHealthHandler
    );

    console.error('[RAG Tools] Registered 2 tools: rag_search, rag_health');
}
