// @ts-check
import { log } from '#core/logger';
import { resolveDbPath } from '#infra/db/sqlite';
import { _resolveArtifactsRoot } from '#infra/storage/artifact_store';
import fs from 'node:fs/promises';

/**
 * @typedef {{ app?: { locals?: { kernel?: { getStatus?: () => unknown } } } }} HealthRequestLike
 *
 * @typedef {{ json: (payload: unknown) => unknown; status: (code: number) => HealthResponseLike }} HealthResponseLike
 *
 * @typedef {{
 *     bsize: number;
 *     blocks: number;
 *     bfree: number;
 *     bavail: number;
 *     free_bytes: number;
 *     total_bytes: number;
 * }} DiskStatfsSummary
 *
 *
 * @typedef {{ path: string; exists: boolean; statfs: DiskStatfsSummary | null }} DiskHealthEntry
 */

/**
 * GET /api/health - Health check geral do sistema.
 *
 * **Side-effects:** Coleta métricas de sistema (uptime, memória, PID). **Semântica:** Verificação básica de saúde do
 * processo Node.js. **Unidades:** uptime em segundos, memory em bytes, timestamp em milissegundos.
 *
 * @param {HealthRequestLike} req - Requisição HTTP
 * @param {HealthResponseLike} res - Resposta HTTP
 * @returns {Promise<void>}
 */
async function getHealth(req, res) {
    try {
        res.json({
            status: 'ok',
            timestamp: Date.now(),
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            pid: process.pid,
        });
    } catch (/** @type {any} */ err) {
        const _e = /** @type {any} */ (err);
        log('ERROR', `[HEALTH] Erro no health check: ${_e.message}`);
        res.status(500).json({ status: 'error', message: _e.message });
    }
}

/**
 * GET /api/health/chrome - Health check do Chrome remote debugging.
 *
 * **Side-effects:** Testa conectividade com Chrome via WebSocket endpoint. **Semântica:** Verifica se Chrome está
 * acessível e respondendo. **Unidades:** Timeout de 3000ms para verificação.
 *
 * @param {HealthRequestLike} req - Requisição HTTP
 * @param {HealthResponseLike} res - Resposta HTTP
 * @returns {Promise<void>}
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
                timestamp: Date.now(),
            });
        } else {
            res.status(503).json({
                status: 'unavailable',
                endpoint: browserEndpoint.url,
                message: 'Chrome não está respondendo no endpoint configurado',
                timestamp: Date.now(),
            });
        }
    } catch (/** @type {any} */ err) {
        const _e = /** @type {any} */ (err);
        log('ERROR', `[HEALTH] Erro no Chrome health check: ${_e.message}`);
        res.status(500).json({
            status: 'error',
            message: _e.message,
            timestamp: Date.now(),
        });
    }
}

/**
 * GET /api/health/pm2 - Health check dos processos PM2
 *
 * @param {HealthRequestLike} req
 * @param {HealthResponseLike} res
 * @returns {Promise<void>}
 */
async function getPm2Health(req, res) {
    try {
        const pm2Bridge = await import('#server/realtime/bus/pm2_bridge');
        const snapshot = await pm2Bridge.refreshSnapshot();

        res.json({
            status: 'ok',
            processes: snapshot || [],
            timestamp: Date.now(),
        });
    } catch (/** @type {any} */ err) {
        const _e = /** @type {any} */ (err);
        log('ERROR', `[HEALTH] Erro no PM2 health check: ${_e.message}`);
        res.status(500).json({ status: 'error', message: _e.message });
    }
}

/**
 * GET /api/health/kernel - Health check do Kernel
 *
 * @param {HealthRequestLike} req
 * @param {HealthResponseLike} res
 * @returns {Promise<void>}
 */
async function getKernelHealth(req, res) {
    try {
        const kernel = req.app?.locals?.kernel || null;
        const hasKernel = Boolean(kernel);

        if (!hasKernel) {
            res.json({
                status: 'not_applicable',
                message: 'Kernel not injected in server process',
                timestamp: Date.now(),
            });
            return;
        }

        if (typeof (/** @type {any} */ (kernel).getStatus) === 'function') {
            res.json({
                status: 'ok',
                kernel: /** @type {any} */ (kernel).getStatus(),
                timestamp: Date.now(),
            });
            return;
        }

        res.json({
            status: 'degraded',
            message: 'Kernel injected but getStatus() is unavailable',
            timestamp: Date.now(),
        });
    } catch (/** @type {any} */ err) {
        const _e = /** @type {any} */ (err);
        log('ERROR', `[HEALTH] Erro no Kernel health check: ${_e.message}`);
        res.status(500).json({ status: 'error', message: _e.message });
    }
}

/**
 * GET /api/health/disk - Health check do disco
 *
 * @param {HealthRequestLike} req
 * @param {HealthResponseLike} res
 * @returns {Promise<void>}
 */
async function getDiskHealth(req, res) {
    try {
        const dbPath = resolveDbPath();
        const artifactsDir = _resolveArtifactsRoot();

        const targets = [
            { name: 'db', path: dbPath },
            { name: 'artifacts', path: artifactsDir },
        ];

        /** @type {Record<string, DiskHealthEntry>} */
        const out = {};
        let okCount = 0;

        for (const t of targets) {
            const entry = { path: t.path, exists: false, statfs: null };
            try {
                await fs.stat(t.path);
                entry.exists = true;
            } catch (/** @type {any} */ _) {
                entry.exists = false;
            }

            // Best-effort statfs (Node 20+)
            try {
                if (typeof fs.statfs === 'function') {
                    const s = await fs.statfs(t.path);
                    /** @type {any} */ (entry).statfs = {
                        bsize: s.bsize,
                        blocks: s.blocks,
                        bfree: s.bfree,
                        bavail: s.bavail,
                        free_bytes: Number(s.bsize) * Number(s.bavail),
                        total_bytes: Number(s.bsize) * Number(s.blocks),
                    };
                }
            } catch (/** @type {any} */ _) {
                entry.statfs = null;
            }

            out[t.name] = entry;
            if (entry.exists) okCount += 1;
        }

        const status = okCount === targets.length ? 'ok' : 'degraded';
        res.json({ status, targets: out, timestamp: Date.now() });
    } catch (/** @type {any} */ err) {
        const _e = /** @type {any} */ (err);
        log('ERROR', `[HEALTH] Erro no Disk health check: ${_e.message}`);
        res.status(500).json({ status: 'error', message: _e.message });
    }
}

export { getChromeHealth, getDiskHealth, getHealth, getKernelHealth, getPm2Health };
