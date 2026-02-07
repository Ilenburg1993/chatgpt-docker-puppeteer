// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { log } from '#core/logger';

/**
 * GET /api/metrics - Métricas gerais do sistema
 */
async function getMetrics(req, res) {
    try {
        const metrics = {
            timestamp: Date.now(),
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            cpu: process.cpuUsage(),
            pid: process.pid,
            platform: process.platform,
            nodeVersion: process.version
        };

        res.json({ status: 'ok', metrics });
    } catch (err) {
        log('ERROR', `[METRICS] Erro ao obter métricas: ${err.message}`);
        res.status(500).json({ status: 'error', message: err.message });
    }
}

/**
 * GET /api/metrics/tasks - Métricas de tasks
 */
async function getTaskMetrics(req, res) {
    try {
        // TODO: Implementar métricas reais de tasks
        res.json({
            status: 'unknown',
            message: 'Task metrics not implemented yet'
        });
    } catch (err) {
        log('ERROR', `[METRICS] Erro ao obter métricas de tasks: ${err.message}`);
        res.status(500).json({ status: 'error', message: err.message });
    }
}

export { getMetrics, getTaskMetrics };
