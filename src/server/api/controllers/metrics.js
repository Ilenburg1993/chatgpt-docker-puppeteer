// @ts-check
import { log } from '#core/logger';
import { countTasksByStatus } from '#infra/db/task_repo';

/**
 * @typedef {{ json: (payload: unknown) => unknown; status: (code: number) => MetricsResponseLike }} MetricsResponseLike
 */

/**
 * GET /api/metrics - Métricas gerais do sistema
 *
 * @param {unknown} req
 * @param {MetricsResponseLike} res
 * @returns {Promise<void>}
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
    } catch (/** @type {any} */ err) {
        const _e = /** @type {any} */ (err);
        log('ERROR', `[METRICS] Erro ao obter métricas: ${_e.message}`);
        res.status(500).json({ status: 'error', message: _e.message });
    }
}

/**
 * GET /api/metrics/tasks - Métricas de tasks por status
 *
 * Usa uma única query SQL com GROUP BY status para contar todas as tarefas por status de forma eficiente (evita N+1
 * queries).
 *
 * @param {unknown} req
 * @param {MetricsResponseLike} res
 * @returns {Promise<void>}
 */
async function getTaskMetrics(req, res) {
    try {
        const byStatus = countTasksByStatus();
        const total = Object.values(byStatus).reduce((a, b) => a + b, 0);

        res.json({
            status: 'ok',
            timestamp: Date.now(),
            metrics: {
                by_status: byStatus,
                total,
            },
        });
    } catch (/** @type {any} */ err) {
        const _e = /** @type {any} */ (err);
        log('ERROR', `[METRICS] Erro ao obter métricas de tasks: ${_e.message}`);
        res.status(500).json({ status: 'error', message: _e.message });
    }
}

export { getMetrics, getTaskMetrics };
