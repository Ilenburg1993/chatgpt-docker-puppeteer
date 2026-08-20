// @ts-check
import { probeChromeConnection } from '#core/doctor';
import { log } from '#core/logger';
import { apiLimiter } from '#server/engine/app';
// L53.16: copilot imports removidos — copilot é ferramenta DEV-only com boot standalone (terminal:llm-b :3009)
import denyIfDelegated from '../middleware/deny_if_delegated.js';
import { errorHandler, notFound } from '../middleware/error_handler.js';
import artifactsController from './controllers/artifacts.js';
import controlController from './controllers/control.js';
import dashboardController from './controllers/dashboard.js';
import dnaController from './controllers/dna.js';
import * as healthController from './controllers/health.js';
import * as metricsController from './controllers/metrics.js';
import missionsController from './controllers/missions.js';
import * as ragController from './controllers/rag.js';
import resultsController from './controllers/results.js';
import systemController from './controllers/system.js';
// L53.16: copilot routes removidos — copilot é ferramenta DEV-only com boot standalone via terminal:llm-b (:3009)
import tasksController from './controllers/tasks.js';

/** @typedef {import('express').Express} ExpressAppLike */

/**
 * Aplica a malha de rotas à instância do Express. Define a topologia lógica da API e injeta os escudos de integridade.
 *
 * @param {ExpressAppLike} app - Instância do Express vinda de engine/app.js
 * @returns {Promise<void>}
 * @throws {Error} - Se algum controller falhar ao inicializar
 * @sideEffects - Registra rotas HTTP, middlewares, handlers de erro
 */
async function applyRoutes(app) {
    log('INFO', '[GATEWAY] Selando malha de rotas V700 (Consolidação Total)...');

    // FIXED (P1-14): Global request timeout middleware (30s default)
    // Previne requests órfãos que bloqueiam workers indefinidamente
    const REQUEST_TIMEOUT_MS = parseInt(process.env['API_REQUEST_TIMEOUT'] || '30000', 10);
    app.use((/** @type {any} */ req, /** @type {any} */ res, /** @type {any} */ next) => {
        // Set timeout on the request
        req.setTimeout(REQUEST_TIMEOUT_MS, () => {
            if (!res.headersSent) {
                log('WARN', `[API] Request timeout after ${REQUEST_TIMEOUT_MS}ms: ${req.method} ${req.path}`, req.id);
                res.status(504).json({
                    success: false,
                    error: 'Request timeout',
                    message: `Request exceeded ${REQUEST_TIMEOUT_MS}ms limit`,
                    request_id: req.id,
                });
            }
        });

        // Also set timeout on the response
        res.setTimeout(REQUEST_TIMEOUT_MS);

        next();
    });

    // Bloqueio global para métodos mutantes quando o server roda em modo delegated.
    // Evita duplicar checks em todos os controllers: usa o middleware central `denyIfDelegated`.
    app.use((/** @type {any} */ req, /** @type {any} */ res, /** @type {any} */ next) => {
        const MUTATING = ['POST', 'PUT', 'DELETE', 'PATCH'];
        try {
            if (MUTATING.includes(req.method)) {
                return denyIfDelegated(req, res, next);
            }
        } catch (/** @type {any} */ err) {
            const _e = /** @type {any} */ (err);
            log('WARN', `[GATEWAY] Falha no guard mutante: ${_e.message}`);
        }
        return next();
    });
    /* --------------------------------------------------------------------------
       0. ENDPOINTS DE SAÚDE E MÉTRICAS (delegados a controllers)
       Nota: lógica pesada foi extraída para controllers/infra para melhorar testabilidade
    -------------------------------------------------------------------------- */

    // Health endpoints
    // GET /api/health
    app.get('/api/health', async (/** @type {any} */ req, /** @type {any} */ res) => {
        try {
            const chrome = await probeChromeConnection();
            res.json({ success: true, ts: Date.now(), chrome, request_id: req.id });
        } catch (/** @type {any} */ err) {
            const _e = /** @type {any} */ (err);
            res.status(503).json({
                success: false,
                ts: Date.now(),
                chrome: { connected: false, error: _e?.message || String(err) },
                request_id: req.id,
            });
        }
    });
    app.get('/api/health/chrome', healthController.getChromeHealth);
    app.get('/api/health/pm2', healthController.getPm2Health);
    app.get('/api/health/kernel', healthController.getKernelHealth);
    app.get('/api/health/disk', healthController.getDiskHealth);
    app.get('/api/health/events', healthController.getEventsHealth);

    // Metrics endpoint (delegado a `controllers/metrics.js`)
    app.get('/api/metrics', metricsController.getMetrics);
    app.get('/api/metrics/tasks', metricsController.getTaskMetrics);

    /* --------------------------------------------------------------------------
       1. MAPEAMENTO DE DOMÍNIOS SOBERANOS
    -------------------------------------------------------------------------- */

    /**
     * DOMÍNIO DE MISSÃO (Tarefas, Fila e Artefatos) Namespace: /api/tasks, /api/queue, /api/results Responsável pelo
     * ciclo de vida das intenções de execução e download de .txt.
     */
    app.use('/api/tasks', apiLimiter, tasksController);
    app.use('/api/queue', apiLimiter, tasksController); // Alias para operações bulk de fila
    app.use('/api/results', apiLimiter, resultsController); // Download/stream de resultados
    app.use('/api/artifacts', apiLimiter, artifactsController);

    /**
     * DOMÍNIO DE SISTEMA E OBSERVABILIDADE (Agentes e Infraestrutura) Namespace: /api/system Responsável pelo
     * inventário IPC 2.0 (/agents), saúde (Doctor) e processos.
     */
    app.use('/api/system', apiLimiter, systemController);

    /**
     * DOMÍNIO DE INTELIGÊNCIA E CONFIGURAÇÃO (DNA e Parâmetros) Namespace: /api/config Responsável pela evolução do
     * genoma (SADI) e controle do config.json.
     */
    // Protege todas as rotas de configuração contra mutações quando em modo delegated
    app.use('/api/config', apiLimiter, denyIfDelegated, dnaController);

    /**
     * DOMÍNIO DE MISSÕES (Mission Orchestration Platform V2.0) Namespace: /api/missions Responsável por orquestração de
     * missões multi-step com workflows dinâmicos. Inclui: MissionManager, WorkflowGenerator, templates, execution
     * control.
     */
    app.use('/api/missions', apiLimiter, missionsController);

    /**
     * DOMÍNIO CONTROL PLANE (SSOT mutações) Namespace: /api/control Responsável por comando único de mutações
     * auditáveis de missão/task.
     */
    app.use('/api/control', apiLimiter, controlController);

    /**
     * DOMÍNIO DO DASHBOARD V2 (Mission Control Enterprise) Namespace: /api/dashboard Responsável por APIs estendidas de
     * tasks, telemetria, alertas e health. Inclui: TaskSyncBridge, TelemetryAggregator, Sistema de Alertas.
     */
    app.use('/api/dashboard', apiLimiter, dashboardController);

    /**
     * DOMÍNIO RAG (Retrieval-Augmented Generation) Namespace: /api/rag Responsável por busca semântica no codebase via
     * LanceDB + Ollama. Permite que LLMs externas (OpenCode, Claude, Copilot) acessem o código. Inclui: Semantic
     * search, hybrid search (vector + FTS + reranking + MMR), health check, indexing trigger, cache statistics.
     */
    app.post('/api/rag/ask', apiLimiter, ragController.handleRagAsk);
    app.post('/api/rag/query', apiLimiter, ragController.handleRagQuery);
    app.post('/api/rag/hybrid', apiLimiter, ragController.handleRagHybridSearch);
    app.get('/api/rag/health', apiLimiter, ragController.handleRagHealth);
    app.get('/api/rag/stats', apiLimiter, ragController.handleRagStats);
    app.post('/api/rag/index', apiLimiter, ragController.handleRagIndex);

    /**
     * MCP INTEGRATION (Model Context Protocol - Multi-LLM Tool Server) Namespace: /api/mcp Expõe Tool Registry via MCP
     * Streamable HTTP para todas as LLMs:
     *
     * - Claude Desktop
     * - GitHub Copilot
     * - OpenCode CLI
     * - Cursor/Codex (via HTTP fallback)
     *
     * Tools disponíveis:
     *
     * - rag_search: Hybrid semantic search (Vector + FTS + Reranking + MMR)
     * - rag_health: RAG system health check
     * - rag_expand: Expand chunk context by chunk_id
     * - ollama_generate: Text generation (cloud-first, with optional local fallback)
     * - ollama_embed: Generate embeddings for arbitrary text
     * - ollama_models: List all available Ollama models
     *
     * Protocolo: MCP Streamable HTTP (JSON-RPC 2.0 over HTTP)
     */
    if (process.env['MCP_ENABLED'] === 'true') {
        log('INFO', '[MCP] MCP_ENABLED=true, setting up MCP handler...');
        try {
            // Dynamic import to avoid loading if MCP is disabled
            const { setupMCPHandler } = await import('../handlers/mcp-handler.js');
            const { registry, initialize } = await import('../../../src/integration/tool-registry.mjs');

            // Wait for registry initialization (prevents race condition)
            log('INFO', '[MCP] Waiting for Tool Registry initialization...');
            await initialize();

            // Setup MCP handler with Tool Registry (now guaranteed to be initialized)
            setupMCPHandler(app, registry);

            // Observability hooks for /ready and troubleshooting.
            try {
                const toolCount = typeof registry?.getToolNames === 'function' ? registry.getToolNames().length : null;
                app.locals = app.locals || {};
                app.locals['mcp'] = {
                    enabled: true,
                    ready: true,
                    toolCount,
                    lastInitAt: new Date().toISOString(),
                    lastInitError: null,
                };

                app.locals['runtimeReadiness'] = Object.assign({}, app.locals['runtimeReadiness'] || null, {
                    mcp: true,
                });
            } catch (/** @type {any} */ e) {
                // Non-fatal observability failure
            }

            // Expose upstream status dynamically (if upstream-manager is present).
            try {
                const { getUpstreamStatus } = /** @type {{ getUpstreamStatus?: () => { upstreams?: unknown[] } }} */ (
                    await import('../../integration/mcp/upstream-manager.mjs').catch(() => ({}))
                );
                if (typeof getUpstreamStatus === 'function') {
                    app.locals = app.locals || {};
                    app.locals['getMcpUpstreamsStatus'] = () => getUpstreamStatus().upstreams;
                }
            } catch (/** @type {any} */ e) {
                // noop
            }

            log('INFO', '[MCP] Handler registered at POST/GET /api/mcp');
        } catch (/** @type {any} */ error) {
            const _e = /** @type {any} */ (error);
            log('ERROR', `[MCP] Failed to setup MCP handler: ${_e.message}`);
            log('WARN', '[MCP] MCP features will be unavailable');
            // Don't crash server, just disable MCP
            try {
                app.locals = app.locals || {};
                app.locals['mcp'] = {
                    enabled: true,
                    ready: false,
                    toolCount: null,
                    lastInitAt: new Date().toISOString(),
                    lastInitError: error && _e.message ? _e.message : String(error),
                };
                app.locals['runtimeReadiness'] = Object.assign({}, app.locals['runtimeReadiness'] || null, {
                    mcp: false,
                });
            } catch (/** @type {any} */ e) {
                // noop
            }
        }
    } else {
        log('INFO', '[MCP] MCP_ENABLED=false, skipping MCP handler setup');
        try {
            app.locals = app.locals || {};
            app.locals['mcp'] = {
                enabled: false,
                ready: false,
                toolCount: null,
                lastInitAt: new Date().toISOString(),
                lastInitError: null,
            };
            app.locals['runtimeReadiness'] = Object.assign({}, app.locals['runtimeReadiness'] || null, { mcp: false });
        } catch (/** @type {any} */ e) {
            // noop
        }
    }

    // ========================================================================
    // [4] OPENAI-COMPATIBLE API (v1/chat/completions for GitHub Copilot)
    // ========================================================================
    if (process.env['OPENAI_COMPATIBLE_ENABLED'] === 'true') {
        log('INFO', '[OpenAI] OPENAI_COMPATIBLE_ENABLED=true, setting up handler...');
        try {
            // Dynamic import to avoid loading if disabled
            const { setupOpenAIHandler } = await import('../handlers/openai-handler.js');

            // Setup handler (uses OllamaClient directly)
            setupOpenAIHandler(app);

            // Observability hooks
            try {
                app.locals = app.locals || {};
                app.locals['openai'] = {
                    enabled: true,
                    ready: true,
                    endpoints: ['/v1/chat/completions', '/v1/models'],
                    lastInitAt: new Date().toISOString(),
                };

                app.locals['runtimeReadiness'] = Object.assign({}, app.locals['runtimeReadiness'] || null, {
                    openai: true,
                });
            } catch (/** @type {any} */ e) {
                // Non-fatal observability failure
            }

            log('INFO', '[OpenAI] Handler registered at POST /v1/chat/completions, GET /v1/models');
        } catch (/** @type {any} */ error) {
            const _e = /** @type {any} */ (error);
            log('ERROR', `[OpenAI] Failed to setup handler: ${_e.message}`);
            log('WARN', '[OpenAI] OpenAI-compatible features will be unavailable');

            // Don't crash server, just disable feature
            try {
                app.locals = app.locals || {};
                app.locals['openai'] = {
                    enabled: true,
                    ready: false,
                    lastInitAt: new Date().toISOString(),
                    lastInitError: _e.message,
                };
                app.locals['runtimeReadiness'] = Object.assign({}, app.locals['runtimeReadiness'] || null, {
                    openai: false,
                });
            } catch (/** @type {any} */ e) {
                // noop
            }
        }
    } else {
        log('INFO', '[OpenAI] OPENAI_COMPATIBLE_ENABLED=false, skipping setup');
    }

    /* --------------------------------------------------------------------------
       2. ESCUDOS DE PROTEÇÃO (ERROR BOUNDARY)
       Estratégia: Garantir que nenhuma requisição órfã ou falha lógica escape
       do sistema sem um tratamento padronizado e rastreável.
    -------------------------------------------------------------------------- */

    // L53.16: Rotas /api/copilot, /api/sdk, /api/hub removidas.
    // Copilot é ferramenta DEV-only com boot standalone via terminal:llm-b (:3009).
    // Todas as APIs copilot são servidas pelo inject server do terminal.

    // Captura rotas inexistentes (404)
    app.use(notFound);

    // Captura e trata falhas de execução nos controladores (500)
    // Este middleware injeta o request_id na resposta final de erro.
    app.use(errorHandler);

    log('INFO', '[GATEWAY] Sincronia de namespaces e Error Boundary operacionais.');
}

export { applyRoutes };
