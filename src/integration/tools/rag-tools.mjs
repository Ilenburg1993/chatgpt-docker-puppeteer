/**
 * RAG Tools for Tool Registry
 *
 * Wraps existing RAG v3.0 backend (tools/rag/lib/facade.mjs)
 * Implements tools for semantic code search and health checks
 *
 * Tools:
 * - rag_search: Hybrid/lexical semantic search (with degraded fallback)
 * - rag_health: RAG system health check (LanceDB, Ollama, cache)
 * - rag_expand: Context expansion by chunk_id (lines or symbol span)
 */

import {
    ragHybridSearch,
    ragHealth,
    ragExpand,
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
 * @param {'core'|'dev'|'full'} params.profile - RAG scan profile context
 * @param {'hybrid'|'lexical-only'|'auto'} params.mode - Search mode
 * @param {boolean} params.includeDiagnostics - Include diagnostic details in text output
 * @returns {Promise<{text:string,json?:any,flags:any}>} Structured tool result
 */
async function ragSearchHandler({
    query,
    topK = 5,
    pathPrefix,
    ext,
    profile,
    mode = 'auto',
    includeDiagnostics = false
}) {
    console.error(`[RAG Tool] rag_search: "${query}" (topK=${topK})`);

    // Validate and sanitize
    if (!query || typeof query !== 'string') {
        throw new Error('Query must be a non-empty string'); // eslint-disable-line preserve-caught-error
    }

    const validTopK = Math.min(Math.max(parseInt(topK) || 5, 1), 20);

    try {
        const result = await ragHybridSearch({
            query,
            topK: validTopK,
            profile,
            mode,
            pathPrefix,
            ext,
            rerank: true,
            mmr: true,
            mmrLambda: 0.7
        });

        console.error(`[RAG Tool] Found ${result.results.length} results`);

        // Format as Markdown
        let formatted = `# Search Results for: "${query}"\n\n`;
        formatted += `Found **${result.results.length}** relevant code chunks\n\n`;
        formatted += `**Search Method:** ${result.backend === 'lexical' ? 'Lexical (FTS)' : 'Hybrid (Vector + FTS)'}\n`;
        formatted += `**Model:** ${result.model} (${result.dim}D)\n`;
        formatted += `**Index Mode:** ${result.index_mode || 'full'}\n`;
        if (typeof result.index_freshness_ms === 'number') {
            formatted += `**Index Freshness:** ${result.index_freshness_ms}ms\n`;
        }
        if (result.index_updated_at_iso) {
            formatted += `**Index Updated At:** ${result.index_updated_at_iso}\n`;
        }
        formatted += '\n';

        if (result.degraded) {
            formatted += `⚠️ **Degraded Mode:** true (${result.reason_code || 'unknown'})\n\n`;
        }

        // No results
        if (result.results.length === 0) {
            formatted += `No results found.\n\n**Try:**\n- Broader query terms\n- Different keywords\n- Removing filters (pathPrefix, ext)\n\n`;
        }

        formatted += `---\n\n`;

        for (const [idx, r] of result.results.entries()) {
            formatted += `## [${idx + 1}] ${r.path}:${r.start_line}-${r.end_line}\n\n`;

            // Metadata
            formatted += `**Relevance Score:** ${r.rerank_score?.toFixed(3) || r.score.toFixed(3)}\n`;
            formatted += `**Language:** ${r.language || 'unknown'}\n`;
            formatted += `**Kind:** ${r.kind || 'module_fallback'}\n`;
            if (r.symbol) {
                formatted += `**Symbol:** ${r.symbol}\n`;
            }
            formatted += `**Exported:** ${r.exported ? 'true' : 'false'}\n`;
            if (r.indexed_at_iso) {
                formatted += `**Indexed At:** ${r.indexed_at_iso}\n`;
            }

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

        if (includeDiagnostics) {
            formatted += `\nDiagnostics:\n`;
            formatted += `- backend: ${result.backend}\n`;
            formatted += `- degraded: ${result.degraded ? 'true' : 'false'}\n`;
            formatted += `- index_mode: ${result.index_mode || 'full'}\n`;
            if (typeof result.index_freshness_ms === 'number') {
                formatted += `- index_freshness_ms: ${result.index_freshness_ms}\n`;
            }
            if (result.query_at_iso) {
                formatted += `- query_at_iso: ${result.query_at_iso}\n`;
            }
            if (result.reason_code) {
                formatted += `- reason_code: ${result.reason_code}\n`;
            }
            if (result.degraded_reason) {
                formatted += `- degraded_reason: ${result.degraded_reason}\n`;
            }
        }

        return {
            text: formatted,
            json: {
                query,
                topK: validTopK,
                profile: result.profile || profile || process.env.RAG_PROFILE_DEFAULT || 'core',
                mode,
                backend: result.backend || 'hybrid',
                degraded: Boolean(result.degraded),
                index_mode: result.index_mode || 'full',
                index_freshness_ms: typeof result.index_freshness_ms === 'number' ? result.index_freshness_ms : null,
                index_updated_at: result.index_updated_at || null,
                index_updated_at_iso: result.index_updated_at_iso || null,
                query_at: result.query_at || null,
                query_at_iso: result.query_at_iso || null,
                ...(result.reason_code ? { reason_code: result.reason_code } : {}),
                ...(result.degraded_reason ? { degraded_reason: result.degraded_reason } : {}),
                result_count: result.results.length,
                results: result.results.map((r) => ({
                    chunk_id: r.chunk_id,
                    path: r.path,
                    language: r.language || null,
                    kind: r.kind || 'module_fallback',
                    symbol: r.symbol || null,
                    exported: Boolean(r.exported),
                    start_line: r.start_line,
                    end_line: r.end_line,
                    header_text: r.header_text || null,
                    chunk_prev_id: r.chunk_prev_id || null,
                    chunk_next_id: r.chunk_next_id || null,
                    indexed_at: r.indexed_at || null,
                    indexed_at_iso: r.indexed_at_iso || null,
                    indexed_at_local: r.indexed_at_local || null
                }))
            },
            flags: {
                degraded: Boolean(result.degraded),
                mutating: false,
                partial: Boolean(result.degraded)
            }
        };
    } catch (error) {
        console.error('[RAG Tool] rag_search error:', error);
        throw new Error(`RAG search failed: ${error.message}`); // eslint-disable-line preserve-caught-error
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
        status += `- **Index Mode:** ${health.index_mode || 'full'}\n`;
        if (typeof health.index_freshness_ms === 'number') {
            status += `- **Index Freshness:** ${health.index_freshness_ms}ms\n`;
        }
        if (health.index_updated_at_iso) {
            status += `- **Index Updated At:** ${health.index_updated_at_iso}\n`;
        }
        status += '\n';

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
        throw new Error(`RAG health check failed: ${error.message}`); // eslint-disable-line preserve-caught-error
    }
}

async function ragExpandHandler({
    chunk_id,
    before_lines,
    after_lines,
    mode = 'lines'
}) {
    console.error(`[RAG Tool] rag_expand: chunk_id=${chunk_id} mode=${mode}`);

    const expanded = await ragExpand({
        chunkId: chunk_id,
        beforeLines: before_lines,
        afterLines: after_lines,
        mode
    });

    if (!expanded?.ok) {
        return {
            text: `RAG expand failed: ${expanded?.message || 'unknown error'}`,
            json: expanded,
            flags: {
                degraded: false,
                mutating: false,
                partial: true
            }
        };
    }

    let text = '# RAG Expand\n\n';
    text += `**Chunk ID:** ${expanded.chunk_id}\n`;
    text += `**Path:** ${expanded.path}\n`;
    text += `**Mode:** ${expanded.mode}\n`;
    text += `**Basis:** ${expanded.expansion_basis}\n`;
    text += `**Range:** ${expanded.range.start_line}-${expanded.range.end_line}\n`;
    text += `**Base Range:** ${expanded.base_range.start_line}-${expanded.base_range.end_line}\n`;
    text += `**Kind:** ${expanded.kind || 'module_fallback'}\n`;
    if (expanded.symbol) {
        text += `**Symbol:** ${expanded.symbol}\n`;
    }
    text += `**Exported:** ${expanded.exported ? 'true' : 'false'}\n`;
    if (expanded.indexed_at_iso) {
        text += `**Indexed At:** ${expanded.indexed_at_iso}\n`;
    }
    text += '\n';
    text += `\`\`\`${expanded.language || 'text'}\n`;
    text += expanded.text || '';
    if (expanded.text && !expanded.text.endsWith('\n')) {
        text += '\n';
    }
    text += '```\n';

    return {
        text,
        json: expanded,
        flags: {
            degraded: false,
            mutating: false,
            partial: false
        }
    };
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
                    },
                    profile: {
                        type: 'string',
                        enum: ['core', 'dev', 'full'],
                        default: process.env.RAG_PROFILE_DEFAULT || 'core',
                        description: 'Optional: RAG scope profile'
                    },
                    mode: {
                        type: 'string',
                        enum: ['hybrid', 'lexical-only', 'auto'],
                        default: 'auto',
                        description: 'Search mode (auto enables degraded fallback)'
                    },
                    includeDiagnostics: {
                        type: 'boolean',
                        default: false,
                        description: 'Include diagnostic fields in text output'
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

    registry.register(
        'rag_expand',
        {
            description: 'Expand a retrieved RAG chunk by neighboring lines or full symbol span',
            inputSchema: {
                type: 'object',
                properties: {
                    chunk_id: {
                        type: 'string',
                        description: 'Chunk identifier returned by rag_search'
                    },
                    before_lines: {
                        type: 'number',
                        default: Number(process.env.RAG_EXPAND_DEFAULT_LINES || 40),
                        description: 'Number of lines to include before base range'
                    },
                    after_lines: {
                        type: 'number',
                        default: Number(process.env.RAG_EXPAND_DEFAULT_LINES || 40),
                        description: 'Number of lines to include after base range'
                    },
                    mode: {
                        type: 'string',
                        enum: ['lines', 'symbol'],
                        default: 'lines',
                        description: 'Expansion mode: surrounding lines or full symbol scope'
                    }
                },
                required: ['chunk_id']
            }
        },
        ragExpandHandler
    );

    console.error('[RAG Tools] Registered 3 tools: rag_search, rag_health, rag_expand');
}
