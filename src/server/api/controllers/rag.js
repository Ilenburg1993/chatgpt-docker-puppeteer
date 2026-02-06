/**
 * RAG API Controller
 * 
 * Expõe o sistema RAG via REST API para acesso de LLMs externas
 * (OpenCode, Claude, Copilot, Codex, etc.)
 * 
 * Endpoints:
 * - POST /api/rag/ask - Busca semântica com formato Markdown
 * - POST /api/rag/query - Busca raw com resultados estruturados
 * - GET /api/rag/health - Health check do sistema RAG
 * - POST /api/rag/index - Trigger reindexação em background
 */

import {
    ragHealth,
    ragQuery,
    ragAsk,
    ragIndex,
    ragHybridSearch,
    getRagCacheStats
} from '../../../../tools/rag/lib/facade.mjs';

/**
 * POST /api/rag/ask
 * Busca semântica com output formatado em Markdown
 * 
 * Body: { query, topK?, pathPrefix?, ext?, tags? }
 * Response: { success, markdown, chunks, metadata }
 */
export async function handleRagAsk(req, res) {
  try {
    const { query, topK = 8, pathPrefix, ext, tags } = req.body;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Missing or invalid "query" parameter (string required)'
      });
    }

    const result = await ragAsk({
      query,
      topK: Number(topK),
      pathPrefix,
      ext: ext ? (Array.isArray(ext) ? ext : [ext]) : undefined,
      tags: tags ? (Array.isArray(tags) ? tags : [tags]) : undefined
    });

    return res.json({
      success: true,
      markdown: result.markdown,
      chunks: result.result.results.length,
      metadata: {
        query,
        topK: result.result.topK,
        dim: result.result.dim,
        timestamp: Date.now()
      }
    });
  } catch (error) {
    console.error('[RAG API] handleRagAsk error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      code: error.code || 'RAG_ASK_ERROR'
    });
  }
}

/**
 * POST /api/rag/query
 * Busca raw com resultados estruturados (sem formatação Markdown)
 * 
 * Body: { query, topK?, filters? }
 * Response: { success, results: [{ path, score, startLine, endLine, text, language, tags }] }
 */
export async function handleRagQuery(req, res) {
  try {
    const { query, topK = 8, filters = {} } = req.body;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Missing or invalid "query" parameter (string required)'
      });
    }

    const result = await ragQuery({
      query,
      topK: Number(topK),
      filters
    });

    return res.json({
      success: true,
      results: result.results.map(r => ({
        path: r.path,
        score: r._distance,
        startLine: r.start_line,
        endLine: r.end_line,
        text: r.text,
        language: r.language || null,
        tags: r.tags || [],
        ext: r.ext
      })),
      metadata: {
        query,
        topK: result.topK,
        dim: result.dim,
        timestamp: Date.now()
      }
    });
  } catch (error) {
    console.error('[RAG API] handleRagQuery error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      code: error.code || 'RAG_QUERY_ERROR'
    });
  }
}

/**
 * GET /api/rag/health
 * Health check do sistema RAG
 * 
 * Response: { ok, writable, manifest_ok, ollama: { ok, hasModel, models }, lancedb: { ok } }
 */
export async function handleRagHealth(req, res) {
  try {
    const health = await ragHealth();
    return res.json({
      ...health,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('[RAG API] handleRagHealth error:', error);
    return res.status(500).json({
      success: false,
      ok: false,
      error: error.message,
      code: error.code || 'RAG_HEALTH_ERROR'
    });
  }
}

/**
 * POST /api/rag/index
 * Trigger reindexação do workspace em background
 * 
 * Body: { root? }
 * Response: { success, message }
 * 
 * IMPORTANTE: Indexação roda em background (não bloqueia response)
 */
export async function handleRagIndex(req, res) {
  try {
    const { root } = req.body;

    // Inicia indexação em background (não aguarda conclusão)
    ragIndex({ root })
      .then(() => {
        console.log('[RAG API] Background indexing completed successfully');
      })
      .catch(err => {
        console.error('[RAG API] Background indexing failed:', err);
      });

    return res.json({
      success: true,
      message: 'RAG indexing started in background',
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('[RAG API] handleRagIndex error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      code: error.code || 'RAG_INDEX_ERROR'
    });
  }
}

/**
 * POST /api/rag/hybrid
 * Hybrid search (Vector + FTS + Reranking + MMR)
 *
 * Body: {
 *   query: string,
 *   topK?: number,
 *   pathPrefix?: string,
 *   ext?: string,
 *   tags?: string[],
 *   rerank?: boolean,
 *   rerankWeights?: object,
 *   mmr?: boolean,
 *   mmrLambda?: number
 * }
 *
 * Response: {
 *   success: boolean,
 *   results: Array<{
 *     path, score, distance, rerank_score?, rerank_signals?,
 *     start_line, end_line, text, language, tags
 *   }>,
 *   metadata: { topK, dim, model, query, hybridMode, rerank, mmr, mmrLambda }
 * }
 */
export async function handleRagHybridSearch(req, res) {
  try {
    const {
      query,
      topK = 8,
      pathPrefix,
      ext,
      tags,
      rerank = true,
      rerankWeights,
      mmr = true,
      mmrLambda = 0.7
    } = req.body;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Missing or invalid "query" parameter (string required)'
      });
    }

    const result = await ragHybridSearch({
      query,
      topK: Number(topK),
      pathPrefix,
      ext,
      tags: tags ? (Array.isArray(tags) ? tags : [tags]) : undefined,
      rerank,
      rerankWeights,
      mmr,
      mmrLambda: mmrLambda ? Number(mmrLambda) : 0.7
    });

    return res.json({
      success: true,
      results: result.results.map(r => ({
        path: r.path,
        score: r.score,
        distance: r.distance,
        rerank_score: r.rerank_score,
        rerank_signals: r.rerank_signals,
        start_line: r.start_line,
        end_line: r.end_line,
        text: r.text,
        language: r.language || null,
        tags: r.tags || [],
        ext: r.ext
      })),
      metadata: {
        query: result.query,
        topK: result.topK,
        dim: result.dim,
        model: result.model,
        hybridMode: result.hybridMode,
        rerank: result.rerank,
        mmr: result.mmr,
        mmrLambda: result.mmrLambda,
        timestamp: Date.now()
      }
    });
  } catch (error) {
    console.error('[RAG API] handleRagHybridSearch error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      code: error.code || 'RAG_HYBRID_SEARCH_ERROR'
    });
  }
}

/**
 * GET /api/rag/stats
 * Estatísticas do cache de embeddings
 *
 * Response: {
 *   success: boolean,
 *   stats: { size, maxSize, hits, misses, hitRate },
 *   timestamp: number
 * }
 */
export async function handleRagStats(req, res) {
  try {
    const stats = getRagCacheStats();

    return res.json({
      success: true,
      stats: {
        ...stats,
        hitRate: (stats.hitRate * 100).toFixed(2) + '%',
        efficiency: stats.hits > 0
          ? `Saved ${stats.hits} embedding calls (~${(stats.hits * 200).toFixed(0)}ms)`
          : 'No cache hits yet'
      },
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('[RAG API] handleRagStats error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      code: error.code || 'RAG_STATS_ERROR'
    });
  }
}
