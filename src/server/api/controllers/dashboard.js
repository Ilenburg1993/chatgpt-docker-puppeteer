// @ts-check - Type checking rigoroso habilitado (arquivo core)
import express from 'express';
import { log } from '#core/logger';
import denyIfDelegated from '../../middleware/deny_if_delegated.js';
import telemetryAggregator from '#server/dashboard-api/telemetry_aggregator';
import dashboardTasksRouter from './dashboard_tasks.js';
import dashboardMissionsRouter from './dashboard_missions.js';
import dashboardEventsRouter from './dashboard_events.js';

const router = express.Router();

function getBridgeMetrics() {
    // TaskSyncBridge is being deprecated in favor of a DB Event Feed.
    // Keep this endpoint for observability/compat.
    return {
        initialized: true,
        source: 'sqlite_ssot',
        legacy_filesystem_queue: false,
    };
}

/* --------------------------------------------------------------------------
   TASKS + MISSIONS (SSOT-first)
-------------------------------------------------------------------------- */

router.use(dashboardTasksRouter);
router.use(dashboardMissionsRouter);
router.use(dashboardEventsRouter);

/* --------------------------------------------------------------------------
   TELEMETRY - Métricas em Tempo Real (compat)
-------------------------------------------------------------------------- */

router.get('/telemetry/current', async (req, res) => {
    try {
        const metrics = await telemetryAggregator.getCurrent();
        res.json({ success: true, metrics, request_id: req.id });
    } catch (err) {
        log('ERROR', `[DASHBOARD_API] Erro ao buscar telemetria: ${err.message}`, req.id);
        res.status(500).json({ success: false, error: 'Erro ao recuperar métricas', request_id: req.id });
    }
});

router.get('/telemetry/history', async (req, res) => {
    try {
        const history = telemetryAggregator.getFullHistory();
        res.json({ success: true, ...history, request_id: req.id });
    } catch (err) {
        log('ERROR', `[DASHBOARD_API] Erro ao buscar histórico: ${err.message}`, req.id);
        res.status(500).json({ success: false, error: 'Erro ao recuperar histórico', request_id: req.id });
    }
});

router.get('/telemetry/history/:metric', async (req, res) => {
    try {
        const metric = req.params.metric;
        const samples = parseInt(req.query.samples, 10) || 60;
        const history = telemetryAggregator.getHistory(metric, samples);

        if (history.error) {
            return res.status(400).json({ success: false, error: history.error, request_id: req.id });
        }

        res.json({ success: true, ...history, request_id: req.id });
    } catch (err) {
        log('ERROR', `[DASHBOARD_API] Erro ao buscar histórico: ${err.message}`, req.id);
        res.status(500).json({ success: false, error: 'Erro ao recuperar histórico', request_id: req.id });
    }
});

/* --------------------------------------------------------------------------
   ALERTS - Sistema de Alertas (compat)
-------------------------------------------------------------------------- */

router.get('/alerts', async (req, res) => {
    try {
        const alerts = telemetryAggregator.getActiveAlerts();
        res.json({ success: true, count: alerts.length, alerts, request_id: req.id });
    } catch (err) {
        log('ERROR', `[DASHBOARD_API] Erro ao buscar alertas: ${err.message}`, req.id);
        res.status(500).json({ success: false, error: 'Erro ao recuperar alertas', request_id: req.id });
    }
});

router.put('/alerts/thresholds', denyIfDelegated, async (req, res) => {
    try {
        const thresholds = req.body;
        telemetryAggregator.setAlertThresholds(thresholds);
        res.json({ success: true, message: 'Thresholds atualizados', request_id: req.id });
    } catch (err) {
        log('ERROR', `[DASHBOARD_API] Erro ao atualizar thresholds: ${err.message}`, req.id);
        res.status(500).json({ success: false, error: 'Erro ao atualizar thresholds', request_id: req.id });
    }
});

/* --------------------------------------------------------------------------
   SYSTEM - Informações do Sistema (compat)
-------------------------------------------------------------------------- */

router.get('/system/health', async (req, res) => {
    try {
        const metrics = await telemetryAggregator.getCurrent();
        const alerts = telemetryAggregator.getActiveAlerts();
        const bridgeMetrics = getBridgeMetrics();

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
                status:
                    metrics?.heap?.usage_percent > 90
                        ? 'critical'
                        : metrics?.heap?.usage_percent > 70
                            ? 'warning'
                            : 'healthy',
                message: `Heap: ${metrics?.heap?.usage_percent || 0}%`
            },
            kernel: {
                status: bridgeMetrics.initialized ? 'healthy' : 'degraded',
                message: bridgeMetrics.initialized ? 'SSOT mode' : 'Not initialized'
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

router.get('/system/info', async (req, res) => {
    try {
        const metrics = await telemetryAggregator.getCurrent();

        res.json({
            success: true,
            system: metrics?.system || {},
            versions: { node: process.version, platform: process.platform, arch: process.arch },
            request_id: req.id
        });
    } catch (err) {
        log('ERROR', `[DASHBOARD_API] Erro ao buscar info: ${err.message}`, req.id);
        res.status(500).json({ success: false, error: 'Erro ao recuperar informações', request_id: req.id });
    }
});

/* --------------------------------------------------------------------------
   BRIDGE - Métricas do TaskSyncBridge (compat)
-------------------------------------------------------------------------- */

router.get('/bridge/metrics', async (req, res) => {
    try {
        const metrics = getBridgeMetrics();
        res.json({ success: true, metrics, request_id: req.id });
    } catch (err) {
        log('ERROR', `[DASHBOARD_API] Erro ao buscar métricas bridge: ${err.message}`, req.id);
        res.status(500).json({ success: false, error: 'Erro ao recuperar métricas do bridge', request_id: req.id });
    }
});

export default router;
