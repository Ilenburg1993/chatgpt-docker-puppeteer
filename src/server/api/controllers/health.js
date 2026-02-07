// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { log } from '#core/logger';

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
        // TODO: Implementar check real do Kernel
        res.json({
            status: 'unknown',
            message: 'Kernel health check not implemented yet'
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
        // TODO: Implementar check real do disco
        res.json({
            status: 'unknown',
            message: 'Disk health check not implemented yet'
        });
    } catch (err) {
        log('ERROR', `[HEALTH] Erro no Disk health check: ${err.message}`);
        res.status(500).json({ status: 'error', message: err.message });
    }
}

export { getHealth, getChromeHealth, getPm2Health, getKernelHealth, getDiskHealth };
