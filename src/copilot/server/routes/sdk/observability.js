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
 * @see EventBus
 */

import { Router } from 'express';
import { logSwallowed } from '../../../core/error-handlers.js';
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
 * @property {ReturnType<import('./deps.js').buildDefaultSdkRouteSharedDeps>['sdkObservability']} sdkObservability
 * @property {ReturnType<import('./deps.js').buildDefaultSdkRouteSharedDeps>['sdkRuntimeProjection']} sdkRuntimeProjection
 * @property {string} [runtimeId] - Runtime alvo resolvido na borda.
 * @property {string | null} [requestedRuntimeId] - Runtime solicitado antes de fallback.
 * @property {boolean} [runtimeFound] - Se o runtime solicitado foi encontrado.
 * @property {boolean} [usedDefaultRuntimeFallback] - Se a resposta caiu para o runtime default.
 */

/** @typedef {ObservabilityRouterDeps | ((req: Req) => ObservabilityRouterDeps)} ObservabilityRouterBinding */

/**
 * @param {ObservabilityRouterBinding} binding
 * @param {Req} req
 * @returns {ObservabilityRouterDeps}
 */
function resolveObservabilityRouterDeps(binding, req) {
    return typeof binding === 'function' ? binding(req) : binding;
}

/**
 * @param {ObservabilityRouterDeps} routeDeps
 * @returns {{
 *     runtimeId?: string;
 *     requestedRuntimeId?: string | null;
 *     runtimeFound?: boolean;
 *     usedDefaultRuntimeFallback?: boolean;
 * }}
 */
function buildObservabilityRuntimeMeta(routeDeps) {
    return routeDeps.sdkRuntimeProjection.buildRuntimeRouteMetaPayload(routeDeps);
}

/**
 * Factory que cria o router de rotas `/observability/*` com dependências injetadas.
 *
 * @param {ObservabilityRouterBinding} deps
 * @returns {import('express').Router}
 */
export default function createObservabilityRouter(deps) {
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
            const routeDeps = resolveObservabilityRouterDeps(deps, req);
            const { requestedRuntimeId, runtimeId, sdkObservability, sdkRuntimeProjection } = routeDeps;
            const metrics = sdkObservability.defaultMetrics.getSummary();
            const errorStats = sdkObservability.defaultErrorTracker.getStats();
            const recentErrors = sdkObservability.defaultErrorTracker.getErrors(5);

            /** @type {Record<string, unknown> | null} */
            let agentSnapshot = null;
            let agentAvailable = false;
            try {
                agentSnapshot = sdkRuntimeProjection.readAgentStatusSnapshotForRuntime(requestedRuntimeId ?? runtimeId);
                agentAvailable = true;
            } catch (e) {
                logSwallowed(e, 'api.observability.getAgent');
            }

            const mcpStatus = sdkObservability.getMcpStatus();
            const nervMounted = sdkObservability.nervEventBusAdapter.isMounted;
            const hasRecentAgentErrors = recentErrors.some((e) => e.source === 'agent');

            /** @type {Record<string, { status: string; details?: string }>} */
            const components = {
                agent: {
                    status: componentStatus(agentAvailable, hasRecentAgentErrors),
                    ...(agentSnapshot
                        ? {
                              details: sdkRuntimeProjection.readAgentStatusValueForRuntime(
                                  requestedRuntimeId ?? runtimeId,
                              ),
                          }
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
                ...buildObservabilityRuntimeMeta(routeDeps),
                status: overallStatus,
                agent: agentSnapshot,
                components,
                observability: {
                    metricsActive: true,
                    errorTrackerBuffered: errorStats.buffered,
                    logRingBufferActive: true,
                    otelEnabled: sdkObservability.isOtelEnabled(),
                    otelFile: sdkObservability.defaultOtelFile,
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
            const routeDeps = resolveObservabilityRouterDeps(deps, req);
            const { sdkObservability } = routeDeps;
            const summary = sdkObservability.defaultMetrics.getSummary();
            // GAP-ROUTE-001: filtro opcional por prefixo de counter (ex: ?prefix=tool.)
            const prefix = typeof req.query?.['prefix'] === 'string' ? req.query['prefix'] : '';
            if (prefix && summary.counters) {
                /** @type {Record<string, number>} */
                const filtered = {};
                for (const [k, v] of Object.entries(summary.counters)) {
                    if (k.startsWith(prefix)) filtered[k] = v;
                }
                return res.json({
                    ok: true,
                    ...buildObservabilityRuntimeMeta(routeDeps),
                    ...summary,
                    counters: filtered,
                });
            }
            return res.json({ ok: true, ...buildObservabilityRuntimeMeta(routeDeps), ...summary });
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
            const routeDeps = resolveObservabilityRouterDeps(deps, req);
            const { sdkObservability } = routeDeps;
            const { snapshots, ts } = sdkObservability.getLastQuotaSnapshots();
            const hasData = Object.keys(snapshots).length > 0;
            res.json({
                ok: true,
                ...buildObservabilityRuntimeMeta(routeDeps),
                quotaSnapshots: snapshots,
                lastUpdated: ts || null,
                hasData,
            });
        }),
    );

    // ─── GET /observability/errors ────────────────────────────────────────────────

    router.get('/observability/errors', (req, res) =>
        withErrorHandler(req, res, async () => {
            const routeDeps = resolveObservabilityRouterDeps(deps, req);
            const { sdkObservability } = routeDeps;
            const n = Math.min(Number(req.query['n']) || 20, 100);
            const source = typeof req.query['source'] === 'string' ? req.query['source'] : undefined;
            const errors = sdkObservability.defaultErrorTracker.getErrors(n, source);
            res.json({ ok: true, ...buildObservabilityRuntimeMeta(routeDeps), errors, count: errors.length });
        }),
    );

    // ─── GET /observability/errors/stats ─────────────────────────────────────────

    router.get('/observability/errors/stats', (req, res) =>
        withErrorHandler(req, res, async () => {
            const routeDeps = resolveObservabilityRouterDeps(deps, req);
            const { sdkObservability } = routeDeps;
            res.json({
                ok: true,
                ...buildObservabilityRuntimeMeta(routeDeps),
                ...sdkObservability.defaultErrorTracker.getStats(),
            });
        }),
    );

    // ─── GET /observability/logs ──────────────────────────────────────────────────

    router.get('/observability/logs', (req, res) =>
        withErrorHandler(req, res, async () => {
            const routeDeps = resolveObservabilityRouterDeps(deps, req);
            const { sdkObservability } = routeDeps;
            const n = Math.min(Number(req.query['n']) || 50, 200);
            const level = typeof req.query['level'] === 'string' ? req.query['level'].toUpperCase() : undefined;
            const entries = sdkObservability.getRecentLogs(n, level);
            res.json({ ok: true, ...buildObservabilityRuntimeMeta(routeDeps), entries, count: entries.length });
        }),
    );

    // ─── POST /observability/errors/clear ────────────────────────────────────────

    router.post('/observability/errors/clear', (req, res) =>
        withErrorHandler(req, res, async () => {
            const routeDeps = resolveObservabilityRouterDeps(deps, req);
            const { sdkObservability } = routeDeps;
            sdkObservability.defaultErrorTracker.clearErrors();
            sdkObservability.log('INFO', '[observability] Error buffer cleared via API');
            res.json({ ok: true, ...buildObservabilityRuntimeMeta(routeDeps) });
        }),
    );

    // ─── POST /observability/log-level ───────────────────────────────────────────

    router.post('/observability/log-level', (req, res) =>
        withErrorHandler(req, res, async () => {
            const routeDeps = resolveObservabilityRouterDeps(deps, req);
            const { level } = /** @type {{ level?: string }} */ (req.body ?? {});
            const valid = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];
            if (!level || !valid.includes(level.toUpperCase())) {
                res.status(400).json({
                    ok: false,
                    ...buildObservabilityRuntimeMeta(routeDeps),
                    error: `Invalid level. Valid: ${valid.join(', ')}`,
                });
                return;
            }
            const { log: obsLog } = await import('#copilot/observability/logger');
            obsLog.setLevel(/** @type {import('#copilot/observability/logger').LogLevel} */ (level.toUpperCase()));
            const { sdkObservability } = routeDeps;
            sdkObservability.log('INFO', `[observability] Log level changed to ${level.toUpperCase()} via API`);
            res.json({ ok: true, ...buildObservabilityRuntimeMeta(routeDeps), level: level.toUpperCase() });
        }),
    );

    // ─── GET /observability/audit ─────────────────────────────────────────────────

    router.get('/observability/audit', (req, res) =>
        withErrorHandler(req, res, async () => {
            const routeDeps = resolveObservabilityRouterDeps(deps, req);
            const { sdkObservability } = routeDeps;
            const n = Math.min(Number(req.query['n']) || 50, 200);
            const type = typeof req.query['type'] === 'string' ? req.query['type'] : undefined;
            let entries = sdkObservability.defaultAuditLog.getLast(n);
            if (type) {
                entries = entries.filter((e) => e.type === type);
            }
            res.json({ ok: true, ...buildObservabilityRuntimeMeta(routeDeps), entries, count: entries.length });
        }),
    );

    // ─── POST /observability/audit/flush ─────────────────────────────────────────

    router.post('/observability/audit/flush', (req, res) =>
        withErrorHandler(req, res, async () => {
            const routeDeps = resolveObservabilityRouterDeps(deps, req);
            const { sdkObservability } = routeDeps;
            await sdkObservability.defaultAuditLog.flush();
            sdkObservability.log('INFO', '[observability] Audit log flushed via API');
            res.json({ ok: true, ...buildObservabilityRuntimeMeta(routeDeps) });
        }),
    );

    // ─── GET /observability/audit-tail ───────────────────────────────────────────

    router.get('/observability/audit-tail', (req, res) =>
        withErrorHandler(req, res, async () => {
            const routeDeps = resolveObservabilityRouterDeps(deps, req);
            const { sdkObservability } = routeDeps;
            const n = Math.min(Math.max(Number(req.query['n']) || 50, 1), 500);
            const sessionId = typeof req.query['sessionId'] === 'string' ? req.query['sessionId'] : undefined;
            const tool = typeof req.query['tool'] === 'string' ? req.query['tool'] : undefined;
            let entries = sdkObservability.getAuditTail(n);
            if (sessionId) {
                entries = entries.filter((e) => e.sessionId === sessionId);
            }
            if (tool) {
                entries = entries.filter((e) => {
                    const record = /** @type {{ data?: { toolName?: string } } | null | undefined} */ (
                        /** @type {unknown} */ (e)
                    );
                    return record?.data?.toolName === tool;
                });
            }
            res.json({ ok: true, ...buildObservabilityRuntimeMeta(routeDeps), entries, count: entries.length });
        }),
    );

    // ─── GET /observability/otel-status ──────────────────────────────────────────

    router.get('/observability/otel-status', (_req, res) => {
        const routeDeps = resolveObservabilityRouterDeps(deps, /** @type {Req} */ (_req));
        const { sdkObservability } = routeDeps;
        res.json({
            ok: true,
            ...buildObservabilityRuntimeMeta(routeDeps),
            enabled: sdkObservability.isOtelEnabled(),
            endpoint: sdkObservability.otelExporterOtlpEndpoint ?? null,
            traceFile: sdkObservability.defaultOtelFile,
            spanTypes: ['session.boot'],
        });
    });

    // ─── GET /observability/events/catalog ───────────────────────────────────────

    router.get('/observability/events/catalog', (_req, res) => {
        const routeDeps = resolveObservabilityRouterDeps(deps, /** @type {Req} */ (_req));
        const { sdkObservability } = routeDeps;
        res.json({ ok: true, ...buildObservabilityRuntimeMeta(routeDeps), catalog: sdkObservability.getCatalog() });
    });

    // ─── GET /observability/events/dead-letter ────────────────────────────────────

    router.get('/observability/events/dead-letter', (req, res) => {
        const routeDeps = resolveObservabilityRouterDeps(deps, req);
        const { sdkObservability } = routeDeps;
        const limit = Math.min(Number(req.query['limit']) || 50, 200);
        const entries = sdkObservability.getDeadLetters(limit);
        res.json({ ok: true, ...buildObservabilityRuntimeMeta(routeDeps), entries, count: entries.length });
    });

    return router;
}
