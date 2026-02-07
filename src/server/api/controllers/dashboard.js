// @ts-check - Type checking rigoroso habilitado (arquivo core)
import express from 'express';
const router = express.Router();

import { log } from '#core/logger';
import denyIfDelegated from '../../middleware/deny_if_delegated.js';
import taskSyncBridge from '#server/dashboard-api/task_sync_bridge';
import telemetryAggregator from '#server/dashboard-api/telemetry_aggregator';

/* --------------------------------------------------------------------------
   1. TASKS - APIs Unificadas
-------------------------------------------------------------------------- */

/**
 * GET /dashboard/tasks
 * Lista todas as tasks com estado unificado (disco + kernel).
 */
router.get('/tasks', async (req, res) => {
    try {
        const tasks = await taskSyncBridge.getUnifiedTasks();

        // Opcional: filtros via query params
        let filtered = tasks;

        if (req.query.status) {
            filtered = filtered.filter(t => t.unified_status === req.query.status);
        }

        if (req.query.priority) {
            const minPriority = parseInt(req.query.priority, 10);
            filtered = filtered.filter(t => (t.meta?.priority || 0) >= minPriority);
        }

        res.json({
            success: true,
            total: filtered.length,
            tasks: filtered,
            request_id: req.id
        });
    } catch (err) {
        log('ERROR', `[DASHBOARD_API] Erro ao listar tasks: ${err.message}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Erro ao recuperar lista de tasks',
            request_id: req.id
        });
    }
});

/**
 * GET /dashboard/tasks/:id
 * Retorna uma task específica com estado unificado.
 */
router.get('/tasks/:id', async (req, res) => {
    try {
        const taskId = req.params.id;
        const task = await taskSyncBridge.getUnifiedTask(taskId);

        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Task não encontrada',
                request_id: req.id
            });
        }

        res.json({
            success: true,
            task,
            request_id: req.id
        });
    } catch (err) {
        log('ERROR', `[DASHBOARD_API] Erro ao buscar task: ${err.message}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Erro ao recuperar task',
            request_id: req.id
        });
    }
});

/**
 * GET /dashboard/tasks/:id/dependencies
 * Retorna dependências de uma task.
 */
router.get('/tasks/:id/dependencies', async (req, res) => {
    try {
        const taskId = req.params.id;
        const task = await taskSyncBridge.getUnifiedTask(taskId);

        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Task não encontrada',
                request_id: req.id
            });
        }

        const dependencies = task.policy?.dependencies || [];
        const dependencyTasks = await Promise.all(
            dependencies.map(depId => taskSyncBridge.getUnifiedTask(depId))
        );

        res.json({
            success: true,
            task_id: taskId,
            dependencies: dependencyTasks.filter(Boolean),
            request_id: req.id
        });
    } catch (err) {
        log('ERROR', `[DASHBOARD_API] Erro ao buscar dependências: ${err.message}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Erro ao recuperar dependências',
            request_id: req.id
        });
    }
});

/**
 * GET /dashboard/tasks/stats
 * Retorna estatísticas agregadas das tasks.
 */
router.get('/tasks-stats', async (req, res) => {
    try {
        const tasks = await taskSyncBridge.getUnifiedTasks();

        const stats = {
            total: tasks.length,
            by_status: {},
            by_priority: {
                high: 0,    // >= 70
                medium: 0,  // 40-69
                low: 0      // < 40
            }
        };

        for (const task of tasks) {
            // Por status
            const status = task.unified_status || 'UNKNOWN';
            stats.by_status[status] = (stats.by_status[status] || 0) + 1;

            // Por prioridade
            const priority = task.meta?.priority || 50;
            if (priority >= 70) stats.by_priority.high++;
            else if (priority >= 40) stats.by_priority.medium++;
            else stats.by_priority.low++;
        }

        res.json({
            success: true,
            stats,
            request_id: req.id
        });
    } catch (err) {
        log('ERROR', `[DASHBOARD_API] Erro ao calcular stats: ${err.message}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Erro ao calcular estatísticas',
            request_id: req.id
        });
    }
});

/* --------------------------------------------------------------------------
   2. TELEMETRY - Métricas em Tempo Real
-------------------------------------------------------------------------- */

/**
 * GET /dashboard/telemetry/current
 * Retorna métricas atuais do sistema.
 */
router.get('/telemetry/current', async (req, res) => {
    try {
        const metrics = await telemetryAggregator.getCurrent();

        res.json({
            success: true,
            metrics,
            request_id: req.id
        });
    } catch (err) {
        log('ERROR', `[DASHBOARD_API] Erro ao buscar telemetria: ${err.message}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Erro ao recuperar métricas',
            request_id: req.id
        });
    }
});

/**
 * GET /dashboard/telemetry/history
 * Retorna histórico completo de todas as métricas.
 */
router.get('/telemetry/history', async (req, res) => {
    try {
        const history = telemetryAggregator.getFullHistory();

        res.json({
            success: true,
            ...history,
            request_id: req.id
        });
    } catch (err) {
        log('ERROR', `[DASHBOARD_API] Erro ao buscar histórico: ${err.message}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Erro ao recuperar histórico',
            request_id: req.id
        });
    }
});

/**
 * GET /dashboard/telemetry/history/:metric
 * Retorna histórico de uma métrica específica.
 *
 * Métricas disponíveis: cpu, memory, heap, event_loop, nerv_latency, nerv_throughput, queue
 */
router.get('/telemetry/history/:metric', async (req, res) => {
    try {
        const metric = req.params.metric;
        const samples = parseInt(req.query.samples, 10) || 60;

        const history = telemetryAggregator.getHistory(metric, samples);

        if (history.error) {
            return res.status(400).json({
                success: false,
                error: history.error,
                request_id: req.id
            });
        }

        res.json({
            success: true,
            ...history,
            request_id: req.id
        });
    } catch (err) {
        log('ERROR', `[DASHBOARD_API] Erro ao buscar histórico: ${err.message}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Erro ao recuperar histórico',
            request_id: req.id
        });
    }
});

/* --------------------------------------------------------------------------
   3. ALERTS - Sistema de Alertas
-------------------------------------------------------------------------- */

/**
 * GET /dashboard/alerts
 * Retorna alertas ativos.
 */
router.get('/alerts', async (req, res) => {
    try {
        const alerts = telemetryAggregator.getActiveAlerts();

        res.json({
            success: true,
            count: alerts.length,
            alerts,
            request_id: req.id
        });
    } catch (err) {
        log('ERROR', `[DASHBOARD_API] Erro ao buscar alertas: ${err.message}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Erro ao recuperar alertas',
            request_id: req.id
        });
    }
});

/**
 * PUT /dashboard/alerts/thresholds
 * Atualiza thresholds de alerta.
 */
router.put('/alerts/thresholds', denyIfDelegated, async (req, res) => {
    try {
        const thresholds = req.body;
        telemetryAggregator.setAlertThresholds(thresholds);

        res.json({
            success: true,
            message: 'Thresholds atualizados',
            request_id: req.id
        });
    } catch (err) {
        log('ERROR', `[DASHBOARD_API] Erro ao atualizar thresholds: ${err.message}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Erro ao atualizar thresholds',
            request_id: req.id
        });
    }
});

/* --------------------------------------------------------------------------
   4. SYSTEM - Informações do Sistema
-------------------------------------------------------------------------- */

/**
 * GET /dashboard/system/health
 * Retorna status de saúde do sistema.
 */
router.get('/system/health', async (req, res) => {
    try {
        const metrics = await telemetryAggregator.getCurrent();
        const alerts = telemetryAggregator.getActiveAlerts();
        const bridgeMetrics = taskSyncBridge.getMetrics();

        // Determina status geral
        let overallStatus = 'healthy';
        if (alerts.some(a => a.severity === 'critical')) {
            overallStatus = 'critical';
        } else if (alerts.length > 0) {
            overallStatus = 'warning';
        }

        const components = {
            api: { status: 'healthy', message: 'API responding' },
            queue: {
                status: metrics?.queue?.size > 500 ? 'warning' : 'healthy',
                message: `Queue size: ${metrics?.queue?.size || 0}`
            },
            memory: {
                status: metrics?.heap?.usage_percent > 90 ? 'critical' :
                        metrics?.heap?.usage_percent > 70 ? 'warning' : 'healthy',
                message: `Heap: ${metrics?.heap?.usage_percent || 0}%`
            },
            kernel: {
                status: bridgeMetrics.initialized ? 'healthy' : 'degraded',
                message: bridgeMetrics.initialized ? 'TaskSyncBridge active' : 'Not initialized'
            }
        };

        res.json({
            success: true,
            status: overallStatus,
            components,
            alerts_count: alerts.length,
            uptime_seconds: metrics?.uptime_seconds || 0,
            request_id: req.id
        });
    } catch (err) {
        log('ERROR', `[DASHBOARD_API] Erro ao verificar health: ${err.message}`, req.id);
        res.status(500).json({
            success: false,
            status: 'error',
            error: 'Erro ao verificar status do sistema',
            request_id: req.id
        });
    }
});

/**
 * GET /dashboard/system/info
 * Retorna informações do sistema.
 */
router.get('/system/info', async (req, res) => {
    try {
        const metrics = await telemetryAggregator.getCurrent();

        res.json({
            success: true,
            system: metrics?.system || {},
            versions: {
                node: process.version,
                platform: process.platform,
                arch: process.arch
            },
            request_id: req.id
        });
    } catch (err) {
        log('ERROR', `[DASHBOARD_API] Erro ao buscar info: ${err.message}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Erro ao recuperar informações',
            request_id: req.id
        });
    }
});

/* --------------------------------------------------------------------------
   5. BRIDGE - Métricas do TaskSyncBridge
-------------------------------------------------------------------------- */

/**
 * GET /dashboard/bridge/metrics
 * Retorna métricas do TaskSyncBridge.
 */
router.get('/bridge/metrics', async (req, res) => {
    try {
        const metrics = taskSyncBridge.getMetrics();

        res.json({
            success: true,
            metrics,
            request_id: req.id
        });
    } catch (err) {
        log('ERROR', `[DASHBOARD_API] Erro ao buscar métricas bridge: ${err.message}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Erro ao recuperar métricas do bridge',
            request_id: req.id
        });
    }
});

export default router;
