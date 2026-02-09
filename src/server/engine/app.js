// @ts-check - Type checking rigoroso habilitado (arquivo core)
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import helmet from 'helmet';
import { ROOT, LOG_DIR } from '#infra/fs/fs_utils';
import requestId from '../middleware/request_id.js';
import * as hardware from '#core/hardware';

/* --------------------------------------------------------------------------
   0. INSTÂNCIA SOBERANA
-------------------------------------------------------------------------- */

const app = express();

/* --------------------------------------------------------------------------
   0.5 PROXY AWARENESS (OBRIGATÓRIO EM CONTAINER / LB)
-------------------------------------------------------------------------- */
// Apenas para dev local: trust apenas loopback
// Em produção: configure explicitamente o número de proxies
if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1); // Trust first proxy only
} else {
    app.set('trust proxy', 'loopback'); // Trust apenas 127.0.0.1, ::1
}

/* --------------------------------------------------------------------------
   1. TRACEABILITY ABSOLUTA
-------------------------------------------------------------------------- */
app.use(requestId);

/* --------------------------------------------------------------------------
   1.1 RESPONSE TIMING (OBSERVABILIDADE)
-------------------------------------------------------------------------- */
app.use((req, res, next) => {
    const start = process.hrtime.bigint();

    // Hook ANTES de enviar headers (não após 'finish')
    const originalWriteHead = res.writeHead;
    res.writeHead = function (...args) {
        const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
        res.setHeader('X-Response-Time', `${durationMs.toFixed(2)}ms`);
        return originalWriteHead.apply(this, args);
    };

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
        'http://localhost:5173', // Vite dev server (porta padrão)
        'http://localhost:5174', // Vite dev server (porta alternativa)
        'http://localhost:5175', // Vite dev server (porta alternativa 2)
        'http://localhost:5176', // Vite dev server (porta alternativa 3)
        'http://172.17.0.2:5173', // Vite network access
        'http://172.17.0.2:5174', // Vite network access (alt)
        'http://172.17.0.2:5175', // Vite network access (alt 2)
        'http://172.17.0.2:5176', // Vite network access (alt 3)
        process.env.DASHBOARD_ORIGIN,
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
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
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
    legacyHeaders: false,
    skip: req => {
        // Skip rate limit para dev mode (requests locais)
        const isDev = process.env.NODE_ENV !== 'production';
        const isLocal = req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';
        return isDev && isLocal;
    },
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
const dashboardAssetsPath = path.join(dashboardV2Path, 'assets');

// Serve precompressed dashboard assets when available (.br / .gz) + long-term caching.
// The Vite build generates hashed asset filenames, making them safe for immutable caching.
app.use('/dashboard/assets', (req, res, next) => {
    const accept = String(req.headers['accept-encoding'] || '');
    const urlPath = req.path; // mounted path (ex: /index-abc.js)
    const rel = urlPath.replace(/^\/+/, '');
    const abs = path.join(dashboardAssetsPath, rel);

    if (accept.includes('br') && fs.existsSync(`${abs}.br`)) {
        req.url = `${req.url}.br`;
    } else if (accept.includes('gzip') && fs.existsSync(`${abs}.gz`)) {
        req.url = `${req.url}.gz`;
    }

    next();
});

app.use('/dashboard/assets', express.static(dashboardAssetsPath, {
    immutable: true,
    maxAge: '365d',
    setHeaders(res, filePath) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('Vary', 'Accept-Encoding');

        if (filePath.endsWith('.br')) {
            res.setHeader('Content-Encoding', 'br');
            res.type(filePath.slice(0, -3));
        } else if (filePath.endsWith('.gz')) {
            res.setHeader('Content-Encoding', 'gzip');
            res.type(filePath.slice(0, -3));
        }
    }
}));

// Serve non-asset dashboard files (index.html, icons, etc.) without aggressive caching.
app.use('/dashboard', express.static(dashboardV2Path, {
    etag: true,
    maxAge: 0,
    setHeaders(res, filePath) {
        if (filePath.endsWith('index.html')) {
            res.setHeader('Cache-Control', 'no-store');
        } else {
            res.setHeader('Cache-Control', 'no-cache');
        }
    }
}));

app.get(/^\/dashboard($|\/.*)/, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
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
        const mcpBase = app.locals && app.locals.mcp ? app.locals.mcp : null;
        const hardwareMetrics = typeof hardware.getAllMetrics === 'function' ? hardware.getAllMetrics() : {};

        let status = 'ready';

        // MCP upstreams (dynamic) - avoid stale snapshots.
        let mcp = mcpBase;
        try {
            const getter = app.locals && typeof app.locals.getMcpUpstreamsStatus === 'function'
                ? app.locals.getMcpUpstreamsStatus
                : null;
            const upstreams = getter ? getter() : null;
            if (upstreams && Array.isArray(upstreams)) {
                mcp = Object.assign({}, mcpBase || {}, { upstreams });
            }
        } catch (e) {
            // ignore
        }

        if (runtime) {
            const requiredKeys = app.locals && Array.isArray(app.locals.requiredReadiness)
                ? app.locals.requiredReadiness
                : Object.keys(runtime);

            // Non-required readiness hints
            try {
                if (mcp && Array.isArray(mcp.upstreams)) {
                    const requiredUpstreams = mcp.upstreams.filter(u => u?.required);
                    runtime.mcp_upstreams = requiredUpstreams.length === 0
                        ? true
                        : requiredUpstreams.every(u => !u?.enabled || u?.ready);
                }
            } catch (e) {
                // ignore
            }

            const allReady = requiredKeys.length > 0 ? requiredKeys.every(k => runtime[k] === true) : true;

            status = allReady ? 'ready' : 'not-ready';
        }

        const payload = Object.assign({ status, ts: Date.now(), runtime, mcp }, hardwareMetrics || {});
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

export default app;
export { apiLimiter };
