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

import { defaultAuditLog, getAuditTail } from '#copilot/audit';
import { getMcpStatus, isMounted as isNervMounted } from '#copilot/bridges';
import { OTEL_EXPORTER_OTLP_ENDPOINT } from '#copilot/config';
import {
    DEFAULT_OTEL_FILE,
    defaultErrorTracker,
    defaultMetrics,
    getCatalog,
    getDeadLetters,
    getLastQuotaSnapshots,
    getRecentLogs,
    isOtelEnabled,
    log,
} from '#copilot/observability';
import { Router } from 'express';
import { logSwallowed } from '../../core/error-handlers.js';
import { withErrorHandler as _withErrorHandler } from './middleware.js';

/**
 * @typedef {import('express').Request} Req
 *
 * @typedef {import('express').Response} Res
 */

/**
 * Dependências injetáveis do router de observabilidade.
 *
 * @typedef {object} ObservabilityRouterDeps
 * @property {import('#copilot/agent').AlwaysAliveAgent} agent - Instância do agente.
 */

/**
 * Factory que cria o router de rotas `/observability/*` com dependências injetadas.
 *
 * @param {ObservabilityRouterDeps} deps
 * @returns {import('express').Router}
 */
export default function createObservabilityRouter(deps) {
    const { agent } = deps;
    const router = Router();

/**
 * @param {Req} req
 * @param {Res} res
 * @param {() => Promise<unknown>} fn
 * @returns {Promise<void>}
 */
const withErrorHandler = _withErrorHandler.bind(null, 'sdk-api/observability');

// ─── GET /observability/health ────────────────────────────────────────────────

/**
 * Determina o status de um componente.
 *
 * @param {boolean} available - Se o componente está acessível.
 * @param {boolean} [hasErrors] - Se o componente reportou erros recentes.
 * @returns {'healthy' | 'degraded' | 'unhealthy'}
 */
function componentStatus(available, hasErrors = false) {
    if (!available) return 'unhealthy';
    return hasErrors ? 'degraded' : 'healthy';
}

router.get('/observability/health', (req, res) =>
    withErrorHandler(req, res, async () => {
        const metrics = defaultMetrics.getSummary();
        const errorStats = defaultErrorTracker.getStats();
        const recentErrors = defaultErrorTracker.getErrors(5);

        /** @type {Record<string, unknown> | null} */
        let agentSnapshot = null;
        let agentAvailable = false;
        try {
            agentSnapshot = agent.getStatusSnapshot();
            agentAvailable = true;
        } catch (/** @type {any} */ e) {
            logSwallowed(e, 'api.observability.getAgent');
        }

        const mcpStatus = getMcpStatus();
        const nervMounted = isNervMounted();
        const hasRecentAgentErrors = recentErrors.some((e) => e.source === 'agent');

        /** @type {Record<string, { status: string; details?: string }>} */
        const components = {
            agent: {
                status: componentStatus(agentAvailable, hasRecentAgentErrors),
                ...(agentSnapshot
                    ? { details: String(/** @type {Record<string, unknown>} */ (agentSnapshot)['status'] ?? 'unknown') }
                    : { details: 'not started' }),
            },
            mcp_bridge: {
                status: componentStatus(mcpStatus.available, mcpStatus.circuitOpen),
                details: mcpStatus.available ? 'connected' : 'unavailable',
            },
            nerv_bridge: {
                status: componentStatus(nervMounted),
                details: nervMounted ? 'mounted' : 'not mounted',
            },
            error_tracker: {
                status: 'healthy',
                details: `${errorStats.buffered} buffered`,
            },
            metrics: {
                status: 'healthy',
                details: `${Object.keys(metrics.tools).length} tools tracked`,
            },
        };

        const overallHealthy = Object.values(components).every((c) => c.status !== 'unhealthy');
        const overallStatus = Object.values(components).some((c) => c.status === 'unhealthy')
            ? 'unhealthy'
            : Object.values(components).some((c) => c.status === 'degraded')
              ? 'degraded'
              : 'healthy';

        res.status(overallHealthy ? 200 : 503).json({
            ok: overallHealthy,
            status: overallStatus,
            agent: agentSnapshot,
            components,
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
                gauges: metrics.gauges,
                lastError: recentErrors.length ? recentErrors[recentErrors.length - 1] : null,
            },
            ts: Date.now(),
        });
    }),
);

// ─── GET /observability/metrics ───────────────────────────────────────────────

router.get('/observability/metrics', (req, res) =>
    withErrorHandler(req, res, async () => {
        const summary = defaultMetrics.getSummary();
        // GAP-ROUTE-001: filtro opcional por prefixo de counter (ex: ?prefix=tool.)
        const prefix = typeof req.query?.['prefix'] === 'string' ? req.query['prefix'] : '';
        if (prefix && summary.counters) {
            /** @type {Record<string, number>} */
            const filtered = {};
            for (const [k, v] of Object.entries(summary.counters)) {
                if (k.startsWith(prefix)) filtered[k] = v;
            }
            return res.json({ ok: true, ...summary, counters: filtered });
        }
        return res.json({ ok: true, ...summary });
    }),
);

// ─── GET /observability/quota (UPG-SE-005) ─────────────────────────────────────

/**
 * Retorna o último quotaSnapshot recebido via `assistant.usage`.
 *
 * Cada snapshot contém `remainingPercentage`, `resetDate`, e outros campos dependentes do plano.
 */
router.get('/observability/quota', (req, res) =>
    withErrorHandler(req, res, async () => {
        const { snapshots, ts } = getLastQuotaSnapshots();
        const hasData = Object.keys(snapshots).length > 0;
        res.json({
            ok: true,
            quotaSnapshots: snapshots,
            lastUpdated: ts || null,
            hasData,
        });
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

// ─── GET /observability/audit ─────────────────────────────────────────────────

router.get('/observability/audit', (req, res) =>
    withErrorHandler(req, res, async () => {
        const n = Math.min(Number(req.query['n']) || 50, 200);
        const type = typeof req.query['type'] === 'string' ? req.query['type'] : undefined;
        let entries = defaultAuditLog.getLast(n);
        if (type) {
            entries = entries.filter((e) => e.type === type);
        }
        res.json({ ok: true, entries, count: entries.length });
    }),
);

// ─── POST /observability/audit/flush ─────────────────────────────────────────

router.post('/observability/audit/flush', (req, res) =>
    withErrorHandler(req, res, async () => {
        await defaultAuditLog.flush();
        log('INFO', '[observability] Audit log flushed via API');
        res.json({ ok: true });
    }),
);

// ─── GET /observability/audit-tail ───────────────────────────────────────────

router.get('/observability/audit-tail', (req, res) =>
    withErrorHandler(req, res, async () => {
        const n = Math.min(Math.max(Number(req.query['n']) || 50, 1), 500);
        const sessionId = typeof req.query['sessionId'] === 'string' ? req.query['sessionId'] : undefined;
        const tool = typeof req.query['tool'] === 'string' ? req.query['tool'] : undefined;
        let entries = getAuditTail(n);
        if (sessionId) {
            entries = entries.filter((e) => /** @type {any} */ (e).sessionId === sessionId);
        }
        if (tool) {
            entries = entries.filter((e) => /** @type {any} */ (e).toolName === tool);
        }
        res.json({ ok: true, entries, count: entries.length });
    }),
);

// ─── GET /observability/otel-status ──────────────────────────────────────────

router.get('/observability/otel-status', (_req, res) => {
    res.json({
        ok: true,
        enabled: isOtelEnabled(),
        endpoint: OTEL_EXPORTER_OTLP_ENDPOINT ?? null,
        traceFile: DEFAULT_OTEL_FILE,
        spanTypes: ['session.boot'],
    });
});

// ─── GET /observability/events/catalog ───────────────────────────────────────

router.get('/observability/events/catalog', (_req, res) => {
    res.json({ ok: true, catalog: getCatalog() });
});

// ─── GET /observability/events/dead-letter ────────────────────────────────────

router.get('/observability/events/dead-letter', (req, res) => {
    const limit = Math.min(Number(req.query['limit']) || 50, 200);
    const entries = getDeadLetters(limit);
    res.json({ ok: true, entries, count: entries.length });
});

    return router;
}
