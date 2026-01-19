/* ==========================================================================
   src/server/api/router.js
   Audit Level: 700 — Sovereign API Gateway (Singularity Edition)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Ponto central de roteamento do Mission Control Prime. 
                     Orquestra a hierarquia de namespaces e sela a malha de 
                     proteção (Error Boundary) da API.
   Sincronizado com: controllers/tasks.js V700, controllers/system.js V700,
                     controllers/dna.js V700, middleware/error_handler.js V600.
========================================================================== */

const tasksController = require('./controllers/tasks');
const systemController = require('./controllers/system');
const dnaController = require('./controllers/dna');
const { notFound, errorHandler } = require('../middleware/error_handler');
const { log } = require('../../core/logger');

/**
 * Aplica a malha de rotas à instância do Express.
 * Define a topologia lógica da API e injeta os escudos de integridade.
 * 
 * @param {object} app - Instância do Express vinda de engine/app.js.
 */
function applyRoutes(app) {
    log('INFO', '[GATEWAY] Selando malha de rotas V700 (Consolidação Total)...');

    /* --------------------------------------------------------------------------
       1. MAPEAMENTO DE DOMÍNIOS SOBERANOS
    -------------------------------------------------------------------------- */

    /**
     * DOMÍNIO DE MISSÃO (Tarefas, Fila e Artefatos)
     * Namespace: /api/tasks, /api/queue, /api/results
     * Responsável pelo ciclo de vida das intenções de execução e download de .txt.
     */
    app.use('/api/tasks', tasksController);
    app.use('/api/queue', tasksController);   // Alias para operações bulk de fila
    app.use('/api/results', tasksController); // Alias para recuperação de respostas

    /**
     * DOMÍNIO DE SISTEMA E OBSERVABILIDADE (Agentes e Infraestrutura)
     * Namespace: /api/system
     * Responsável pelo inventário IPC 2.0 (/agents), saúde (Doctor) e processos.
     */
    app.use('/api/system', systemController); 

    /**
     * DOMÍNIO DE INTELIGÊNCIA E CONFIGURAÇÃO (DNA e Parâmetros)
     * Namespace: /api/config
     * Responsável pela evolução do genoma (SADI) e controle do config.json.
     */
    app.use('/api/config', dnaController);

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

module.exports = { applyRoutes };