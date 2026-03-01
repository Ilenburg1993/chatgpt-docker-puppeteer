// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { log } from '#core/logger';
import { countTasks } from '#infra/db/task_repo';

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
            nodeVersion: process.version,
        };

        res.json({ status: 'ok', metrics });
    } catch (err) {
        log('ERROR', `[METRICS] Erro ao obter métricas: ${err.message}`);
        res.status(500).json({ status: 'error', message: err.message });
    }
}

/**
 * GET /api/metrics/tasks - Métricas de tasks por status
 *
 * Retorna contagem de tarefas agrupadas por status, usando countTasks()
 * do task_repo para evitar queries N+1.
 */
async function getTaskMetrics(req, res) {
    try {
        const statuses = ['PENDING', 'RUNNING', 'DONE', 'FAILED', 'PAUSED', 'SKIPPED', 'CANCELLED', 'BLOCKED'];
        const countsArr = await Promise.all(statuses.map(s => countTasks({ status: s })));
        const byStatus = Object.fromEntries(statuses.map((s, i) => [s, countsArr[i]]));
        const total = Object.values(byStatus).reduce((a, b) => a + b, 0);

        res.json({
            status: 'ok',
            timestamp: Date.now(),
            metrics: {
                by_status: byStatus,
                total,
            },
        });
    } catch (err) {
        log('ERROR', `[METRICS] Erro ao obter métricas de tasks: ${err.message}`);
        res.status(500).json({ status: 'error', message: err.message });
    }
}

export { getMetrics, getTaskMetrics };
