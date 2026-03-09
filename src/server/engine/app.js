// @ts-check
import CONFIG from '#core/config';
import * as hardware from '#core/hardware';
import { log } from '#core/logger';
import { getRuntimeReadinessSummary } from '#core/runtime_resource_registry';
import { LOG_DIR, ROOT } from '#infra/fs/fs_utils';
import compression from 'compression';
import cors from 'cors';
import express from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import helmet from 'helmet';
import fs from 'node:fs';
import path from 'node:path';
import requestId from '../middleware/request_id.js';

/* --------------------------------------------------------------------------
   0. INSTÂNCIA SOBERANA
-------------------------------------------------------------------------- */

/** Constante/valor exportado: default. */
const app = express();
const RAG_MANIFEST_PATH = process.env.RAG_MANIFEST_PATH || '/home/node/.local/share/rag-index/manifest.v1.json';

function formatIsoSecond(/** @type {any} */ epochMs) {
    if (!Number.isFinite(epochMs)) return null;
    return new Date(epochMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function readRagReadiness() {
    try {
        const raw = fs.readFileSync(RAG_MANIFEST_PATH, 'utf8');
        const manifest = JSON.parse(raw);
        const updatedAt = Number(manifest?.updated_at);
        const now = Date.now();
        const hasIndexTimestamp = Number.isFinite(updatedAt);
        return {
            available: hasIndexTimestamp,
            index_mode: manifest?.last_index_mode || 'full',
            index_updated_at: hasIndexTimestamp ? updatedAt : null,
            index_updated_at_iso: hasIndexTimestamp ? formatIsoSecond(updatedAt) : null,
            index_freshness_ms: hasIndexTimestamp ? Math.max(0, now - updatedAt) : null,
        };
    } catch {
        return {
            available: false,
            index_mode: null,
            index_updated_at: null,
            index_updated_at_iso: null,
            index_freshness_ms: null,
        };
    }
}

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
/** @type {any} */ (app).use(requestId);

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
        return originalWriteHead.apply(this, /** @type {any} */ (args));
    };

    next();
});

/* --------------------------------------------------------------------------
   2. HARDENING DE HEADERS HTTP
-------------------------------------------------------------------------- */
// SEC-03 FIX: CSP configurada adequadamente para o dashboard React/Vite.
// Anteriormente desabilitada com contentSecurityPolicy: false.
app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", "'unsafe-inline'"], // Necessário para Vite/React em prod
                styleSrc: ["'self'", "'unsafe-inline'"], // Necessário para Tailwind/inline styles
                imgSrc: ["'self'", 'data:', 'blob:'],
                connectSrc: [
                    "'self'",
                    'ws://localhost:*',
                    'wss://localhost:*',
                    ...(process.env.DASHBOARD_ORIGIN ? [process.env.DASHBOARD_ORIGIN] : []),
                ],
                fontSrc: ["'self'", 'data:'],
                objectSrc: ["'none'"],
                frameAncestors: ["'none'"],
                baseUri: ["'self'"],
                formAction: ["'self'"],
            },
        },
        crossOriginEmbedderPolicy: false,
        frameguard: { action: 'deny' },
        referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
        hsts:
            process.env.NODE_ENV === 'production'
                ? { maxAge: 31536000, includeSubDomains: true, preload: true }
                : false,
    }),
);

/* --------------------------------------------------------------------------
   2.1 HSTS (HTTP Strict Transport Security) - FORÇADO EM PRODUÇÃO
-------------------------------------------------------------------------- */
if (process.env.NODE_ENV === 'production' || process.env.FORCE_HTTPS === 'true') {
    app.use((req, res, next) => {
        // HSTS já configurado via helmet acima; este middleware é mantido para compatibilidade
        // com ambientes que não usam helmet (ex: proxies reversos customizados)
        if (!res.getHeader('Strict-Transport-Security')) {
            res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
        }
        next();
    });
}

/* --------------------------------------------------------------------------
   3. CORS DINÂMICO (CONFIGURATION DRIVEN)
-------------------------------------------------------------------------- */

const corsOrigins = new Set();

function updateCorsOrigins() {
    corsOrigins.clear();

    // Add default/local origins
    const defaults = ['http://localhost:3008', 'http://127.0.0.1:3008', process.env.DASHBOARD_ORIGIN];

    defaults.filter(Boolean).forEach((o) => corsOrigins.add(o));

    // Add from CONFIG
    const configOrigins = CONFIG.ALLOWED_ORIGINS;
    if (Array.isArray(configOrigins)) {
        configOrigins.forEach((o) => corsOrigins.add(o));
    } else if (typeof configOrigins === 'string') {
        configOrigins
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .forEach((o) => corsOrigins.add(o));
    }

    log('INFO', `[SERVER] CORS origins updated: ${corsOrigins.size} allowed origins`);
}

// Inicializa e escuta mudanças
updateCorsOrigins();
if (typeof (/** @type {any} */ (CONFIG).on) === 'function') {
    /** @type {any} */ (CONFIG).on('updated', updateCorsOrigins);
}

app.use(
    cors({
        origin(origin, callback) {
            // Allow requests with no origin (like mobile apps or curl requests)
            if (!origin) return callback(null, true);

            if (corsOrigins.has(origin)) {
                return callback(null, true);
            }

            // Optional: Regex support or CIDR logic could be added here

            const err = new Error(`CORS blocked for origin: ${origin}`);
            err.status = 403;
            callback(err);
        },
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
        maxAge: 600,
    }),
);

/* --------------------------------------------------------------------------
   4. RATE LIMITER (EXPORTÁVEL)
-------------------------------------------------------------------------- */

/**
 * Rate limiter para endpoints da API. SEC-04 FIX: Removido skip total em desenvolvimento. Usa limite maior em
 * não-produção para facilitar testes sem desabilitar completamente a proteção.
 *
 * Limites:
 *
 * - produção: 100 req/min por IP
 * - desenvolvimento/staging: 2000 req/min por IP (mais permissivo para dev workflow)
 *
 * @type {ReturnType<typeof rateLimit>}
 */
const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max:
        process.env.NODE_ENV === 'production'
            ? parseInt(process.env.RATE_LIMIT_MAX || '100', 10)
            : parseInt(process.env.RATE_LIMIT_MAX_DEV || '2000', 10),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip || ''),
    message: {
        success: false,
        error: 'Muitas requisições. Tente novamente em breve.',
        code: 'RATE_LIMIT_EXCEEDED',
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
            request_id: req.id,
        });
    }
    return next();
});

app.use(express.json({ limit: '10mb', strict: true }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

/* --------------------------------------------------------------------------
   6. STATIC ASSETS
-------------------------------------------------------------------------- */

// Mount static middleware at /static to avoid conflicts with API routes (/v1/*, /api/*)
app.use('/static', express.static(path.join(ROOT, 'public')));

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

app.use(
    '/dashboard/assets',
    express.static(dashboardAssetsPath, {
        immutable: true,
        maxAge: '365d',
        setHeaders(res, filePath) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            res.setHeader('Vary', 'Accept-Encoding');

            if (filePath.endsWith('.br')) {
                res.setHeader('Content-Encoding', 'br');
                // Determine extension of the original file (drop the .br suffix)
                const _base = filePath.slice(0, -3);
                const _ext = path.extname(_base);
                if (_ext) {
                    // res.type expects an extension name without the leading dot (eg 'js', 'css')
                    res.type(_ext.slice(1));
                } else {
                    res.type('application/octet-stream');
                }
            } else if (filePath.endsWith('.gz')) {
                res.setHeader('Content-Encoding', 'gzip');
                const _base = filePath.slice(0, -3);
                const _ext = path.extname(_base);
                if (_ext) {
                    res.type(_ext.slice(1));
                } else {
                    res.type('application/octet-stream');
                }
            }
        },
    }),
);

// Serve non-asset dashboard files (index.html, icons, etc.) without aggressive caching.
app.use(
    '/dashboard',
    express.static(dashboardV2Path, {
        etag: true,
        maxAge: 0,
        setHeaders(res, filePath) {
            if (filePath.endsWith('index.html')) {
                res.setHeader('Cache-Control', 'no-store');
            } else {
                res.setHeader('Cache-Control', 'no-cache');
            }
        },
    }),
);

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
        const runtimeResources =
            app.locals && typeof app.locals.getRuntimeResourcesStatus === 'function'
                ? app.locals.getRuntimeResourcesStatus()
                : getRuntimeReadinessSummary({
                      owner: 'dashboard-web',
                      requiredComponents: ['http_server'],
                      allowDegradedReady: CONFIG.BOOT_DEGRADED_READY_ALLOWED !== false,
                  });
        const mcpBase = app.locals && app.locals.mcp ? app.locals.mcp : null;
        const hardwareMetrics = typeof hardware.getAllMetrics === 'function' ? hardware.getAllMetrics() : {};

        let status = 'ready';

        // MCP upstreams (dynamic) - avoid stale snapshots.
        let mcp = mcpBase;
        try {
            const getter =
                app.locals && typeof app.locals.getMcpUpstreamsStatus === 'function'
                    ? app.locals.getMcpUpstreamsStatus
                    : null;
            const upstreams = getter ? getter() : null;
            if (upstreams && Array.isArray(upstreams)) {
                mcp = Object.assign({}, mcpBase || {}, { upstreams });
            }
        } catch (/** @type {any} */ e) {
            // ignore
        }

        if (runtime) {
            const requiredKeys =
                app.locals && Array.isArray(app.locals.requiredReadiness)
                    ? app.locals.requiredReadiness
                    : Object.keys(runtime);

            // Non-required readiness hints
            try {
                if (mcp && Array.isArray(mcp.upstreams)) {
                    const requiredUpstreams = mcp.upstreams.filter((/** @type {any} */ u) => u?.required);
                    runtime.mcp_upstreams =
                        requiredUpstreams.length === 0
                            ? true
                            : requiredUpstreams.every((/** @type {any} */ u) => !u?.enabled || u?.ready);
                }
            } catch (/** @type {any} */ e) {
                // ignore
            }

            const allReady = requiredKeys.length > 0 ? requiredKeys.every((k) => runtime[k] === true) : true;

            status = allReady ? 'ready' : 'not-ready';
        }

        if (runtimeResources?.status === 'not-ready') {
            status = 'not-ready';
        } else if (status === 'ready' && runtimeResources?.status === 'degraded') {
            status = 'degraded';
        }

        const payload = Object.assign(
            { status, ts: Date.now(), runtime, runtime_resources: runtimeResources, mcp, rag: readRagReadiness() },
            hardwareMetrics || {},
        );
        res.json(payload);
    } catch (/** @type {any} */ err) {
        const _e = /** @type {any} */ (err);
        log('ERROR', `[STATUS] Health check failed: ${_e?.message || String(_e)}`);
        res.status(500).json({ status: 'unknown', error: 'Internal server error' });
    }
});

/* --------------------------------------------------------------------------
   8. FALLBACK CONTROLADO
-------------------------------------------------------------------------- */
app.use((req, res, next) => {
    // Allow /api/* and /v1/* (OpenAI-compatible endpoints)
    if (req.path.startsWith('/api') || req.path.startsWith('/v1')) return next();
    res.status(404).json({ error: 'Not found', request_id: req.id });
});

/* --------------------------------------------------------------------------
   9. ERROR BOUNDARY GLOBAL
-------------------------------------------------------------------------- */
app.use((/** @type {any} */ err, /** @type {any} */ req, /** @type {any} */ res, /** @type {any} */ next) => {
    const status = err.status || 500;
    log('ERROR', `[APP] Unhandled error: ${err?.message || String(err)}${err?.stack ? `\n${err.stack}` : ''}`);

    res.status(status).json({
        error: status >= 500 ? 'Internal server error' : err.message || 'Request failed',
        request_id: req.id || null,
    });
});

export default app;
export { apiLimiter };
