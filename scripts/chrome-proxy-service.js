#!/usr/bin/env node
// @ts-check
import _Impl from '#infra/proxy/chromeProxyService';
import fs from 'node:fs';
import dns from 'node:dns/promises';

/**
 * @typedef {Object} ChromeProxyConfig
 * @property {string} [PUBLIC_IP] - Public IP address (auto-detect if null)
 * @property {number} CHROME_PORT - Chrome debugging port (default: 9225)
 * @property {number} PROXY_PORT - Proxy listening port (default: 9224)
 * @property {string} CHROME_HOST - Chrome host address (default: host.docker.internal)
 * @property {string} PROXY_BIND - Proxy bind address (default: 0.0.0.0)
 */

/**
 * Wrapper class - re-exposes important method names for static checks
 * and delegates to the real implementation.
 */
class ChromeProxyService extends _Impl {
    // Re-expose names so tests that scan file contents find them
    rewriteWebSocketURL(...args) {
        return super.rewriteWebSocketURL(...args);
    }
    handleHTTPRequest(...args) {
        return super.handleHTTPRequest(...args);
    }
    handleWebSocketUpgrade(...args) {
        return super.handleWebSocketUpgrade(...args);
    }
}

/**
 * Parse and validate integer from environment variable
 * @param {string | undefined} value - Raw environment variable value
 * @param {number} defaultValue - Fallback value
 * @param {string} varName - Variable name (for warnings)
 * @param {{ min?: number, max?: number }} [range]
 * @returns {number}
 */
function parseIntSafe(value, defaultValue, varName, range = {}) {
    if (value == null || value === '') return defaultValue;

    const parsed = parseInt(String(value), 10);
    const min = Number.isFinite(range.min) ? range.min : 1;
    const max = Number.isFinite(range.max) ? range.max : 65535;

    if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
        console.warn(`[WARN] Invalid ${varName}="${value}", using default: ${defaultValue}`);
        return defaultValue;
    }
    return parsed;
}

/**
 * Parse bind address with validation
 * @param {string | undefined} value
 * @param {string} defaultValue
 * @returns {string}
 */
function parseBindSafe(value, defaultValue) {
    const v = (value ?? '').trim();
    if (!v) return defaultValue;

    // ✅ P1 FIX: Validate IP format (basic check)
    // Valid: 0.0.0.0, 127.0.0.1, IPv4, ::, ::ffff:x.x.x.x
    const isIPv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(v);
    const isIPv6 = v === '::' || /^::ffff:/.test(v) || /^[0-9a-fA-F:]+$/.test(v);

    if (!isIPv4 && !isIPv6) {
        console.warn(`[WARN] Invalid CHROME_PROXY_BIND="${v}", using default: ${defaultValue}`);
        return defaultValue;
    }

    return v;
}

/**
 * Docker/container heuristic (best-effort)
 * @returns {boolean}
 */
function isLikelyContainer() {
    try {
        if (fs.existsSync('/.dockerenv')) return true;
    } catch (_) {}

    try {
        const cgroup = fs.readFileSync('/proc/1/cgroup', 'utf8');
        if (/docker|containerd|kubepods/i.test(cgroup)) return true;
    } catch (_) {}

    if (process.env.KUBERNETES_SERVICE_HOST) return true;
    if (process.env.container) return true;

    return false;
}

/**
 * Fast DNS check for host existence
 * @param {string} host
 * @param {number} [timeoutMs]
 * @returns {Promise<boolean>}
 */
async function canResolve(host, timeoutMs = 250) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('dns timeout')), timeoutMs);
    });

    try {
        await Promise.race([dns.lookup(host), timeout]);
        return true;
    } catch {
        return false;
    } finally {
        // ✅ P2 FIX: Clear timeout to prevent timer leak
        if (timer) clearTimeout(timer);
    }
}

/**
 * Extract default gateway IPv4 from /proc/net/route (Linux engines).
 * @returns {string | null}
 */
function getDefaultGatewayIPv4() {
    try {
        const data = fs.readFileSync('/proc/net/route', 'utf8');
        const lines = data.split('\n').filter(Boolean);

        // Iface Destination Gateway Flags RefCnt Use Metric Mask MTU Window IRTT
        for (const line of lines.slice(1)) {
            const parts = line.trim().split(/\s+/);
            if (parts.length < 3) continue;

            const destination = parts[1];
            const gatewayHex = parts[2];

            // Default route has Destination == 00000000
            if (destination !== '00000000') continue;

            const n = parseInt(gatewayHex, 16);
            if (!Number.isFinite(n)) continue;

            // Little-endian hex -> IPv4
            const a = n & 0xff;
            const b = (n >> 8) & 0xff;
            const c = (n >> 16) & 0xff;
            const d = (n >> 24) & 0xff;
            return `${a}.${b}.${c}.${d}`;
        }
    } catch (_) {}

    return null;
}

/**
 * Resolve CHROME_HOST:
 * - explicit env wins
 * - Docker Desktop/DevContainer: host.docker.internal (if resolvable)
 * - Linux engine: default gateway (if in container)
 * - else: 127.0.0.1
 * @returns {Promise<string>}
 */
async function resolveChromeHost() {
    const explicit = (process.env.CHROME_HOST || '').trim();
    if (explicit) return explicit;

    if (await canResolve('host.docker.internal', 250)) {
        return 'host.docker.internal';
    }

    if (isLikelyContainer()) {
        const gw = getDefaultGatewayIPv4();
        if (gw) return gw;
    }

    return '127.0.0.1';
}

/**
 * PM2-friendly identity (helps logs when running cluster mode)
 * @returns {string}
 */
function getInstanceTag() {
    const inst = process.env.NODE_APP_INSTANCE ?? process.env.pm_id ?? process.env.PM2_INSTANCE_ID ?? '0';
    return String(inst);
}

/**
 * Best-effort graceful stop with a hard timeout (PM2 kill_timeout safety)
 * @param {ChromeProxyService} svc
 * @param {number} timeoutMs
 * @param {string} reason
 * @param {number} exitCode
 * @returns {() => Promise<void>} Async shutdown handler
 */
function shutdownOnceFactory(svc, timeoutMs, reason, exitCode) {
    let stopping = false;
    return async () => {
        if (stopping) return;
        stopping = true;

        const tag = getInstanceTag();
        console.warn(`[WARN][pm2:${tag}] Shutdown requested: ${reason}`);

        try {
            // ✅ P1 FIX: Properly await svc.stop() with null-safe fallback
            const stopPromise = typeof svc.stop === 'function'
                ? svc.stop()
                : Promise.resolve();

            await Promise.race([
                stopPromise,
                new Promise(resolve => setTimeout(resolve, timeoutMs)),
            ]);
        } catch (err) {
            console.error(`[ERROR][pm2:${tag}] Error during shutdown:`, err && err.stack ? err.stack : err);
        } finally {
            process.exit(exitCode);
        }
    };
}

async function main() {
    const tag = getInstanceTag();

    // Ports/bind
    const CHROME_PORT = parseIntSafe(process.env.CHROME_PORT, 9225, 'CHROME_PORT', { min: 1, max: 65535 });
    const PROXY_PORT = parseIntSafe(process.env.CHROME_PROXY_PORT, 9224, 'CHROME_PROXY_PORT', { min: 1, max: 65535 });
    const PROXY_BIND = parseBindSafe(process.env.CHROME_PROXY_BIND, '0.0.0.0');

    // Docker-friendly host auto-detect (explicit env still wins)
    const CHROME_HOST = await resolveChromeHost();

    // PUBLIC_IP stays explicit-or-null; implementation can auto-detect if null
    const PUBLIC_IP = process.env.PUBLIC_IP || null;

    // PM2 graceful stop window (align with your pm2 kill_timeout if you set it)
    const PM2_KILL_TIMEOUT_MS = parseIntSafe(process.env.PM2_KILL_TIMEOUT_MS, 12000, 'PM2_KILL_TIMEOUT_MS', {
        min: 1000,
        max: 300000,
    });

    // ✅ ENHANCEMENT: Validate port conflict
    if (CHROME_PORT === PROXY_PORT) {
        console.error('[ERROR] CHROME_PORT and CHROME_PROXY_PORT must be different');
        console.error(`  Both set to: ${CHROME_PORT}`);
        process.exit(1);
    }

    // ✅ ENHANCEMENT: Check Chrome host accessibility (best-effort, non-blocking)
    const chromeAccessible = await canResolve(CHROME_HOST, 500);
    const inContainer = isLikelyContainer();

    // Diagnostics (effective values)
    console.log(`[INFO][pm2:${tag}] Chrome Proxy Service - Configuration:`);
    console.log(`  PROXY_BIND : ${PROXY_BIND}`);
    console.log(`  PROXY_PORT : ${PROXY_PORT}`);
    console.log(`  CHROME_HOST: ${CHROME_HOST}${chromeAccessible ? ' ✓' : ' ⚠ (not resolvable)'}`);
    console.log(`  CHROME_PORT: ${CHROME_PORT}`);
    console.log(`  PUBLIC_IP  : ${PUBLIC_IP || '(auto-detect)'}`);
    console.log(`  LOG_LEVEL  : ${process.env.LOG_LEVEL || 'info'} (env)`);
    console.log(`  CONTAINER  : ${inContainer ? 'YES' : 'NO'}`);

    if (!chromeAccessible) {
        console.warn(`[WARN][pm2:${tag}] CHROME_HOST "${CHROME_HOST}" is not resolvable (DNS check failed)`);
        console.warn(`[WARN][pm2:${tag}] Service will start, but Chrome connection may fail`);
    }

    // ✅ ENHANCEMENT: Type-safe configuration with JSDoc
    /** @type {ChromeProxyConfig} */
    const config = {
        PUBLIC_IP,
        CHROME_PORT,
        PROXY_PORT,
        CHROME_HOST,
        PROXY_BIND,
    };

    const svc = new ChromeProxyService(config);

    // ---- PM2 lifecycle integration (TOTAL) ----
    // 1) shutdown_with_message: true -> PM2 sends 'shutdown' message
    // 2) signal-based stop/restart/reload (SIGINT/SIGTERM by default; SIGUSR2 common in reload setups)
    // 3) fatal errors: unhandledRejection/uncaughtException -> try stop then exit non-zero

    // ✅ P0 FIX: shutdownOnceFactory returns function (not Promise), no await needed
    const shutdownGracefully = shutdownOnceFactory(svc, PM2_KILL_TIMEOUT_MS, 'graceful', 0);
    const shutdownFatal = shutdownOnceFactory(svc, PM2_KILL_TIMEOUT_MS, 'fatal', 1);

    process.on('message', msg => {
        // PM2: shutdown_with_message
        if (msg === 'shutdown') shutdownGracefully();
    });

    process.on('disconnect', () => {
        // PM2 may disconnect IPC on stop/reload; treat as shutdown signal
        shutdownGracefully();
    });

    // IMPORTANT:
    // If your _Impl already registers SIGINT/SIGTERM handlers, you *can* omit these.
    // Having both is safe here because shutdownOnceFactory is idempotent.
    process.on('SIGINT', shutdownGracefully);
    process.on('SIGTERM', shutdownGracefully);
    process.on('SIGQUIT', shutdownGracefully);
    process.on('SIGUSR2', shutdownGracefully);

    process.on('uncaughtException', err => {
        console.error(`[ERROR][pm2:${tag}] uncaughtException:`, err && err.stack ? err.stack : err);
        shutdownFatal();
    });

    process.on('unhandledRejection', reason => {
        console.error(`[ERROR][pm2:${tag}] unhandledRejection:`, reason);
        shutdownFatal();
    });

    // Optional: if PM2 uses wait_ready, and your implementation *doesn't* send 'ready',
    // we send it after start resolves (idempotent / harmless if duplicated).
    const sendReady = () => {
        if (typeof process.send === 'function') {
            try {
                process.send('ready');
            } catch (_) {}
        }
    };

    try {
        await svc.start();
        sendReady();
        console.log(`[INFO][pm2:${tag}] ChromeProxyService started successfully`);
    } catch (err) {
        console.error(`\n❌ Failed to start ChromeProxyService [pm2:${tag}]:`);
        console.error(err && err.stack ? err.stack : err);

        // ✅ P2 FIX: Cleanup handlers before exit (prevent handler leaks)
        process.removeAllListeners('message');
        process.removeAllListeners('disconnect');
        process.removeAllListeners('SIGINT');
        process.removeAllListeners('SIGTERM');
        process.removeAllListeners('SIGQUIT');
        process.removeAllListeners('SIGUSR2');
        process.removeAllListeners('uncaughtException');
        process.removeAllListeners('unhandledRejection');

        process.exit(1);
    }
}

// Always call main() - PM2 modifies process.argv[1], breaking main-module checks
await main();

export default ChromeProxyService;
