// @ts-check - Type checking rigoroso habilitado (arquivo core)
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

import { log } from '#core/logger';
import {
    getRagCacheStats,
    ragAsk,
    ragHealth,
    ragHybridSearch,
    ragIndex,
    ragQuery,
} from '../../../../tools/rag/lib/facade.mjs';

/**
 * Handler para POST /api/rag/ask - Busca semântica com output em Markdown.
 *
 * **Side-effects:** Consulta cache RAG, pode executar busca vetorial.
 * **Semântica:** Formata resultados como documento Markdown coeso para LLMs.
 *
 * @param {object} req - Request Express
 * @param {object} req.body - Body com parâmetros de busca
 * @param {string} req.body.query - Query de busca obrigatória
 * @param {number} [req.body.topK=8] - Número máximo de chunks
 * @param {string} [req.body.pathPrefix] - Filtro por prefixo de caminho
 * @param {string|string[]} [req.body.ext] - Filtro por extensão de arquivo
 * @param {string|string[]} [req.body.tags] - Filtro por tags
 * @param {object} res - Response Express
 * @returns {Promise<void>}
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
    log.error('[RAG API] handleRagAsk error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      code: error.code || 'RAG_ASK_ERROR'
    });
  }
}

/**
 * Handler para POST /api/rag/query - Busca raw com resultados estruturados.
 *
 * **Side-effects:** Consulta cache RAG, pode executar busca vetorial.
 * **Semântica:** Retorna chunks estruturados sem formatação Markdown.
 *
 * @param {object} req - Request Express
 * @param {object} req.body - Body com parâmetros de busca
 * @param {string} req.body.query - Query de busca obrigatória
 * @param {number} [req.body.topK=8] - Número máximo de resultados
 * @param {object} [req.body.filters] - Filtros adicionais de busca
 * @param {object} res - Response Express
 * @returns {Promise<void>}
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
        score: r.score,
        startLine: r.start_line,
        endLine: r.end_line,
        text: r.text,
        language: r.language || null,
        tags: r.tags || [],
        ext: r.ext,
        indexed_at: r.indexed_at || null,
        indexed_at_iso: r.indexed_at_iso || null,
        indexed_at_local: r.indexed_at_local || null
      })),
      metadata: {
        query,
        topK: result.topK,
        dim: result.dim,
        index_mode: result.index_mode || 'full',
        index_freshness_ms: typeof result.index_freshness_ms === 'number' ? result.index_freshness_ms : null,
        index_updated_at_iso: result.index_updated_at_iso || null,
        query_at_iso: result.query_at_iso || null,
        timestamp: Date.now()
      }
    });
  } catch (error) {
    log.error('[RAG API] handleRagQuery error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      code: error.code || 'RAG_QUERY_ERROR'
    });
  }
}

/**
 * Handler para GET /api/rag/health - Health check do sistema RAG.
 *
 * **Side-effects:** Verifica conectividade com Ollama e LanceDB.
 * **Semântica:** Status operacional completo do sistema RAG.
 *
 * @param {object} req - Request Express
 * @param {object} res - Response Express
 * @returns {Promise<void>}
 */
export async function handleRagHealth(req, res) {
  try {
    const health = await ragHealth();
    return res.json({
      ...health,
      timestamp: Date.now()
    });
  } catch (error) {
    log.error('[RAG API] handleRagHealth error:', error);
    return res.status(500).json({
      success: false,
      ok: false,
      error: error.message,
      code: error.code || 'RAG_HEALTH_ERROR'
    });
  }
}

/**
 * Handler para POST /api/rag/index - Trigger reindexação em background.
 *
 * **Side-effects:** Inicia processo de indexação assíncrono (não bloqueante).
 * **Semântica:** Reindexa workspace completo para atualizar cache RAG.
 *
 * @param {object} req - Request Express
 * @param {object} [req.body] - Body opcional
 * @param {string} [req.body.root] - Diretório raiz para indexação
 * @param {object} res - Response Express
 * @returns {Promise<void>}
 */
export async function handleRagIndex(req, res) {
  try {
    const { root } = req.body;

    // Inicia indexação em background (não aguarda conclusão)
    ragIndex({ root })
      .then(() => {
        log.info('[RAG API] Background indexing completed successfully');
      })
      .catch(err => {
        log.error('[RAG API] Background indexing failed:', err);
      });

    return res.json({
      success: true,
      message: 'RAG indexing started in background',
      timestamp: Date.now()
    });
  } catch (error) {
    log.error('[RAG API] handleRagIndex error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      code: error.code || 'RAG_INDEX_ERROR'
    });
  }
}

/**
 * Handler para POST /api/rag/hybrid - Busca híbrida (Vetor + FTS + Reranking + MMR).
 *
 * **Side-effects:** Executa busca vetorial, full-text search e reranking.
 * **Semântica:** Combina múltiplas estratégias de busca para máxima relevância.
 *
 * @param {object} req - Request Express
 * @param {object} req.body - Body com parâmetros de busca híbrida
 * @param {string} req.body.query - Query de busca obrigatória
 * @param {number} [req.body.topK] - Número máximo de resultados
 * @param {string} [req.body.pathPrefix] - Filtro por prefixo de caminho
 * @param {string} [req.body.ext] - Filtro por extensão
 * @param {string[]} [req.body.tags] - Filtro por tags
 * @param {boolean} [req.body.rerank] - Habilitar reranking
 * @param {object} [req.body.rerankWeights] - Pesos para reranking
 * @param {boolean} [req.body.mmr] - Habilitar MMR (Maximal Marginal Relevance)
 * @param {number} [req.body.mmrLambda] - Lambda para MMR
 * @param {object} res - Response Express
 * @returns {Promise<void>}
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
        ext: r.ext,
        indexed_at: r.indexed_at || null,
        indexed_at_iso: r.indexed_at_iso || null,
        indexed_at_local: r.indexed_at_local || null
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
        index_mode: result.index_mode || 'full',
        index_freshness_ms: typeof result.index_freshness_ms === 'number' ? result.index_freshness_ms : null,
        index_updated_at_iso: result.index_updated_at_iso || null,
        query_at_iso: result.query_at_iso || null,
        timestamp: Date.now()
      }
    });
  } catch (error) {
    log.error('[RAG API] handleRagHybridSearch error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      code: error.code || 'RAG_HYBRID_SEARCH_ERROR'
    });
  }
}

/**
 * Handler para GET /api/rag/stats - Estatísticas do cache de embeddings.
 *
 * **Side-effects:** Lê estatísticas do cache RAG.
 * **Semântica:** Métricas de performance e eficiência do sistema de cache.
 *
 * @param {object} req - Request Express
 * @param {object} res - Response Express
 * @returns {Promise<void>}
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
    log.error('[RAG API] handleRagStats error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      code: error.code || 'RAG_STATS_ERROR'
    });
  }
}
