/* ==========================================================================
   src/server/api/controllers/missions.js
   Mission API Controller (V2.0)
   Status: NEW (Mission Orchestration Platform)

   Responsabilidade:
     - REST APIs para gerenciamento de missões
     - CRUD operations (create, read, list, delete)
     - Execution control (execute, pause, resume)
     - Feedback injection
     - Progress tracking
========================================================================== */

const express = require('express');
const router = express.Router();

const { log } = require('@core/logger');

/**
 * IMPORTANTE: MissionManager será injetado via setter após boot
 * (evita circular dependency com Kernel/NERV)
 */
let missionManager = null;

/**
 * Setter para injetar MissionManager após inicialização.
 * Chamado por src/main.js durante boot sequence.
 *
 * @param {Object} manager - Instância do MissionManager
 */
function setMissionManager(manager) {
    if (!manager) {
        throw new Error('[MISSIONS_API] MissionManager inválido');
    }
    missionManager = manager;
    log('INFO', '[MISSIONS_API] MissionManager injetado com sucesso');
}

/**
 * Middleware para verificar se MissionManager está disponível.
 */
function requireMissionManager(req, res, next) {
    if (!missionManager) {
        return res.status(503).json({
            success: false,
            error: 'MissionManager não inicializado',
            message: 'Sistema ainda está inicializando ou MissionManager não foi configurado',
            request_id: req.id
        });
    }
    next();
}

/* --------------------------------------------------------------------------
   1. CREATE - Criar nova missão
-------------------------------------------------------------------------- */

/**
 * POST /api/missions
 * Cria uma nova missão a partir de um template.
 *
 * Body:
 *   {
 *     "title": "Escrever livro sobre Rust",
 *     "description": "Livro técnico de 300 páginas",
 *     "templateId": "book_writing",
 *     "params": {
 *       "topic": "Rust Programming",
 *       "num_chapters": 15,
 *       "target_pages": 300,
 *       "target_audience": "intermediate developers"
 *     }
 *   }
 *
 * Response:
 *   {
 *     "success": true,
 *     "mission": { id, title, status, workflow, ... },
 *     "request_id": "req-123"
 *   }
 */
router.post('/', requireMissionManager, async (req, res) => {
    try {
        const { title, description, templateId, params } = req.body;

        // Validação básica
        if (!title || !templateId) {
            return res.status(400).json({
                success: false,
                error: 'Campos obrigatórios ausentes',
                missing: !title ? 'title' : 'templateId',
                request_id: req.id
            });
        }

        log('INFO', `[MISSIONS_API] Criando missão: ${title} (template=${templateId})`, req.id);

        // Cria missão via MissionManager
        const mission = await missionManager.createMission({
            title,
            description: description || '',
            templateId,
            params: params || {}
        });

        log('INFO', `[MISSIONS_API] Missão criada: ${mission.id}`, req.id);

        res.status(201).json({
            success: true,
            mission,
            request_id: req.id
        });
    } catch (err) {
        log('ERROR', `[MISSIONS_API] Erro ao criar missão: ${err.message}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Erro ao criar missão',
            details: err.message,
            request_id: req.id
        });
    }
});

/* --------------------------------------------------------------------------
   2. READ - Consultar missões
-------------------------------------------------------------------------- */

/**
 * GET /api/missions
 * Lista todas as missões com filtros opcionais.
 *
 * Query params:
 *   - status: PENDING|RUNNING|PAUSED|COMPLETED|FAILED
 *
 * Response:
 *   {
 *     "success": true,
 *     "total": 10,
 *     "missions": [...]
 *   }
 */
router.get('/', requireMissionManager, async (req, res) => {
    try {
        const filters = {};

        // Filtro por status
        if (req.query.status) {
            filters.status = req.query.status;
        }

        const missions = await missionManager.listMissions(filters);

        res.json({
            success: true,
            total: missions.length,
            missions,
            request_id: req.id
        });
    } catch (err) {
        log('ERROR', `[MISSIONS_API] Erro ao listar missões: ${err.message}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Erro ao listar missões',
            details: err.message,
            request_id: req.id
        });
    }
});

/**
 * GET /api/missions/:id
 * Retorna detalhes completos de uma missão.
 *
 * Response:
 *   {
 *     "success": true,
 *     "mission": { id, title, status, workflow, progress, ... }
 *   }
 */
router.get('/:id', requireMissionManager, async (req, res) => {
    try {
        const missionId = req.params.id;
        const mission = await missionManager.getMission(missionId);

        if (!mission) {
            return res.status(404).json({
                success: false,
                error: 'Missão não encontrada',
                mission_id: missionId,
                request_id: req.id
            });
        }

        res.json({
            success: true,
            mission,
            request_id: req.id
        });
    } catch (err) {
        log('ERROR', `[MISSIONS_API] Erro ao buscar missão: ${err.message}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Erro ao buscar missão',
            details: err.message,
            request_id: req.id
        });
    }
});

/**
 * GET /api/missions/:id/progress
 * Retorna progresso detalhado de uma missão.
 *
 * Response:
 *   {
 *     "success": true,
 *     "progress": {
 *       "mission_id": "mission-123",
 *       "status": "RUNNING",
 *       "progress": { current_step: 5, total_steps: 17, percent: 29 },
 *       "current_step": { id: "step-2-chapter-3", ... },
 *       "is_active": true
 *     }
 *   }
 */
router.get('/:id/progress', requireMissionManager, async (req, res) => {
    try {
        const missionId = req.params.id;
        const progress = await missionManager.getMissionProgress(missionId);

        if (!progress) {
            return res.status(404).json({
                success: false,
                error: 'Missão não encontrada',
                mission_id: missionId,
                request_id: req.id
            });
        }

        res.json({
            success: true,
            progress,
            request_id: req.id
        });
    } catch (err) {
        log('ERROR', `[MISSIONS_API] Erro ao buscar progresso: ${err.message}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Erro ao buscar progresso',
            details: err.message,
            request_id: req.id
        });
    }
});

/* --------------------------------------------------------------------------
   3. EXECUTE - Controle de execução
-------------------------------------------------------------------------- */

/**
 * POST /api/missions/:id/execute
 * Inicia execução de uma missão.
 *
 * Response:
 *   {
 *     "success": true,
 *     "message": "Missão iniciada",
 *     "mission_id": "mission-123"
 *   }
 */
router.post('/:id/execute', requireMissionManager, async (req, res) => {
    try {
        const missionId = req.params.id;

        log('INFO', `[MISSIONS_API] Iniciando execução: ${missionId}`, req.id);

        await missionManager.executeMission(missionId);

        res.json({
            success: true,
            message: 'Missão iniciada',
            mission_id: missionId,
            request_id: req.id
        });
    } catch (err) {
        log('ERROR', `[MISSIONS_API] Erro ao executar missão: ${err.message}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Erro ao executar missão',
            details: err.message,
            request_id: req.id
        });
    }
});

/**
 * POST /api/missions/:id/pause
 * Pausa execução de uma missão.
 *
 * Response:
 *   {
 *     "success": true,
 *     "message": "Missão pausada",
 *     "mission_id": "mission-123"
 *   }
 */
router.post('/:id/pause', requireMissionManager, async (req, res) => {
    try {
        const missionId = req.params.id;

        log('INFO', `[MISSIONS_API] Pausando missão: ${missionId}`, req.id);

        await missionManager.pauseMission(missionId);

        res.json({
            success: true,
            message: 'Missão pausada',
            mission_id: missionId,
            request_id: req.id
        });
    } catch (err) {
        log('ERROR', `[MISSIONS_API] Erro ao pausar missão: ${err.message}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Erro ao pausar missão',
            details: err.message,
            request_id: req.id
        });
    }
});

/**
 * POST /api/missions/:id/resume
 * Resume execução de uma missão pausada.
 *
 * Response:
 *   {
 *     "success": true,
 *     "message": "Missão resumida",
 *     "mission_id": "mission-123"
 *   }
 */
router.post('/:id/resume', requireMissionManager, async (req, res) => {
    try {
        const missionId = req.params.id;

        log('INFO', `[MISSIONS_API] Resumindo missão: ${missionId}`, req.id);

        await missionManager.resumeMission(missionId);

        res.json({
            success: true,
            message: 'Missão resumida',
            mission_id: missionId,
            request_id: req.id
        });
    } catch (err) {
        log('ERROR', `[MISSIONS_API] Erro ao resumir missão: ${err.message}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Erro ao resumir missão',
            details: err.message,
            request_id: req.id
        });
    }
});

/* --------------------------------------------------------------------------
   4. FEEDBACK - Injeção de feedback
-------------------------------------------------------------------------- */

/**
 * POST /api/missions/:id/feedback
 * Adiciona feedback a uma missão em execução.
 *
 * Body:
 *   {
 *     "feedback": "Adicione mais exemplos de código"
 *   }
 *
 * Response:
 *   {
 *     "success": true,
 *     "message": "Feedback adicionado",
 *     "mission_id": "mission-123"
 *   }
 */
router.post('/:id/feedback', requireMissionManager, async (req, res) => {
    try {
        const missionId = req.params.id;
        const { feedback } = req.body;

        if (!feedback || typeof feedback !== 'string') {
            return res.status(400).json({
                success: false,
                error: 'Feedback inválido',
                message: 'Campo "feedback" é obrigatório e deve ser string',
                request_id: req.id
            });
        }

        log('INFO', `[MISSIONS_API] Adicionando feedback: ${missionId}`, req.id);

        await missionManager.addFeedback(missionId, feedback);

        res.json({
            success: true,
            message: 'Feedback adicionado',
            mission_id: missionId,
            request_id: req.id
        });
    } catch (err) {
        log('ERROR', `[MISSIONS_API] Erro ao adicionar feedback: ${err.message}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Erro ao adicionar feedback',
            details: err.message,
            request_id: req.id
        });
    }
});

/* --------------------------------------------------------------------------
   5. DELETE - Deletar missão
-------------------------------------------------------------------------- */

/**
 * DELETE /api/missions/:id
 * Deleta uma missão completamente (filesystem).
 *
 * Response:
 *   {
 *     "success": true,
 *     "message": "Missão deletada",
 *     "mission_id": "mission-123"
 *   }
 */
router.delete('/:id', requireMissionManager, async (req, res) => {
    try {
        const missionId = req.params.id;

        log('INFO', `[MISSIONS_API] Deletando missão: ${missionId}`, req.id);

        await missionManager.deleteMission(missionId);

        res.json({
            success: true,
            message: 'Missão deletada',
            mission_id: missionId,
            request_id: req.id
        });
    } catch (err) {
        log('ERROR', `[MISSIONS_API] Erro ao deletar missão: ${err.message}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Erro ao deletar missão',
            details: err.message,
            request_id: req.id
        });
    }
});

/* --------------------------------------------------------------------------
   6. TEMPLATES - Listar templates disponíveis
-------------------------------------------------------------------------- */

/**
 * GET /api/missions/templates/list
 * Lista todos os templates de missões disponíveis.
 *
 * Response:
 *   {
 *     "success": true,
 *     "templates": ["book_writing", "software_development", ...]
 *   }
 */
router.get('/templates/list', requireMissionManager, async (req, res) => {
    try {
        // Acessa WorkflowGenerator via MissionManager
        const templates = await missionManager.workflowGenerator.listTemplates();

        res.json({
            success: true,
            total: templates.length,
            templates,
            request_id: req.id
        });
    } catch (err) {
        log('ERROR', `[MISSIONS_API] Erro ao listar templates: ${err.message}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Erro ao listar templates',
            details: err.message,
            request_id: req.id
        });
    }
});

module.exports = router;
module.exports.setMissionManager = setMissionManager;
