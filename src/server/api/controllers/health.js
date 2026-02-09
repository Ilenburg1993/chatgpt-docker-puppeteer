// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { log } from '#core/logger';
import { resolveDbPath } from '#infra/db/sqlite';
import { _resolveArtifactsRoot } from '#infra/storage/artifact_store';
import fs from 'node:fs/promises';

/**
 * GET /api/health - Health check geral do sistema
 */
async function getHealth(req, res) {
    try {
        res.json({
            status: 'ok',
            timestamp: Date.now(),
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            pid: process.pid
        });
    } catch (err) {
        log('ERROR', `[HEALTH] Erro no health check: ${err.message}`);
        res.status(500).json({ status: 'error', message: err.message });
    }
}

/**
 * GET /api/health/chrome - Health check do Chrome remote debugging
 *
 * Verifica se Chrome está acessível via browserEndpoint consolidado.
 * Usa checkChromeHealth() centralizado (boot_resilience_manager).
 */
async function getChromeHealth(req, res) {
    try {
        const { checkChromeHealth, getBrowserEndpoint } = await import('#core/boot_resilience_manager');
        const browserEndpoint = getBrowserEndpoint();

        const isHealthy = await checkChromeHealth(browserEndpoint.url, 3000);

        if (isHealthy) {
            res.json({
                status: 'ok',
                endpoint: browserEndpoint.url,
                wsEndpoint: browserEndpoint.wsEndpoint || null,
                timestamp: Date.now()
            });
        } else {
            res.status(503).json({
                status: 'unavailable',
                endpoint: browserEndpoint.url,
                message: 'Chrome não está respondendo no endpoint configurado',
                timestamp: Date.now()
            });
        }
    } catch (err) {
        log('ERROR', `[HEALTH] Erro no Chrome health check: ${err.message}`);
        res.status(500).json({
            status: 'error',
            message: err.message,
            timestamp: Date.now()
        });
    }
}

/**
 * GET /api/health/pm2 - Health check dos processos PM2
 */
async function getPm2Health(req, res) {
    try {
        const pm2Bridge = await import('#server/realtime/bus/pm2_bridge');
        const snapshot = await pm2Bridge.refreshSnapshot();

        res.json({
            status: 'ok',
            processes: snapshot || [],
            timestamp: Date.now()
        });
    } catch (err) {
        log('ERROR', `[HEALTH] Erro no PM2 health check: ${err.message}`);
        res.status(500).json({ status: 'error', message: err.message });
    }
}

/**
 * GET /api/health/kernel - Health check do Kernel
 */
async function getKernelHealth(req, res) {
    try {
        const kernel = req.app?.locals?.kernel || null;
        const hasKernel = Boolean(kernel);

        if (!hasKernel) {
            return res.json({
                status: 'not_applicable',
                message: 'Kernel not injected in server process',
                timestamp: Date.now(),
            });
        }

        if (typeof kernel.getStatus === 'function') {
            return res.json({
                status: 'ok',
                kernel: kernel.getStatus(),
                timestamp: Date.now(),
            });
        }

        res.json({
            status: 'degraded',
            message: 'Kernel injected but getStatus() is unavailable',
            timestamp: Date.now(),
        });
    } catch (err) {
        log('ERROR', `[HEALTH] Erro no Kernel health check: ${err.message}`);
        res.status(500).json({ status: 'error', message: err.message });
    }
}

/**
 * GET /api/health/disk - Health check do disco
 */
async function getDiskHealth(req, res) {
    try {
        const dbPath = resolveDbPath();
        const artifactsDir = _resolveArtifactsRoot();

        const targets = [
            { name: 'db', path: dbPath },
            { name: 'artifacts', path: artifactsDir },
        ];

        /** @type {Record<string, any>} */
        const out = {};
        let okCount = 0;

        for (const t of targets) {
            const entry = { path: t.path, exists: false, statfs: null };
            try {
                await fs.stat(t.path);
                entry.exists = true;
            } catch (_) {
                entry.exists = false;
            }

            // Best-effort statfs (Node 20+)
            try {
                if (typeof fs.statfs === 'function') {
                    const s = await fs.statfs(t.path);
                    entry.statfs = {
                        bsize: s.bsize,
                        blocks: s.blocks,
                        bfree: s.bfree,
                        bavail: s.bavail,
                        free_bytes: Number(s.bsize) * Number(s.bavail),
                        total_bytes: Number(s.bsize) * Number(s.blocks),
                    };
                }
            } catch (_) {
                entry.statfs = null;
            }

            out[t.name] = entry;
            if (entry.exists) okCount += 1;
        }

        const status = okCount === targets.length ? 'ok' : 'degraded';
        res.json({ status, targets: out, timestamp: Date.now() });
    } catch (err) {
        log('ERROR', `[HEALTH] Erro no Disk health check: ${err.message}`);
        res.status(500).json({ status: 'error', message: err.message });
    }
}

export { getHealth, getChromeHealth, getPm2Health, getKernelHealth, getDiskHealth };
