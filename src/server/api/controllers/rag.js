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

import { ragHealth, ragQuery, ragAsk, ragIndex } from '../../../../tools/rag/lib/facade.mjs';

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
