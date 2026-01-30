/* ==========================================================================
   src/server/api/router.js
   Audit Level: 800 — Sovereign API Gateway (Production-Grade)
   Status: HARDENED / GOVERNED / OBSERVABLE

   Papel:
   Gateway semântico da API.
   Define domínios, versionamento, governança e error boundaries.
========================================================================== */

const { log } = require('@core/logger');
const { apiLimiter } = require('@server/engine/app');

const tasksController = require('./controllers/tasks');
const dashboardController = require('./controllers/dashboard');
const missionsController = require('./controllers/missions');
const systemController = require('./controllers/system');
const dnaController = require('./controllers/dna');

const denyIfDelegated = require('../middleware/deny_if_delegated');
const { notFound, errorHandler } = require('../middleware/error_handler');

/* --------------------------------------------------------------------------
   0. HELPERS CANÔNICOS
-------------------------------------------------------------------------- */

/**
 * Wrapper padrão para endpoints de health/infra.
 * Garante shape consistente e tratamento uniforme de falhas.
 */
function healthEndpoint(component, handler) {
    return async (req, res) => {
        try {
            const data = await handler(req);
            res.status(200).json({
                status: 'healthy',
                component,
                timestamp: new Date().toISOString(),
                ...data
            });
        } catch (err) {
            log('WARN', `[HEALTH:${component}] ${err.message}`);
            res.status(503).json({
                status: 'unhealthy',
                component,
                timestamp: new Date().toISOString(),
                error: err.message
            });
        }
    };
}

/**
 * Injeta metadados de domínio no request para observabilidade.
 */
function domain(domainName) {
    return (req, _res, next) => {
        req.domain = domainName;
        next();
    };
}

/* --------------------------------------------------------------------------
   ROUTER PRINCIPAL
-------------------------------------------------------------------------- */

function applyRoutes(app) {
    log('INFO', '[GATEWAY] Inicializando API Gateway V800');

    /* ----------------------------------------------------------------------
       1. VERSIONAMENTO CANÔNICO
    ---------------------------------------------------------------------- */

    const api = '/api/v1';

    /* ----------------------------------------------------------------------
       2. HEALTH & INFRA (NÃO RATE-LIMITADOS)
    ---------------------------------------------------------------------- */

    app.get(
        `${api}/health`,
        healthEndpoint('core', async () => ({
            uptime_seconds: Math.floor(process.uptime())
        }))
    );

    app.get(
        `${api}/health/chrome`,
        healthEndpoint('chrome', async () => {
            const doctor = require('@core/doctor');
            const chrome = await doctor.probeChromeConnection();
            return { chrome };
        })
    );

    app.get(
        `${api}/health/system`,
        healthEndpoint('system', async () => {
            const system = require('@infra/system');
            return await system.getAgentStatus();
        })
    );

    app.get(
        `${api}/metrics`,
        async (req, res) => {
            try {
                const hardware = require('@core/hardware');
                res.json({
                    status: 'ok',
                    timestamp: Date.now(),
                    metrics: hardware.getAllMetrics()
                });
            } catch (e) {
                res.status(500).json({
                    status: 'error',
                    timestamp: Date.now(),
                    error: e.message
                });
            }
        }
    );

    /* ----------------------------------------------------------------------
       3. DOMÍNIOS SOBERANOS (RATE-LIMITED)
    ---------------------------------------------------------------------- */

    app.use(
        `${api}/tasks`,
        apiLimiter,
        domain('tasks'),
        tasksController
    );

    app.use(
        `${api}/queue`,
        apiLimiter,
        domain('queue'),
        tasksController
    );

    app.use(
        `${api}/results`,
        apiLimiter,
        domain('results'),
        tasksController
    );

    app.use(
        `${api}/system`,
        apiLimiter,
        domain('system'),
        systemController
    );

    app.use(
        `${api}/config`,
        apiLimiter,
        domain('config'),
        denyIfDelegated,
        dnaController
    );

    app.use(
        `${api}/missions`,
        apiLimiter,
        domain('missions'),
        missionsController
    );

    app.use(
        `${api}/dashboard`,
        apiLimiter,
        domain('dashboard'),
        dashboardController
    );

    /* ----------------------------------------------------------------------
       4. ERROR BOUNDARY GLOBAL
    ---------------------------------------------------------------------- */

    app.use(notFound);
    app.use(errorHandler);

    log('INFO', '[GATEWAY] API Gateway V800 operacional');
}

module.exports = { applyRoutes };
