import tasksController from './controllers/tasks.js';
import dashboardController from './controllers/dashboard.js';
import missionsController from './controllers/missions.js';
import systemController from './controllers/system.js';
import dnaController from './controllers/dna.js';
import { notFound, errorHandler } from '../middleware/error_handler.js';
import denyIfDelegated from '../middleware/deny_if_delegated.js';
import { log } from '#core/logger';
import { apiLimiter } from '#server/engine/app';
import * as healthController from './controllers/health.js';
import * as metricsController from './controllers/metrics.js';
import * as ragController from './controllers/rag.js';

/**
 * Aplica a malha de rotas à instância do Express.
 * Define a topologia lógica da API e injeta os escudos de integridade.
 *
 * @param {object} app - Instância do Express vinda de engine/app.js.
 */
function applyRoutes(app) {
    log('INFO', '[GATEWAY] Selando malha de rotas V700 (Consolidação Total)...');
    // Bloqueio global para métodos mutantes quando o server roda em modo delegated.
    // Evita duplicar checks em todos os controllers: usa o middleware central `denyIfDelegated`.
    app.use((req, res, next) => {
        const MUTATING = ['POST', 'PUT', 'DELETE', 'PATCH'];
        try {
            if (MUTATING.includes(req.method)) {
                return denyIfDelegated(req, res, next);
            }
        } catch (err) {
            log('WARN', `[GATEWAY] Falha no guard mutante: ${err.message}`);
        }
        return next();
    });
    /* --------------------------------------------------------------------------
       0. ENDPOINTS DE SAÚDE E MÉTRICAS (delegados a controllers)
       Nota: lógica pesada foi extraída para controllers/infra para melhorar testabilidade
    -------------------------------------------------------------------------- */

    // Health endpoints (delegam toda a lógica a `controllers/health.js`)
    app.get('/api/health', healthController.getHealth);
    app.get('/api/health/chrome', healthController.getChromeHealth);
    app.get('/api/health/pm2', healthController.getPm2Health);
    app.get('/api/health/kernel', healthController.getKernelHealth);
    app.get('/api/health/disk', healthController.getDiskHealth);

    // Metrics endpoint (delegado a `controllers/metrics.js`)
    app.get('/api/metrics', metricsController.getMetrics);

    /* --------------------------------------------------------------------------
       1. MAPEAMENTO DE DOMÍNIOS SOBERANOS
    -------------------------------------------------------------------------- */

    /**
     * DOMÍNIO DE MISSÃO (Tarefas, Fila e Artefatos)
     * Namespace: /api/tasks, /api/queue, /api/results
     * Responsável pelo ciclo de vida das intenções de execução e download de .txt.
     */
    app.use('/api/tasks', apiLimiter, tasksController);
    app.use('/api/queue', apiLimiter, tasksController); // Alias para operações bulk de fila
    app.use('/api/results', apiLimiter, tasksController); // Alias para recuperação de respostas

    /**
     * DOMÍNIO DE SISTEMA E OBSERVABILIDADE (Agentes e Infraestrutura)
     * Namespace: /api/system
     * Responsável pelo inventário IPC 2.0 (/agents), saúde (Doctor) e processos.
     */
    app.use('/api/system', apiLimiter, systemController);

    /**
     * DOMÍNIO DE INTELIGÊNCIA E CONFIGURAÇÃO (DNA e Parâmetros)
     * Namespace: /api/config
     * Responsável pela evolução do genoma (SADI) e controle do config.json.
     */
    // Protege todas as rotas de configuração contra mutações quando em modo delegated
    app.use('/api/config', apiLimiter, denyIfDelegated, dnaController);

    /**
     * DOMÍNIO DE MISSÕES (Mission Orchestration Platform V2.0)
     * Namespace: /api/missions
     * Responsável por orquestração de missões multi-step com workflows dinâmicos.
     * Inclui: MissionManager, WorkflowGenerator, templates, execution control.
     */
    app.use('/api/missions', apiLimiter, missionsController);

    /**
     * DOMÍNIO DO DASHBOARD V2 (Mission Control Enterprise)
     * Namespace: /api/dashboard
     * Responsável por APIs estendidas de tasks, telemetria, alertas e health.
     * Inclui: TaskSyncBridge, TelemetryAggregator, Sistema de Alertas.
     */
    app.use('/api/dashboard', apiLimiter, dashboardController);

    /**
     * DOMÍNIO RAG (Retrieval-Augmented Generation)
     * Namespace: /api/rag
     * Responsável por busca semântica no codebase via LanceDB + Ollama.
     * Permite que LLMs externas (OpenCode, Claude, Copilot) acessem o código.
     * Inclui: Semantic search, health check, indexing trigger.
     */
    app.post('/api/rag/ask', apiLimiter, ragController.handleRagAsk);
    app.post('/api/rag/query', apiLimiter, ragController.handleRagQuery);
    app.get('/api/rag/health', apiLimiter, ragController.handleRagHealth);
    app.post('/api/rag/index', apiLimiter, ragController.handleRagIndex);

    /* --------------------------------------------------------------------------
       2. ESCUDOS DE PROTEÇÃO (ERROR BOUNDARY)
       Estratégia: Garantir que nenhuma requisição órfã ou falha lógica escape
       do sistema sem um tratamento padronizado e rastreável.
    -------------------------------------------------------------------------- */

    // Captura rotas inexistentes (404)
    app.use(notFound);

    // Captura e trata falhas de execução nos controladores (500)
    // Este middleware injeta o request_id na resposta final de erro.
    app.use(errorHandler);

    log('INFO', '[GATEWAY] Sincronia de namespaces e Error Boundary operacionais.');
}

export { applyRoutes };
