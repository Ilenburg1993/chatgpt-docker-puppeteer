#!/usr/bin/env node
// @ts-check
import _Impl from '#infra/proxy/chromeProxyService';
import * as fs from 'node:fs';
import * as dns from 'node:dns/promises';

/**
 * @typedef {Object} ChromeProxyConfig
 * @property {string | null} [PUBLIC_IP] - Public IP address (auto-detect if null)
 * @property {number} CHROME_PORT - Chrome debugging port (default: 9225)
 * @property {number} PROXY_PORT - Proxy listening port (default: 9224)
 * @property {string} CHROME_HOST - Chrome host address (default: host.docker.internal)
 * @property {string} PROXY_BIND - Proxy bind address (default: 0.0.0.0)
 */

/**
 * @typedef {Object} ParseIntSafeOptions
 * @property {number} [min] - Minimum allowed value (default: 1)
 * @property {number} [max] - Maximum allowed value (default: 65535)
 */

/**
 * Wrapper class - re-exposes important method names for static checks
 * and delegates to the real implementation.
 *
 * @extends {_Impl}
 */
class ChromeProxyService extends _Impl {
    /**
     * @param {ChromeProxyConfig} config - Service configuration
     */
    constructor(config) {
        super(config);
    }

    /**
     * Rewrite WebSocket URL for Chrome DevTools Protocol
     * @param {string} url - Original WebSocket URL
     * @returns {string} Rewritten URL
     */
    rewriteWebSocketURL(url) {
        return super.rewriteWebSocketURL(url);
    }

    /**
     * Handle HTTP request proxying to Chrome
     * @param {import('http').IncomingMessage} req - HTTP request
     * @param {import('http').ServerResponse} res - HTTP response
     * @returns {void}
     */
    handleHTTPRequest(req, res) {
        return super.handleHTTPRequest(req, res);
    }

    /**
     * Handle WebSocket upgrade for Chrome DevTools Protocol
     * @param {import('http').IncomingMessage} req - HTTP request
     * @param {import('net').Socket} socket - TCP socket
     * @param {Buffer} head - First packet of upgraded stream
     * @returns {void}
     */
    handleWebSocketUpgrade(req, socket, head) {
        return super.handleWebSocketUpgrade(req, socket, head);
    }
}

/**
 * Parse and validate integer from environment variable with range checking
 *
 * @param {string | undefined} value - Raw environment variable value
 * @param {number} defaultValue - Fallback value if parsing fails or out of range
 * @param {string} varName - Variable name for warning messages
 * @param {ParseIntSafeOptions} [range] - Optional min/max range constraints
 * @returns {number} Parsed and validated integer
 *
 * @example
 * const port = parseIntSafe(process.env.PORT, 3000, 'PORT', { min: 1024, max: 65535 });
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
 * Parse and validate bind address (IPv4 or IPv6) with strict validation
 *
 * Validates that the address is a valid IP format. Accepts:
 * - IPv4: 0.0.0.0, 127.0.0.1, 192.168.1.1 (each octet 0-255, no leading zeros except "0")
 * - IPv6: ::, ::1, ::ffff:192.168.1.1, fe80::1, 2001:db8::1 (proper hex format, valid :: compression)
 *
 * Rejects:
 * - IPv4 out of range (256.1.1.1, 999.999.999.999)
 * - IPv4 with leading zeros (01.02.03.04)
 * - IPv6 malformed (:::1, ::1::2, groups > 4 hex digits)
 * - Hostnames (localhost) and random strings
 *
 * @param {string | undefined} value - Raw bind address value
 * @param {string} defaultValue - Fallback address if invalid
 * @returns {string} Validated bind address
 *
 * @example
 * const bind = parseBindSafe(process.env.BIND_ADDR, '0.0.0.0');
 * // Valid: '0.0.0.0', '127.0.0.1', '::', '::1', 'fe80::1'
 * // Invalid: '256.1.1.1', ':::1', 'localhost' → returns '0.0.0.0'
 */
function parseBindSafe(value, defaultValue) {
    const v = (value ?? '').trim();
    if (!v) return defaultValue;

    // ✅ ROBUST IPv4 validation: strict octet range (0-255), no leading zeros
    const isIPv4 = (() => {
        const parts = v.split('.');
        if (parts.length !== 4) return false;

        return parts.every(part => {
            const num = parseInt(part, 10);
            // Validate: is numeric, no leading zeros (except "0" itself), range 0-255
            return (
                /^\d+$/.test(part) &&
                (part === '0' || !part.startsWith('0')) &&
                num >= 0 &&
                num <= 255
            );
        });
    })();

    // ✅ ROBUST IPv6 validation: proper format, no malformed addresses
    const isIPv6 = (() => {
        // Special cases: unspecified (::) and loopback (::1)
        if (v === '::' || v === '::1') return true;

        // IPv6-mapped IPv4: ::ffff:x.x.x.x (validate IPv4 part)
        if (v.startsWith('::ffff:')) {
            const ipv4Part = v.substring(7);
            const parts = ipv4Part.split('.');
            if (parts.length === 4) {
                return parts.every(part => {
                    const num = parseInt(part, 10);
                    return /^\d+$/.test(part) && num >= 0 && num <= 255;
                });
            }
            return false;
        }

        // Standard IPv6 format validation
        // Must have 2-7 colons (at least :: or x:x, max 7 for 8 groups)
        const colonCount = (v.match(/:/g) || []).length;
        if (colonCount < 2 || colonCount > 7) return false;

        // Reject multiple :: compressions (only one allowed)
        const doubleColonCount = (v.match(/::/g) || []).length;
        if (doubleColonCount > 1) return false;

        // Reject malformed patterns like :::, ::::, etc.
        if (/:{3,}/.test(v)) return false;

        // Validate hex groups: each must be 1-4 hex digits
        const groups = v.split(':').filter(g => g !== ''); // Empty groups from :: are ok
        if (groups.length === 0 && v !== '::') return false; // ":" alone is invalid

        return groups.every(group => /^[0-9a-fA-F]{1,4}$/.test(group));
    })();

    if (!isIPv4 && !isIPv6) {
        console.warn(`[WARN] Invalid CHROME_PROXY_BIND="${v}", using default: ${defaultValue}`);
        return defaultValue;
    }

    return v;
}

/**
 * Detect if running inside a Docker container or Kubernetes pod (best-effort heuristic)
 *
 * Checks multiple indicators:
 * - Existence of /.dockerenv file
 * - Docker/containerd/kubepods in /proc/1/cgroup
 * - KUBERNETES_SERVICE_HOST environment variable
 * - container environment variable
 *
 * @returns {boolean} True if likely running in a container
 *
 * @example
 * if (isLikelyContainer()) {
 *   console.log('Running in container, using host.docker.internal');
 * }
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
 * Fast DNS check for host existence with timeout
 *
 * Performs a DNS lookup with a configurable timeout. Cleans up timer to prevent leaks.
 *
 * @param {string} host - Hostname or IP to resolve
 * @param {number} [timeoutMs=250] - Timeout in milliseconds (default: 250ms)
 * @returns {Promise<boolean>} True if host resolves, false if fails or times out
 *
 * @example
 * const accessible = await canResolve('host.docker.internal', 500);
 * if (!accessible) console.warn('Chrome host not accessible');
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
 * Extract default gateway IPv4 address from /proc/net/route (Linux containers)
 *
 * Parses the Linux routing table to find the default gateway.
 * Useful for Docker containers running on Linux engines (not Docker Desktop).
 *
 * @returns {string | null} Gateway IP address (e.g., '172.17.0.1') or null if not found
 *
 * @example
 * const gateway = getDefaultGatewayIPv4();
 * if (gateway) console.log(`Container gateway: ${gateway}`);
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
 * Intelligently resolve Chrome host address based on environment
 *
 * Resolution strategy (in priority order):
 * 1. Explicit CHROME_HOST environment variable (always wins)
 * 2. host.docker.internal (Docker Desktop / DevContainer - if resolvable)
 * 3. Default gateway IP (Linux containers - via /proc/net/route)
 * 4. localhost / 127.0.0.1 (fallback)
 *
 * @returns {Promise<string>} Resolved Chrome host address
 *
 * @example
 * const chromeHost = await resolveChromeHost();
 * // Docker Desktop: 'host.docker.internal'
 * // Linux container: '172.17.0.1' (gateway)
 * // Native: '127.0.0.1'
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
 * Get PM2 instance identifier for logging and clustering
 *
 * Checks multiple environment variables used by PM2 in different modes:
 * - NODE_APP_INSTANCE (PM2 cluster mode)
 * - pm_id (PM2 process ID)
 * - PM2_INSTANCE_ID (PM2 instance ID)
 *
 * @returns {string} Instance identifier (defaults to '0')
 *
 * @example
 * const tag = getInstanceTag();
 * console.log(`[pm2:${tag}] Starting...`);
 */
function getInstanceTag() {
    const inst = process.env.NODE_APP_INSTANCE ?? process.env.pm_id ?? process.env.PM2_INSTANCE_ID ?? '0';
    return String(inst);
}

/**
 * Create idempotent graceful shutdown handler with hard timeout
 *
 * Returns an async function that:
 * - Ensures shutdown runs only once (idempotent via closure)
 * - Attempts graceful service stop with timeout protection
 * - Exits process with specified exit code
 * - Aligns with PM2 kill_timeout to prevent forced kills
 *
 * @param {ChromeProxyService} svc - Service instance to stop
 * @param {number} timeoutMs - Maximum time to wait for graceful stop (ms)
 * @param {string} reason - Shutdown reason for logging ('graceful' or 'fatal')
 * @param {number} exitCode - Process exit code (0 = success, 1 = error)
 * @returns {() => Promise<void>} Async shutdown handler function
 *
 * @example
 * const shutdown = shutdownOnceFactory(service, 12000, 'graceful', 0);
 * process.on('SIGTERM', shutdown);
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
            // @ts-ignore - ChromeProxyService.stop() exists but TypeScript can't infer from ESM subpath import
            const stopPromise = typeof svc.stop === 'function'
                // @ts-ignore - ChromeProxyService.stop() exists
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

/**
 * Main entry point for Chrome Proxy Service
 *
 * Responsibilities:
 * - Parse and validate environment configuration
 * - Auto-detect Chrome host (Docker-aware)
 * - Validate port conflicts
 * - Perform network diagnostics (non-blocking)
 * - Initialize ChromeProxyService
 * - Setup PM2 lifecycle hooks (graceful shutdown, ready signal)
 * - Handle startup failures with proper cleanup
 *
 * @returns {Promise<void>}
 * @throws {Error} If service fails to start (port conflict, bind error, etc.)
 */
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
        // @ts-ignore - ChromeProxyService.start() exists but TypeScript can't infer from ESM subpath import
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
// @ts-ignore - Top-level await is supported in ESM (package.json has "type": "module")
await main();

export default ChromeProxyService;
