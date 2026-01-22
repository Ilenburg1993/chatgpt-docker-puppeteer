/* ==========================================================================
   src/server/api/controllers/tasks.js
   Audit Level: 700 — Task Domain Controller (Traceability Edition)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Ponto único de autoridade para o ciclo de vida de tarefas,
                     gestão de fila e entrega de artefatos de resposta.
   Sincronizado com: io.js V700, request_id.js V600, error_handler.js V600.
========================================================================== */

const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();

const io = require('@infra/io');
const schemas = require('@core/schemas');
const { audit, log } = require('@core/logger');

/* --------------------------------------------------------------------------
   1. OPERAÇÕES DE CONSULTA E CRIAÇÃO (CRUD)
-------------------------------------------------------------------------- */

/**
 * GET /
 * Lista o snapshot estável da fila (Otimizado via Cache RAM).
 */
router.get('/', async (req, res) => {
    try {
        const queue = await io.getQueue();
        res.json(queue);
    } catch (e) {
        log('ERROR', `[API_TASKS] Falha ao ler fila: ${e.message}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Erro interno ao acessar a fila de tarefas.',
            request_id: req.id
        });
    }
});

/**
 * POST /
 * Ingestão de nova tarefa com cura automática para o padrão V4 Gold.
 */
router.post('/', async (req, res) => {
    try {
        // O healer converte formatos legados e aplica defaults do Zod
        const task = schemas.parseTask(req.body);
        await io.saveTask(task);

        await audit('CREATE_TASK', {
            id: task.meta.id,
            source: 'GUI',
            request_id: req.id
        });

        res.json({
            success: true,
            id: task.meta.id,
            request_id: req.id
        });
    } catch (e) {
        log('WARN', `[API_TASKS] Ingestão rejeitada: ${e.message}`, req.id);
        res.status(400).json({
            success: false,
            error: `Dados da tarefa inválidos: ${e.message}`,
            request_id: req.id
        });
    }
});

/**
 * PUT /:id
 * Atualização parcial ou total de uma tarefa existente.
 */
router.put('/:id', async (req, res) => {
    try {
        const safeId = req.params.id.replace(/[^a-zA-Z0-9._-]/g, '');
        const task = schemas.parseTask(req.body);

        if (task.meta.id !== safeId) {
            throw new Error('Integrity Violation: ID Mismatch.');
        }

        await io.saveTask(task);
        await audit('EDIT_TASK', { id: safeId, user: 'GUI', request_id: req.id });

        res.json({
            success: true,
            request_id: req.id
        });
    } catch (e) {
        log('ERROR', `[API_TASKS] Falha na atualização: ${e.message}`, req.id);
        res.status(400).json({
            success: false,
            error: e.message,
            request_id: req.id
        });
    }
});

/**
 * DELETE /:id
 * Remoção física da intenção de execução.
 */
router.delete('/:id', async (req, res) => {
    try {
        const safeId = req.params.id.replace(/[^a-zA-Z0-9._-]/g, '');
        await io.deleteTask(safeId);

        await audit('DELETE_TASK', { id: safeId, user: 'GUI', request_id: req.id });
        res.json({
            success: true,
            request_id: req.id
        });
    } catch (e) {
        log('ERROR', `[API_TASKS] Falha ao remover tarefa: ${e.message}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Falha ao remover tarefa do disco.',
            request_id: req.id
        });
    }
});

/* --------------------------------------------------------------------------
   2. OPERAÇÕES EM LOTE (BULK)
-------------------------------------------------------------------------- */

/**
 * POST /retry-failed
 * Reinicia o ciclo de vida de todas as tarefas com status FAILED.
 */
router.post('/retry-failed', async (req, res) => {
    try {
        const count = await io.bulkRetryFailed();
        await audit('RETRY_BATCH', { count, request_id: req.id });
        res.json({
            success: true,
            count,
            request_id: req.id
        });
    } catch (e) {
        log('ERROR', `[API_TASKS] Falha na reinicialização em lote: ${e.message}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Falha na reinicialização em lote.',
            request_id: req.id
        });
    }
});

/**
 * POST /clear
 * Limpeza higiênica da fila (preserva tarefas em execução).
 */
router.post('/clear', async (req, res) => {
    try {
        const report = await io.clearQueue();
        await audit('CLEAR_QUEUE', { ...report, request_id: req.id });
        res.json({
            success: true,
            ...report,
            request_id: req.id
        });
    } catch (e) {
        log('ERROR', `[API_TASKS] Falha ao limpar a fila: ${e.message}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Falha ao limpar a fila.',
            request_id: req.id
        });
    }
});

/* --------------------------------------------------------------------------
   3. GESTÃO DE ARTEFATOS (RESULTADOS)
-------------------------------------------------------------------------- */

/**
 * downloadResult: Lógica de streaming para arquivos de resposta.
 */
const downloadResult = async (req, res) => {
    const requestId = req.id;
    try {
        const safeId = req.params.id.replace(/[^a-zA-Z0-9._-]/g, '');
        const filePath = path.join(io.RESPONSE_DIR, `${safeId}.txt`);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({
                success: false,
                error: 'Resultado não localizado no disco.',
                request_id: requestId
            });
        }

        // Headers de integridade para texto UTF-8
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `inline; filename="${safeId}.txt"`);

        const stream = fs.createReadStream(filePath);
        stream.pipe(res);

        stream.on('error', err => {
            log('ERROR', `[API_TASKS] Erro no stream do arquivo ${safeId}: ${err.message}`, requestId);
            if (!res.headersSent) {
                res.status(500).json({
                    success: false,
                    error: 'Erro na transmissão do arquivo.',
                    request_id: requestId
                });
            }
        });
    } catch (e) {
        log('ERROR', `[API_TASKS] Falha crítica no download: ${e.message}`, requestId);
        res.status(500).json({
            success: false,
            error: 'Falha no download do artefato.',
            request_id: requestId
        });
    }
};

// Mapeamento para /api/tasks/results/:id
router.get('/results/:id', downloadResult);

// Mapeamento para /api/results/:id (Suporte a rotas legadas do Dashboard)
router.get('/:id', (req, res, next) => {
    if (['retry-failed', 'clear'].includes(req.params.id)) {
        return next();
    }
    downloadResult(req, res);
});

module.exports = router;
