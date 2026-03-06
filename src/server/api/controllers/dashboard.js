// @ts-nocheck
import express from 'express';
import jwt from 'jsonwebtoken';
import { createHash, timingSafeEqual } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import rateLimit from 'express-rate-limit';
import { log } from '#core/logger';
import { getJwtSecret, JWT_SIGN_OPTIONS } from '#core/jwt_config';
import { getRbacUserByUsername, verifyRbacCredentials } from '#infra/db/rbac_repo';
import { revokeToken } from '#infra/db/token_blocklist';
import denyIfDelegated from '../../middleware/deny_if_delegated.js';
import { authenticate } from '../../middleware/auth.js';
import dashboardTasksRouter from './dashboard_tasks.js';
import dashboardMissionsRouter from './dashboard_missions.js';
import dashboardEventsRouter from './dashboard_events.js';
import dashboardInferenceRouter from './dashboard_inference.js';
import dashboardAuditRouter from './dashboard_audit.js';

/** Constante/valor exportado: default. */
const router = express.Router();
const DASHBOARD_AUTH_PASSWORD_MIN_LENGTH = 12;
let telemetryAggregatorPromise = null;

/**
 * Rate limiter dedicado para endpoints de autenticação.
 * Mais estrito que o apiLimiter geral para proteção contra brute force.
 */
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 20, // máximo de 20 tentativas por janela por IP
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        error: 'Muitas tentativas de autenticação. Tente novamente em 15 minutos.',
        code: 'AUTH_RATE_LIMIT_EXCEEDED',
    },
    skipSuccessfulRequests: true, // logins bem-sucedidos não consomem cota; apenas falhas são
    // contabilizadas para bloquear ataques de brute force sem penalizar usuários legítimos
});

async function getTelemetryAggregator() {
    if (!telemetryAggregatorPromise) {
        telemetryAggregatorPromise = import('#server/dashboard-api/telemetry_aggregator')
            .then(module => module.default ?? module)
            .catch(err => {
                // Clear the cached promise so the next call can retry the import.
                // Without this, a single import failure permanently breaks all telemetry endpoints.
                telemetryAggregatorPromise = null;
                throw err;
            });
    }
    return telemetryAggregatorPromise;
}

function isDashboardAuthRequired() {
    return process.env.DASHBOARD_AUTH_REQUIRED !== 'false';
}

function getDashboardAuthCredentials() {
    const username = String(process.env.DASHBOARD_AUTH_USERNAME || '').trim();
    const password = String(process.env.DASHBOARD_AUTH_PASSWORD || '');

    if (!username) {
        throw new Error('DASHBOARD_AUTH_USERNAME ausente');
    }

    if (password.length < DASHBOARD_AUTH_PASSWORD_MIN_LENGTH) {
        throw new Error(
            `DASHBOARD_AUTH_PASSWORD invalida (minimo ${DASHBOARD_AUTH_PASSWORD_MIN_LENGTH} caracteres requerido)`
        );
    }

    return { username, password, role: 'admin' };
}

function safeCredentialMatch(input, expected) {
    // Hash both values to normalize buffer length, preventing length-based timing side-channels.
    // timingSafeEqual requires equal-length buffers; SHA-256 digests are always 32 bytes.
    // An early-return on length mismatch would leak the expected credential's length to timing attacks.
    const hashA = createHash('sha256')
        .update(String(input || ''))
        .digest();
    const hashB = createHash('sha256')
        .update(String(expected || ''))
        .digest();
    return timingSafeEqual(hashA, hashB);
}

function getBridgeMetrics() {
    // TaskSyncBridge is being deprecated in favor of a DB Event Feed.
    // Keep this endpoint for observability/compat.
    return {
        initialized: true,
        source: 'sqlite_ssot',
        legacy_filesystem_queue: false,
    };
}

/* --------------------------------------------------------------------------
   AUTHENTICATION - Sistema de Autenticação JWT
-------------------------------------------------------------------------- */

/**
 * POST /api/dashboard/auth/login
 * Faz login e retorna token JWT
 */
router.post('/auth/login', authLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;

        // Validação básica (em produção, verificar contra banco de dados)
        if (!username || !password) {
            return res.status(400).json({
                success: false,
                error: 'Username e password são obrigatórios',
                request_id: req.id,
            });
        }

        let authUser = { username, role: 'viewer', roles: ['viewer'], permissions: [] };

        if (isDashboardAuthRequired()) {
            let rbacUser = verifyRbacCredentials(username, password);
            if (!rbacUser) {
                let credentials;
                try {
                    credentials = getDashboardAuthCredentials();
                } catch (configErr) {
                    log('ERROR', `[AUTH] Configuração de autenticação inválida: ${configErr.message}`, req.id);
                    return res.status(503).json({
                        success: false,
                        error: 'Autenticação do dashboard indisponível por configuração inválida',
                        request_id: req.id,
                    });
                }

                const isValidUsername = safeCredentialMatch(username, credentials.username);
                const isValidPassword = safeCredentialMatch(password, credentials.password);
                if (!isValidUsername || !isValidPassword) {
                    log('WARN', `[AUTH] Login failed for user: ${username}`, req.id);
                    return res.status(401).json({
                        success: false,
                        error: 'Credenciais inválidas',
                        request_id: req.id,
                    });
                }

                // fallback de compatibilidade: credencial de env pode não existir em RBAC ainda.
                rbacUser = getRbacUserByUsername(credentials.username) || {
                    id: credentials.username,
                    username: credentials.username,
                    active: true,
                    role: credentials.role,
                    roles: [credentials.role],
                    permissions: [],
                    created_at_ms: Date.now(),
                    updated_at_ms: Date.now(),
                };
            }

            authUser = {
                username: rbacUser.username,
                role: rbacUser.role || 'viewer',
                roles:
                    Array.isArray(rbacUser.roles) && rbacUser.roles.length > 0
                        ? rbacUser.roles
                        : [rbacUser.role || 'viewer'],
                permissions: Array.isArray(rbacUser.permissions) ? rbacUser.permissions : [],
            };
        }

        // Gerar token JWT com jti (JWT ID) para suportar revogação no logout
        const jti = uuidv4();
        const token = jwt.sign(
            {
                id: authUser.username,
                username: authUser.username,
                role: authUser.role,
                roles: authUser.roles,
                permissions: authUser.permissions,
                jti,
            },
            getJwtSecret(),
            /** @type {import('jsonwebtoken').SignOptions} */ (JWT_SIGN_OPTIONS)
        );

        log('INFO', `[AUTH] User logged in: ${authUser.username}`, req.id);
        res.json({
            success: true,
            token,
            user: {
                id: authUser.username,
                username: authUser.username,
                role: authUser.role,
                roles: authUser.roles,
                permissions: authUser.permissions,
            },
            expires_in: 24 * 60 * 60, // 24 horas em segundos
            request_id: req.id,
        });
    } catch (err) {
        log('ERROR', `[AUTH] Login error: ${err.message}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Erro interno no login',
            request_id: req.id,
        });
    }
});

/**
 * POST /api/dashboard/auth/logout
 * SEC-02 FIX: Revoga o token JWT na blocklist para invalidação imediata.
 * O cliente também deve remover o token do localStorage.
 */
router.post('/auth/logout', authenticate, (req, res) => {
    const username = req.user?.username || 'unknown';
    const jti = req.user?.jti;
    const exp = req.user?.exp;

    // Revogar token na blocklist se tiver jti
    if (jti) {
        const expiresAtMs = exp ? Number(exp) * 1000 : Date.now() + 86400000;
        const revoked = revokeToken(jti, expiresAtMs);
        log('INFO', `[AUTH] User logged out: ${username} (token revogado: ${revoked})`, req.id);
    } else {
        log('INFO', `[AUTH] User logged out: ${username} (sem jti — token legado não revogado)`, req.id);
    }

    res.json({
        success: true,
        message: 'Logout realizado com sucesso. Token invalidado.',
        request_id: req.id,
    });
});

/**
 * GET /api/dashboard/auth/me
 * Retorna informações do usuário autenticado
 */
router.get('/auth/me', authenticate, (req, res) => {
    res.json({
        success: true,
        user: req.user,
        request_id: req.id,
    });
});

/* --------------------------------------------------------------------------
   TASKS + MISSIONS (SSOT-first)
-------------------------------------------------------------------------- */

router.use(dashboardTasksRouter);
router.use(dashboardMissionsRouter);
router.use(dashboardEventsRouter);
router.use(dashboardInferenceRouter);
router.use(dashboardAuditRouter);

/* --------------------------------------------------------------------------
   TELEMETRY - Métricas em Tempo Real (compat)
-------------------------------------------------------------------------- */

router.get('/telemetry/current', authenticate, async (req, res) => {
    try {
        const telemetryAggregator = await getTelemetryAggregator();
        const metrics = await telemetryAggregator.getCurrent();
        res.json({ success: true, metrics, request_id: req.id });
    } catch (err) {
        log('ERROR', `[DASHBOARD_API] Erro ao buscar telemetria: ${err.message}`, req.id);
        res.status(500).json({ success: false, error: 'Erro ao recuperar métricas', request_id: req.id });
    }
});

router.get('/telemetry/history', async (req, res) => {
    try {
        const telemetryAggregator = await getTelemetryAggregator();
        const history = telemetryAggregator.getFullHistory();
        res.json({ success: true, ...history, request_id: req.id });
    } catch (err) {
        log('ERROR', `[DASHBOARD_API] Erro ao buscar histórico: ${err.message}`, req.id);
        res.status(500).json({ success: false, error: 'Erro ao recuperar histórico', request_id: req.id });
    }
});

router.get('/telemetry/history/:metric', async (req, res) => {
    try {
        const telemetryAggregator = await getTelemetryAggregator();
        const metric = req.params.metric;
        const samples = parseInt(String(req.query.samples), 10) || 60;
        const history = telemetryAggregator.getHistory(metric, samples);

        if (history.error) {
            return res.status(400).json({ success: false, error: history.error, request_id: req.id });
        }

        res.json({ success: true, ...history, request_id: req.id });
    } catch (err) {
        log('ERROR', `[DASHBOARD_API] Erro ao buscar histórico: ${err.message}`, req.id);
        res.status(500).json({ success: false, error: 'Erro ao recuperar histórico', request_id: req.id });
    }
});

/* --------------------------------------------------------------------------
   ALERTS - Sistema de Alertas (compat)
-------------------------------------------------------------------------- */

router.get('/alerts', async (req, res) => {
    try {
        const telemetryAggregator = await getTelemetryAggregator();
        const alerts = telemetryAggregator.getActiveAlerts();
        res.json({ success: true, count: alerts.length, alerts, request_id: req.id });
    } catch (err) {
        log('ERROR', `[DASHBOARD_API] Erro ao buscar alertas: ${err.message}`, req.id);
        res.status(500).json({ success: false, error: 'Erro ao recuperar alertas', request_id: req.id });
    }
});

router.put('/alerts/thresholds', authenticate, denyIfDelegated, async (req, res) => {
    try {
        const telemetryAggregator = await getTelemetryAggregator();
        const thresholds = req.body;
        telemetryAggregator.setAlertThresholds(thresholds);
        res.json({ success: true, message: 'Thresholds atualizados', request_id: req.id });
    } catch (err) {
        log('ERROR', `[DASHBOARD_API] Erro ao atualizar thresholds: ${err.message}`, req.id);
        res.status(500).json({ success: false, error: 'Erro ao atualizar thresholds', request_id: req.id });
    }
});

/* --------------------------------------------------------------------------
   SYSTEM - Informações do Sistema (compat)
-------------------------------------------------------------------------- */

router.get('/system/health', async (req, res) => {
    try {
        const telemetryAggregator = await getTelemetryAggregator();
        const metrics = await telemetryAggregator.getCurrent();
        const alerts = telemetryAggregator.getActiveAlerts();
        const bridgeMetrics = getBridgeMetrics();

        let overallStatus = 'healthy';
        if (alerts.some(a => a.severity === 'critical')) {
            overallStatus = 'critical';
        } else if (alerts.length > 0) {
            overallStatus = 'warning';
        }

        const components = {
            api: { status: 'healthy', message: 'API responding' },
            queue: {
                status: metrics?.queue?.size > 500 ? 'warning' : 'healthy',
                message: `Queue size: ${metrics?.queue?.size || 0}`,
            },
            memory: {
                status:
                    metrics?.heap?.usage_percent > 90
                        ? 'critical'
                        : metrics?.heap?.usage_percent > 70
                          ? 'warning'
                          : 'healthy',
                message: `Heap: ${metrics?.heap?.usage_percent || 0}%`,
            },
            kernel: {
                status: bridgeMetrics.initialized ? 'healthy' : 'degraded',
                message: bridgeMetrics.initialized ? 'SSOT mode' : 'Not initialized',
            },
        };

        res.json({
            success: true,
            status: overallStatus,
            components,
            alerts_count: alerts.length,
            uptime_seconds: metrics?.uptime_seconds || 0,
            request_id: req.id,
        });
    } catch (err) {
        log('ERROR', `[DASHBOARD_API] Erro ao verificar health: ${err.message}`, req.id);
        res.status(500).json({
            success: false,
            status: 'error',
            error: 'Erro ao verificar status do sistema',
            request_id: req.id,
        });
    }
});

router.get('/system/info', async (req, res) => {
    try {
        const telemetryAggregator = await getTelemetryAggregator();
        const metrics = await telemetryAggregator.getCurrent();

        res.json({
            success: true,
            system: metrics?.system || {},
            versions: { node: process.version, platform: process.platform, arch: process.arch },
            request_id: req.id,
        });
    } catch (err) {
        log('ERROR', `[DASHBOARD_API] Erro ao buscar info: ${err.message}`, req.id);
        res.status(500).json({ success: false, error: 'Erro ao recuperar informações', request_id: req.id });
    }
});

/* --------------------------------------------------------------------------
   BRIDGE - Métricas do TaskSyncBridge (compat)
-------------------------------------------------------------------------- */

router.get('/bridge/metrics', async (req, res) => {
    try {
        const metrics = getBridgeMetrics();
        res.json({ success: true, metrics, request_id: req.id });
    } catch (err) {
        log('ERROR', `[DASHBOARD_API] Erro ao buscar métricas bridge: ${err.message}`, req.id);
        res.status(500).json({ success: false, error: 'Erro ao recuperar métricas do bridge', request_id: req.id });
    }
});

export default router;
