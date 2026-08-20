// @ts-check
/**
 * RAG API Controller
 *
 * Expõe o sistema RAG via REST API para acesso de LLMs externas (OpenCode, Claude, Copilot, Codex, etc.)
 *
 * Endpoints:
 *
 * - POST /api/rag/ask - Busca semântica com formato Markdown
 * - POST /api/rag/query - Busca raw com resultados estruturados
 * - GET /api/rag/health - Health check do sistema RAG
 * - POST /api/rag/index - Trigger reindexação em background
 */

import { log } from '#core/logger';
import { asRecord } from '#types/guards';
import {
    getRagCacheStats,
    ragAsk,
    ragHealth,
    ragHybridSearch,
    ragIndex,
    ragQuery,
} from '../../../../tools/rag/lib/facade.mjs';
import { resolveRagScopeConfig } from '../../../../tools/rag/lib/scope_config.mjs';

/** @typedef {any} HandleRagAskReq */
/** @typedef {any} HandleRagAskRes */
/**
 * Handler para POST /api/rag/ask - Busca semântica com output em Markdown.
 *
 * **Side-effects:** Consulta cache RAG, pode executar busca vetorial. **Semântica:** Formata resultados como documento
 * Markdown coeso para LLMs.
 *
 * @param {HandleRagAskReq} req - Request Express
 * @param {object} req
 * @param {object} req.body
 * @param {string} req.body.query - Query de busca obrigatória
 * @param {number} [req.body.topK=8] - Número máximo de chunks. Default is `8`
 * @param {string} [req.body.pathPrefix] - Filtro por prefixo de caminho
 * @param {string | string[]} [req.body.ext] - Filtro por extensão de arquivo
 * @param {string | string[]} [req.body.tags] - Filtro por tags
 * @param {HandleRagAskRes} res - Response Express
 * @returns {Promise<void>}
 */
export async function handleRagAsk(req, res) {
    try {
        const { query, topK = 8, pathPrefix, ext, tags } = req.body;

        if (!query || typeof query !== 'string') {
            return res.status(400).json({
                success: false,
                error: 'Missing or invalid "query" parameter (string required)',
            });
        }

        const result = await ragAsk({
            query,
            topK: Number(topK),
            pathPrefix,
            ext: ext ? (Array.isArray(ext) ? ext : [ext]) : undefined,
            tags: tags ? (Array.isArray(tags) ? tags : [tags]) : undefined,
        });

        return res.json({
            success: true,
            markdown: result.markdown,
            chunks: /** @type {any} */ (result).result.results.length,
            metadata: {
                query,
                topK: /** @type {any} */ (result).result.topK,
                dim: /** @type {any} */ (result).result.dim,
                timestamp: Date.now(),
            },
        });
    } catch (/** @type {any} */ error) {
        const _e = /** @type {any} */ (error);
        log.error('[RAG API] handleRagAsk error:', error);
        return res.status(500).json({
            success: false,
            error: _e.message,
            code: _e.code || 'RAG_ASK_ERROR',
        });
    }
}

/** @typedef {any} HandleRagQueryReq */
/** @typedef {any} HandleRagQueryRes */
/**
 * Handler para POST /api/rag/query - Busca raw com resultados estruturados.
 *
 * **Side-effects:** Consulta cache RAG, pode executar busca vetorial. **Semântica:** Retorna chunks estruturados sem
 * formatação Markdown.
 *
 * @param {HandleRagQueryReq} req - Request Express
 * @param {object} req
 * @param {object} req.body
 * @param {string} req.body.query - Query de busca obrigatória
 * @param {number} [req.body.topK=8] - Número máximo de resultados. Default is `8`
 * @param {object} [req.body.filters] - Filtros adicionais de busca
 * @param {HandleRagQueryRes} res - Response Express
 * @returns {Promise<void>}
 */
export async function handleRagQuery(req, res) {
    try {
        const { query, topK = 8, filters = {} } = req.body;

        if (!query || typeof query !== 'string') {
            return res.status(400).json({
                success: false,
                error: 'Missing or invalid "query" parameter (string required)',
            });
        }

        const result = await ragQuery({
            query,
            topK: Number(topK),
            filters,
        });

        return res.json({
            success: true,
            results: /** @type {any} */ (result).results.map((/** @type {any} */ r) => ({
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
                indexed_at_local: r.indexed_at_local || null,
            })),
            metadata: {
                query,
                topK: /** @type {any} */ (result).topK,
                dim: /** @type {any} */ (result).dim,
                index_mode: /** @type {any} */ (result).index_mode || 'full',
                index_freshness_ms:
                    typeof (/** @type {any} */ (result).index_freshness_ms) === 'number'
                        ? /** @type {any} */ (result).index_freshness_ms
                        : null,
                index_updated_at_iso: /** @type {any} */ (result).index_updated_at_iso || null,
                last_index_scope: /** @type {any} */ (result).last_index_scope || null,
                scope_hash: /** @type {any} */ (result).scope_hash || null,
                query_at_iso: /** @type {any} */ (result).query_at_iso || null,
                timestamp: Date.now(),
            },
        });
    } catch (/** @type {any} */ error) {
        const _e = /** @type {any} */ (error);
        log.error('[RAG API] handleRagQuery error:', error);
        return res.status(500).json({
            success: false,
            error: _e.message,
            code: _e.code || 'RAG_QUERY_ERROR',
        });
    }
}

/** @typedef {any} HandleRagHealthReq */
/** @typedef {any} HandleRagHealthRes */
/**
 * Handler para GET /api/rag/health - Health check do sistema RAG.
 *
 * **Side-effects:** Verifica conectividade com Ollama e LanceDB. **Semântica:** Status operacional completo do sistema
 * RAG.
 *
 * @param {HandleRagHealthReq} _req - Request Express
 * @param {HandleRagHealthRes} res - Response Express
 * @returns {Promise<void>}
 */
export async function handleRagHealth(_req, res) {
    try {
        const health = await ragHealth();
        return res.json({
            .../** @type {any} */ (health),
            timestamp: Date.now(),
        });
    } catch (/** @type {any} */ error) {
        const _e = /** @type {any} */ (error);
        log.error('[RAG API] handleRagHealth error:', error);
        return res.status(500).json({
            success: false,
            ok: false,
            error: _e.message,
            code: _e.code || 'RAG_HEALTH_ERROR',
        });
    }
}

/** @typedef {any} HandleRagIndexReq */
/** @typedef {any} HandleRagIndexRes */
/**
 * Handler para POST /api/rag/index - Trigger reindexação em background.
 *
 * **Side-effects:** Inicia processo de indexação assíncrono (não bloqueante). **Semântica:** Reindexa workspace
 * completo para atualizar cache RAG.
 *
 * @param {HandleRagIndexReq} req - Request Express
 * @param {object} req
 * @param {object} req.body
 * @param {string} [req.body.root] - Diretório raiz para indexação
 * @param {HandleRagIndexRes} res - Response Express
 * @returns {Promise<void>}
 */
export async function handleRagIndex(req, res) {
    try {
        const body = asRecord(req.body || {});
        const { root, profile, includeGlobs, excludeGlobs, docsMode, maxFileBytes } = body;

        const normalizedIncludeGlobs = Array.isArray(includeGlobs)
            ? includeGlobs
            : typeof includeGlobs === 'string' && includeGlobs.trim()
              ? [includeGlobs.trim()]
              : undefined;
        const normalizedExcludeGlobs = Array.isArray(excludeGlobs)
            ? excludeGlobs
            : typeof excludeGlobs === 'string' && excludeGlobs.trim()
              ? [excludeGlobs.trim()]
              : undefined;
        const normalizedMaxFileBytes = Number.isFinite(Number(maxFileBytes)) ? Number(maxFileBytes) : undefined;
        const resolvedScope = resolveRagScopeConfig({
            profile,
            includeGlobs: normalizedIncludeGlobs,
            excludeGlobs: normalizedExcludeGlobs,
            docsMode,
            maxFileBytes: normalizedMaxFileBytes,
        });

        // Inicia indexação em background (não aguarda conclusão)
        ragIndex({
            root,
            profile: resolvedScope.profile,
            includeGlobs: resolvedScope.includeGlobs,
            excludeGlobs: resolvedScope.excludeGlobs,
            docsMode: resolvedScope.docsMode,
            maxFileBytes: resolvedScope.maxFileBytes,
        })
            .then(() => {
                log.info('[RAG API] Background indexing completed successfully');
            })
            .catch((err) => {
                log.error('[RAG API] Background indexing failed:', err);
            });

        return res.json({
            success: true,
            message: 'RAG indexing started in background',
            scope: resolvedScope.scope,
            timestamp: Date.now(),
        });
    } catch (/** @type {any} */ error) {
        const _e = /** @type {any} */ (error);
        log.error('[RAG API] handleRagIndex error:', error);
        return res.status(500).json({
            success: false,
            error: _e.message,
            code: _e.code || 'RAG_INDEX_ERROR',
        });
    }
}

/** @typedef {any} HandleRagHybridSearchReq */
/** @typedef {any} HandleRagHybridSearchRes */
/**
 * Handler para POST /api/rag/hybrid - Busca híbrida (Vetor + FTS + Reranking + MMR).
 *
 * **Side-effects:** Executa busca vetorial, full-text search e reranking. **Semântica:** Combina múltiplas estratégias
 * de busca para máxima relevância.
 *
 * @param {HandleRagHybridSearchReq} req - Request Express
 * @param {object} req
 * @param {object} req.body
 * @param {string} req.body.query - Query de busca obrigatória
 * @param {number} [req.body.topK] - Número máximo de resultados
 * @param {string} [req.body.pathPrefix] - Filtro por prefixo de caminho
 * @param {string} [req.body.ext] - Filtro por extensão
 * @param {string[]} [req.body.tags] - Filtro por tags
 * @param {boolean} [req.body.rerank] - Habilitar reranking
 * @param {object} [req.body.rerankWeights] - Pesos para reranking
 * @param {boolean} [req.body.mmr] - Habilitar MMR (Maximal Marginal Relevance)
 * @param {number} [req.body.mmrLambda] - Lambda para MMR
 * @param {HandleRagHybridSearchRes} res - Response Express
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
            mmrLambda = 0.7,
        } = req.body;

        if (!query || typeof query !== 'string') {
            return res.status(400).json({
                success: false,
                error: 'Missing or invalid "query" parameter (string required)',
            });
        }

        const result = await ragHybridSearch({
            query,
            topK: Number(topK),
            ...(pathPrefix !== undefined ? { pathPrefix } : {}),
            ...(ext !== undefined ? { ext } : {}),
            ...(tags !== undefined ? { tags: Array.isArray(tags) ? tags : [tags] } : {}),
            rerank,
            ...(rerankWeights !== undefined ? { rerankWeights } : {}),
            mmr,
            mmrLambda: mmrLambda ? Number(mmrLambda) : 0.7,
        });

        return res.json({
            success: true,
            results: result.results.map((/** @type {any} */ r) => ({
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
                indexed_at_local: r.indexed_at_local || null,
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
                index_freshness_ms:
                    typeof result.index_freshness_ms === 'number'
                        ? /** @type {any} */ (result).index_freshness_ms
                        : null,
                index_updated_at_iso: result.index_updated_at_iso || null,
                last_index_scope: result.last_index_scope || null,
                scope_hash: result.scope_hash || null,
                query_at_iso: result.query_at_iso || null,
                timestamp: Date.now(),
            },
        });
    } catch (/** @type {any} */ error) {
        const _e = /** @type {any} */ (error);
        log.error('[RAG API] handleRagHybridSearch error:', error);
        return res.status(500).json({
            success: false,
            error: _e.message,
            code: _e.code || 'RAG_HYBRID_SEARCH_ERROR',
        });
    }
}

/** @typedef {any} HandleRagStatsReq */
/** @typedef {any} HandleRagStatsRes */
/**
 * Handler para GET /api/rag/stats - Estatísticas do cache de embeddings.
 *
 * **Side-effects:** Lê estatísticas do cache RAG. **Semântica:** Métricas de performance e eficiência do sistema de
 * cache.
 *
 * @param {HandleRagStatsReq} _req - Request Express
 * @param {HandleRagStatsRes} res - Response Express
 * @returns {Promise<void>}
 */
export async function handleRagStats(_req, res) {
    try {
        const stats = getRagCacheStats();

        return res.json({
            success: true,
            stats: {
                ...stats,
                hitRate: (stats.hitRate * 100).toFixed(2) + '%',
                efficiency:
                    stats.hits > 0
                        ? `Saved ${stats.hits} embedding calls (~${(stats.hits * 200).toFixed(0)}ms)`
                        : 'No cache hits yet',
            },
            timestamp: Date.now(),
        });
    } catch (/** @type {any} */ error) {
        const _e = /** @type {any} */ (error);
        log.error('[RAG API] handleRagStats error:', error);
        return res.status(500).json({
            success: false,
            error: _e.message,
            code: _e.code || 'RAG_STATS_ERROR',
        });
    }
}
