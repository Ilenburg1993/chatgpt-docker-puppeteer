// @ts-check
/**
 * src/copilot/routes/observability.js
 *
 * Rotas de observabilidade para src/copilot.
 *
 * Montadas em /api/sdk/observability/* via sdk-api.js.
 *
 * Endpoints:
 *
 * - GET /observability/health — estado dos componentes de observabilidade
 * - GET /observability/metrics — métricas agregadas (tool calls, tokens, latências, p95/p99)
 * - GET /observability/errors — erros recentes do ring buffer
 * - GET /observability/errors/stats — contadores de erros por tipo/origem
 * - GET /observability/logs — últimas N entradas do ring buffer de logs
 * - POST /observability/errors/clear — limpar buffer de erros
 * - POST /observability/log-level — ajustar nível de log dinamicamente
 *
 * @module copilot/routes/observability
 */

import { defaultErrorTracker } from '#copilot/observability/error-tracker';
import { getRecentLogs, log } from '#copilot/observability/logger';
import { defaultMetrics } from '#copilot/observability/metrics';
import { DEFAULT_OTEL_FILE, isOtelEnabled } from '#copilot/observability/otel';
import { Router } from 'express';
import { withErrorHandler as _withErrorHandler } from './middleware.js';

const router = Router();

/**
 * @typedef {import('express').Request} Req
 *
 * @typedef {import('express').Response} Res
 */

/**
 * @param {Req} req
 * @param {Res} res
 * @param {() => Promise<unknown>} fn
 * @returns {Promise<void>}
 */
const withErrorHandler = _withErrorHandler.bind(null, 'sdk-api/observability');

// ─── GET /observability/health ────────────────────────────────────────────────

router.get('/observability/health', (req, res) =>
    withErrorHandler(req, res, async () => {
        const metrics = defaultMetrics.getSummary();
        const errorStats = defaultErrorTracker.getStats();
        const recentLogs = getRecentLogs(1, 'ERROR');

        res.json({
            ok: true,
            observability: {
                metricsActive: true,
                errorTrackerBuffered: errorStats.buffered,
                logRingBufferActive: true,
                otelEnabled: isOtelEnabled(),
                otelFile: DEFAULT_OTEL_FILE,
            },
            snapshot: {
                toolsTracked: Object.keys(metrics.tools).length,
                totalTokensIn: metrics.tokens.inputTokens,
                totalTokensOut: metrics.tokens.outputTokens,
                totalErrorsCaptured: errorStats.total,
                sessions: metrics.sessions,
                lastError: recentLogs.length ? recentLogs[recentLogs.length - 1] : null,
            },
            ts: Date.now(),
        });
    }),
);

// ─── GET /observability/metrics ───────────────────────────────────────────────

router.get('/observability/metrics', (req, res) =>
    withErrorHandler(req, res, async () => {
        const summary = defaultMetrics.getSummary();
        res.json({ ok: true, ...summary });
    }),
);

// ─── GET /observability/errors ────────────────────────────────────────────────

router.get('/observability/errors', (req, res) =>
    withErrorHandler(req, res, async () => {
        const n = Math.min(Number(req.query['n']) || 20, 100);
        const source = typeof req.query['source'] === 'string' ? req.query['source'] : undefined;
        const errors = defaultErrorTracker.getErrors(n, source);
        res.json({ ok: true, errors, count: errors.length });
    }),
);

// ─── GET /observability/errors/stats ─────────────────────────────────────────

router.get('/observability/errors/stats', (req, res) =>
    withErrorHandler(req, res, async () => {
        res.json({ ok: true, ...defaultErrorTracker.getStats() });
    }),
);

// ─── GET /observability/logs ──────────────────────────────────────────────────

router.get('/observability/logs', (req, res) =>
    withErrorHandler(req, res, async () => {
        const n = Math.min(Number(req.query['n']) || 50, 200);
        const level = typeof req.query['level'] === 'string' ? req.query['level'].toUpperCase() : undefined;
        const entries = getRecentLogs(n, level);
        res.json({ ok: true, entries, count: entries.length });
    }),
);

// ─── POST /observability/errors/clear ────────────────────────────────────────

router.post('/observability/errors/clear', (req, res) =>
    withErrorHandler(req, res, async () => {
        defaultErrorTracker.clearErrors();
        log('INFO', '[observability] Error buffer cleared via API');
        res.json({ ok: true });
    }),
);

// ─── POST /observability/log-level ───────────────────────────────────────────

router.post('/observability/log-level', (req, res) =>
    withErrorHandler(req, res, async () => {
        const { level } = /** @type {{ level?: string }} */ (req.body ?? {});
        const valid = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];
        if (!level || !valid.includes(level.toUpperCase())) {
            res.status(400).json({ ok: false, error: `Invalid level. Valid: ${valid.join(', ')}` });
            return;
        }
        const { log: obsLog } = await import('#copilot/observability/logger');
        obsLog.setLevel(/** @type {import('#copilot/observability/logger').LogLevel} */ (level.toUpperCase()));
        log('INFO', `[observability] Log level changed to ${level.toUpperCase()} via API`);
        res.json({ ok: true, level: level.toUpperCase() });
    }),
);

export default router;
