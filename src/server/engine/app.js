/* ==========================================================================
   src/server/engine/app.js
   Audit Level: 300 — Sovereign Express Engine (Production-Grade)
   Status: HARDENED / OBSERVABLE / FUTURE-PROOF

   Papel:
   Fundação HTTP do sistema.
   Pipeline Express puro, determinístico e auditável.
========================================================================== */

const express = require('express');
const path = require('path');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const helmet = require('helmet');

const { ROOT, LOG_DIR } = require('@infra/fs/fs_utils');
const requestId = require('../middleware/request_id');
const hardware = require('@core/hardware');

/* --------------------------------------------------------------------------
   0. INSTÂNCIA SOBERANA
-------------------------------------------------------------------------- */

const app = express();

/* --------------------------------------------------------------------------
   0.5 PROXY AWARENESS (OBRIGATÓRIO EM CONTAINER / LB)
-------------------------------------------------------------------------- */
app.set('trust proxy', true);

/* --------------------------------------------------------------------------
   1. TRACEABILITY ABSOLUTA
-------------------------------------------------------------------------- */
app.use(requestId);

/* --------------------------------------------------------------------------
   1.1 RESPONSE TIMING (OBSERVABILIDADE)
-------------------------------------------------------------------------- */
app.use((req, res, next) => {
    const start = process.hrtime.bigint();

    res.on('finish', () => {
        const durationMs =
            Number(process.hrtime.bigint() - start) / 1_000_000;

        res.setHeader('X-Response-Time', `${durationMs.toFixed(2)}ms`);
    });

    next();
});

/* --------------------------------------------------------------------------
   2. HARDENING DE HEADERS HTTP
-------------------------------------------------------------------------- */
app.use(
    helmet({
        contentSecurityPolicy: false,
        crossOriginEmbedderPolicy: false,
        frameguard: { action: 'deny' },
        referrerPolicy: { policy: 'no-referrer' }
    })
);

/* --------------------------------------------------------------------------
   3. CORS DINÂMICO COM FALHA EXPLÍCITA
-------------------------------------------------------------------------- */

const allowedOrigins = new Set(
    [
        'http://localhost:3008',
        'http://127.0.0.1:3008',
        process.env.DASHBOARD_ORIGIN
    ].filter(Boolean)
);

app.use(
    cors({
        origin(origin, callback) {
            if (!origin) return callback(null, true);

            if (allowedOrigins.has(origin)) {
                return callback(null, true);
            }

            const err = new Error(`CORS blocked for origin: ${origin}`);
            err.status = 403;
            callback(err);
        },
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
        maxAge: 600
    })
);

/* --------------------------------------------------------------------------
   4. RATE LIMITER (EXPORTÁVEL)
-------------------------------------------------------------------------- */
const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false
});

/* --------------------------------------------------------------------------
   5. BODY PARSING DEFENSIVO
-------------------------------------------------------------------------- */

app.use(compression());

app.use((req, res, next) => {
    if (
        req.method !== 'GET' &&
        req.headers['content-type'] &&
        !req.headers['content-type'].includes('application/json')
    ) {
        return res.status(415).json({
            error: 'Unsupported Media Type',
            request_id: req.id
        });
    }
    next();
});

app.use(express.json({ limit: '10mb', strict: true }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

/* --------------------------------------------------------------------------
   6. STATIC ASSETS
-------------------------------------------------------------------------- */

app.use(express.static(path.join(ROOT, 'public')));

const dashboardV2Path = path.join(ROOT, 'src', 'dashboard-ui', 'dist');
app.use('/dashboard', express.static(dashboardV2Path));

app.get(/^\/dashboard($|\/.*)/, (req, res) => {
    res.sendFile(path.join(dashboardV2Path, 'index.html'));
});

const crashReportsPath = path.join(LOG_DIR, 'crash_reports');
app.use('/crash_reports', express.static(crashReportsPath));

/* --------------------------------------------------------------------------
   7. OBSERVABILIDADE CANÔNICA
-------------------------------------------------------------------------- */

// Liveness
app.get('/health', (req, res) => {
    res.json({ status: 'alive', ts: Date.now() });
});

// Readiness
app.get('/ready', (req, res) => {
    try {
        const runtime = app.locals && app.locals.runtimeReadiness ? app.locals.runtimeReadiness : null;
        const hardwareMetrics = typeof hardware.getAllMetrics === 'function' ? hardware.getAllMetrics() : {};

        let status = 'ready';

        if (runtime) {
            const requiredKeys = app.locals && Array.isArray(app.locals.requiredReadiness)
                ? app.locals.requiredReadiness
                : Object.keys(runtime);

            const allReady = requiredKeys.length > 0 ? requiredKeys.every(k => runtime[k] === true) : true;

            status = allReady ? 'ready' : 'not-ready';
        }

        const payload = Object.assign({ status, ts: Date.now(), runtime }, hardwareMetrics || {});
        res.json(payload);
    } catch (err) {
        res.status(500).json({ status: 'unknown', error: err && err.message ? err.message : String(err) });
    }
});

/* --------------------------------------------------------------------------
   8. FALLBACK CONTROLADO
-------------------------------------------------------------------------- */
app.use((req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.status(404).json({ error: 'Not found', request_id: req.id });
});

/* --------------------------------------------------------------------------
   9. ERROR BOUNDARY GLOBAL
-------------------------------------------------------------------------- */
app.use((err, req, res, next) => {
    const status = err.status || 500;

    res.status(status).json({
        error: err.message || 'Internal server error',
        request_id: req.id || null
    });
});

/* --------------------------------------------------------------------------
   EXPORTS
-------------------------------------------------------------------------- */

module.exports = app;
module.exports.apiLimiter = apiLimiter;
