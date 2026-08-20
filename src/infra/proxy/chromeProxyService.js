// @ts-check
/**
 * @import {
 *   IncomingMessage,
 *   ServerResponse
 * } from 'http'
 */
/** @import {Socket} from 'net' */
/** @import {RequestOptions} from 'node:http' */
/**
 * @version 3.1.0
 * @file Chrome Proxy Service v3.1 - Production-grade HTTP/WebSocket proxy for Chrome DevTools Protocol
 *
 *   Features:
 *
 *   - Circuit breaker pattern for fault tolerance
 *   - Rate limiting (per-IP and global WebSocket limits)
 *   - Origin validation (CORS + WebSocket security)
 *   - Prometheus metrics exposure
 *   - PM2 integration with graceful shutdown
 *   - Idle connection timeout with keep-alive
 *   - IPv6-mapped IP normalization
 *
 * @author Claude Sonnet 4.5
 */

// @ts-check - Type checking rigoroso habilitado (arquivo core)
import * as logger from '#core/logger';
import compression from 'compression';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { AsyncLocalStorage } from 'node:async_hooks';
import * as http from 'node:http';
import * as net from 'node:net';
import * as os from 'node:os';
import * as promClient from 'prom-client';
import { v4 as uuidv4 } from 'uuid';

/**
 * @typedef {object} ChromeProxyServiceConfig
 * @property {number} PROXY_PORT - Proxy listening port (default: 9224)
 * @property {string} CHROME_HOST - Chrome host address (default: host.docker.internal)
 * @property {number} CHROME_PORT - Chrome debugging port (default: 9225)
 * @property {string} PROXY_BIND - Proxy bind address (default: 0.0.0.0)
 * @property {string | null} [PUBLIC_IP] - Public IP for external access (auto-detect if null)
 * @property {string} [LOG_LEVEL] - Logging level (default: 'info')
 * @property {string[]} [ALLOWED_ORIGINS] - CORS allowed origins
 * @property {boolean} [AUTO_HANDLE_SIGNALS] - Register SIGINT/SIGTERM handlers internally (default: true)
 */

/**
 * @typedef {object} CircuitBreakerState
 * @property {'CLOSED' | 'OPEN' | 'HALF_OPEN'} state - Current circuit breaker state
 * @property {number} failures - Number of consecutive failures
 * @property {number} nextAttempt - Milliseconds remaining until next attempt (0 if not waiting)
 */

/**
 * @typedef {object} ProxyStats
 * @property {number} httpRequests - Total HTTP requests proxied
 * @property {number} wsUpgrades - Total WebSocket upgrades
 * @property {number} errors - Total errors encountered
 * @property {number} startTime - Service start timestamp
 * @property {number} cacheHits - Cache hits
 * @property {number} cacheMisses - Cache misses
 */

// NERV integration (optional) - lazy loaded
/** @type {any} */ let createNERV = null;
/** @type {any} */ let HighLevelNERV = null;
/** @type {any} */ let ActionCode = null;
/** @type {any} */ let ActorRole = null;

import CONFIG from '#core/config';

// Configurações locais do proxy (sobrescrevem CONFIG se fornecidas via env)
const LOCAL_CONFIG = {
    PROXY_PORT: parseInt(String(process.env['CHROME_PROXY_PORT'] || CONFIG['CHROME_PROXY_PORT'] || '9224'), 10),
    CHROME_HOST: String(process.env['CHROME_HOST'] || CONFIG['CHROME_HOST'] || 'host.docker.internal'),
    CHROME_PORT: parseInt(String(process.env['CHROME_PORT'] || CONFIG['CHROME_PORT'] || '9225'), 10),
    PROXY_BIND: String(process.env['CHROME_PROXY_BIND'] || CONFIG['CHROME_PROXY_BIND'] || '0.0.0.0'),
    PUBLIC_IP: process.env['PUBLIC_IP'] || null,
    LOG_LEVEL: process.env['LOG_LEVEL'] || 'info',
    AUTO_HANDLE_SIGNALS: String(process.env['CHROME_PROXY_AUTO_HANDLE_SIGNALS'] || 'true').toLowerCase() !== 'false',
    ALLOWED_ORIGINS: process.env['ALLOWED_ORIGINS']
        ? process.env['ALLOWED_ORIGINS'].split(',')
        : ['http://localhost:3008', 'http://127.0.0.1:3008', 'http://localhost:8080', 'http://127.0.0.1:8080'],
};

/* ==========================================================================
   CircuitBreaker - Prevents cascading failures when Chrome is down
========================================================================== */

/**
 * Circuit breaker pattern implementation for fault tolerance
 *
 * States:
 *
 * - CLOSED: Normal operation, allows all requests
 * - OPEN: Too many failures, rejects all requests for timeout period
 * - HALF_OPEN: Testing if service recovered, allows limited requests
 *
 * @class
 */
class CircuitBreaker {
    /**
     * Create a circuit breaker
     *
     * @param {number} [threshold=5] - Number of failures before opening circuit. Default is `5`
     * @param {number} [timeout=30000] - Milliseconds to wait before attempting recovery. Default is `30000`
     * @param {string} [name='default'] - Circuit breaker identifier for logging. Default is `'default'`
     */
    constructor(threshold = 5, timeout = 30000, name = 'default') {
        /** @type {number} */
        this.failures = 0;
        /** @type {number} */
        this.threshold = threshold;
        /** @type {number} */
        this.timeout = timeout;
        /** @type {'CLOSED' | 'OPEN' | 'HALF_OPEN'} */
        this.state = 'CLOSED';
        /** @type {number} */
        this.nextAttempt = 0;
        /** @type {string} */
        this.name = name;
        /** @type {number} */
        this.successCount = 0;
    }

    /**
     * Execute function with circuit breaker protection
     *
     * @template T
     * @param {() => Promise<T>} fn - Async function to execute
     * @returns {Promise<T>} Result of function execution
     * @throws {Error} If circuit is OPEN and waiting period not elapsed
     */
    async call(fn) {
        if (this.state === 'OPEN') {
            if (Date.now() < this.nextAttempt) {
                const waitMs = this.nextAttempt - Date.now();
                throw new Error(`Circuit breaker [${this.name}] OPEN (retry in ${Math.ceil(waitMs / 1000)}s)`);
            }
            this.state = 'HALF_OPEN';
        }

        try {
            const result = await fn();
            this.onSuccess();
            return result;
        } catch (/** @type {any} */ err) {
            this.onFailure();
            throw err;
        }
    }

    /**
     * Record successful execution Resets failure count and transitions HALF_OPEN → CLOSED after 3 successes
     *
     * @returns {void}
     */
    onSuccess() {
        this.failures = 0;
        if (this.state === 'HALF_OPEN') {
            this.successCount++;
            // Require 3 successful calls to fully close the circuit
            if (this.successCount >= 3) {
                this.state = 'CLOSED';
                this.successCount = 0;
            }
        } else {
            this.state = 'CLOSED';
        }
    }

    /**
     * Record failed execution Opens circuit after threshold failures
     *
     * @returns {void}
     */
    onFailure() {
        this.failures++;
        this.successCount = 0;
        if (this.failures >= this.threshold) {
            this.state = 'OPEN';
            this.nextAttempt = Date.now() + this.timeout;
        }
    }

    /**
     * Get current circuit breaker state
     *
     * @returns {CircuitBreakerState} Current state with failure count and time remaining
     */
    getState() {
        return {
            state: this.state,
            failures: this.failures,
            nextAttempt: this.nextAttempt > Date.now() ? this.nextAttempt - Date.now() : 0,
        };
    }
}

/* ==========================================================================
   ChromeProxyService - Main Class
========================================================================== */

/**
 * Production-grade HTTP/WebSocket proxy for Chrome DevTools Protocol
 *
 * Features:
 *
 * - Circuit breaker for fault tolerance
 * - Per-IP and global WebSocket rate limiting
 * - Origin validation (CORS + WebSocket security)
 * - Prometheus metrics
 * - Graceful shutdown with PM2 integration
 * - Idle connection timeout
 * - IPv6-mapped IP normalization
 *
 * @class
 */
class ChromeProxyService {
    /**
     * Create Chrome Proxy Service instance
     *
     * @example
     *     const proxy = new ChromeProxyService({
     *         PROXY_PORT: 9224,
     *         CHROME_HOST: 'host.docker.internal',
     *         CHROME_PORT: 9225,
     *         PROXY_BIND: '0.0.0.0',
     *     });
     *     await proxy.start();
     *
     * @param {Partial<ChromeProxyServiceConfig>} [config={}] - Service configuration (merges with defaults). Default is
     *   `{}`
     */
    constructor(config = {}) {
        /** @type {ChromeProxyServiceConfig} */
        this.config = { ...LOCAL_CONFIG, ...config };

        // Validate config
        this._validateConfig();

        this.server = null;
        this.app = null;
        this.activeConnections = new Set();
        this._stopPromise = null;
        this._signalHandlersInstalled = false;
        this._signalHandlers = {
            sigint: null,
            sigterm: null,
        };
        this.stats = {
            httpRequests: 0,
            wsUpgrades: 0,
            errors: 0,
            startTime: Date.now(),
            cacheHits: 0,
            cacheMisses: 0,
        };

        this.logger = logger;
        this.asyncLocalStorage = new AsyncLocalStorage();

        // Prometheus metrics with labels
        try {
            // Default metrics are collected on scrape; no interval/timeout config needed.
            promClient.collectDefaultMetrics();
        } catch (/** @type {any} */ err) {
            this.log('warn', 'Failed to collect default metrics', { error: /** @type {any} */ (err).message });
        }

        this.metrics = {
            httpRequests: new promClient.Counter({
                name: 'chrome_proxy_http_requests_total',
                help: 'Total HTTP requests',
                labelNames: ['method', 'path', 'status'],
            }),
            wsUpgrades: new promClient.Counter({
                name: 'chrome_proxy_ws_upgrades_total',
                help: 'Total WebSocket upgrades',
                labelNames: ['success'],
            }),
            proxyErrors: new promClient.Counter({
                name: 'chrome_proxy_errors_total',
                help: 'Total proxy errors',
                labelNames: ['type'],
            }),
            activeConnections: new promClient.Gauge({
                name: 'chrome_proxy_active_connections',
                help: 'Active WebSocket connections',
            }),
            requestDuration: new promClient.Histogram({
                name: 'chrome_proxy_request_duration_seconds',
                help: 'Request duration in seconds',
                labelNames: ['method', 'path'],
                buckets: [0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5],
            }),
            cacheHits: new promClient.Counter({
                name: 'chrome_proxy_cache_hits_total',
                help: 'Cache hits',
            }),
            cacheMisses: new promClient.Counter({
                name: 'chrome_proxy_cache_misses_total',
                help: 'Cache misses',
            }),
            circuitBreakerState: new promClient.Gauge({
                name: 'chrome_proxy_circuit_breaker_state',
                help: 'Circuit breaker state (0=CLOSED, 1=HALF_OPEN, 2=OPEN)',
            }),
            // ✅ v3.0 New Metrics
            wsPerIPRejections: new promClient.Counter({
                name: 'chrome_proxy_ws_per_ip_rejections_total',
                help: 'Total WebSocket upgrades rejected due to per-IP limit',
            }),
            wsGlobalRejections: new promClient.Counter({
                name: 'chrome_proxy_ws_global_rejections_total',
                help: 'Total WebSocket upgrades rejected due to global limit',
            }),
            httpBuffered: new promClient.Counter({
                name: 'chrome_proxy_http_buffered_total',
                help: 'Total HTTP responses buffered for rewriting',
                labelNames: ['path'],
            }),
            httpStreamed: new promClient.Counter({
                name: 'chrome_proxy_http_streamed_total',
                help: 'Total HTTP responses streamed without buffering',
            }),
        };

        // Circuit breaker for Chrome connection
        this.circuitBreaker = new CircuitBreaker(5, 30000, 'chrome-connection');

        // Cache for /json/version
        this.cache = {
            version: null,
            versionTTL: 30000, // 30s cache
            versionExpires: 0,
        };

        // Detect PUBLIC_IP
        if (!this.config.PUBLIC_IP) {
            this.config.PUBLIC_IP = this._detectPublicIP();
        }

        // Initialize http-proxy (async — stores promise)
        this._proxyReady = this._initProxy();

        // Idle connection cleanup (5 minutes for LLM sessions)
        this._idleTimeoutMs = parseInt(process.env['WS_IDLE_TIMEOUT_MS'] || '300000', 10);
        this._idleCheckInterval = setInterval(
            () => this._cleanupIdleConnections(),
            Math.max(10000, this._idleTimeoutMs / 2),
        );

        // ✅ WebSocket Rate Limiting (DoS Protection)
        this.wsConnectionsPerIP = new Map(); // IP → count
        this.MAX_WS_GLOBAL = parseInt(process.env['CHROME_PROXY_MAX_WS_GLOBAL'] || '200', 10);
        this.MAX_WS_PER_IP = parseInt(process.env['CHROME_PROXY_MAX_WS_PER_IP'] || '20', 10);
        this.WS_IP_CLEANUP_INTERVAL = 60000; // Clean stale entries every 60s

        // ✅ P1.5: Store cleanup interval handle for graceful shutdown
        this._ipCleanupInterval = setInterval(() => {
            this._cleanupStaleIPEntries();
        }, this.WS_IP_CLEANUP_INTERVAL);
    }

    /**
     * Async initializer for http-proxy. Called from the constructor; result stored in this._proxyReady.
     *
     * @private
     */
    async _initProxy() {
        try {
            const httpProxy = /** @type {any} */ (await import('http-proxy').then((m) => m.default ?? m));
            this.wsProxy = httpProxy.createProxyServer({
                target: `http://${this.config.CHROME_HOST}:${this.config.CHROME_PORT}`,
                ws: true,
                changeOrigin: true,
            });
            this.wsProxy.on(
                'error',
                /** @type {(
    err: Error,
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse | import('node:net').Socket,
) => void} */ (
                    (err, _req, res) => {
                        this.stats.errors++;
                        this._incrementMetric(this.metrics.proxyErrors, { type: 'http_proxy' });
                        this.log('error', 'Proxy error', { error: err.message });
                        if ('writeHead' in res && !res.finished) {
                            try {
                                res.writeHead(502, { 'Content-Type': 'text/plain' });
                                res.end('Proxy error');
                            } catch (/** @type {any} */ writeErr) {
                                this.log('debug', 'Failed to send error response', {
                                    error: /** @type {any} */ (writeErr).message,
                                });
                            }
                        }
                    }
                ),
            );
        } catch (/** @type {any} */ err) {
            this.wsProxy = null;
            this.log('warn', 'http-proxy unavailable, falling back to raw socket method');
        }
    }

    /* ======================================================================
       Configuration Validation
    ====================================================================== */
    _validateConfig() {
        const required = ['PROXY_PORT', 'CHROME_HOST', 'CHROME_PORT'];
        const missing = required.filter((key) => !(/** @type {any} */ (this.config)[key]));

        if (missing.length > 0) {
            throw new Error(`Missing required config: ${missing.join(', ')}`);
        }

        // Validate port numbers
        if (!Number.isInteger(this.config.PROXY_PORT) || this.config.PROXY_PORT < 1 || this.config.PROXY_PORT > 65535) {
            throw new Error(`Invalid PROXY_PORT: ${this.config.PROXY_PORT}`);
        }

        if (
            !Number.isInteger(this.config.CHROME_PORT) ||
            this.config.CHROME_PORT < 1 ||
            this.config.CHROME_PORT > 65535
        ) {
            throw new Error(`Invalid CHROME_PORT: ${this.config.CHROME_PORT}`);
        }

        // Validate ALLOWED_ORIGINS
        if (!Array.isArray(this.config.ALLOWED_ORIGINS) || (this.config.ALLOWED_ORIGINS || []).length === 0) {
            throw new Error('ALLOWED_ORIGINS must be a non-empty array');
        }
    }

    /* ======================================================================
       Public IP Detection (Docker-aware)
    ====================================================================== */
    _detectPublicIP() {
        // 1. Env var (most reliable)
        if (process.env['PUBLIC_IP']) {
            this.log('debug', 'Using PUBLIC_IP from env', { ip: process.env['PUBLIC_IP'] });
            return process.env['PUBLIC_IP'];
        }

        // 2. Docker internal IP (container)
        const dockerInternal = this._getDockerInternalIP();
        if (dockerInternal) {
            this.log('debug', 'Detected Docker internal IP', { ip: dockerInternal });
            return dockerInternal;
        }

        // 3. Network interfaces (fallback)
        const scanResult = this._scanNetworkInterfaces();
        this.log('debug', 'Using scanned network interface IP', { ip: scanResult });
        return scanResult;
    }

    _getDockerInternalIP() {
        const interfaces = os.networkInterfaces();
        // Docker creates eth0 with IP 172.17.0.x or similar
        if (interfaces['eth0']) {
            const ipv4 = interfaces['eth0'].find(
                (iface) => iface.family === 'IPv4' && !iface.internal && iface.address.startsWith('172.'),
            );
            if (ipv4) return ipv4.address;
        }
        return null;
    }

    _scanNetworkInterfaces() {
        const interfaces = os.networkInterfaces();
        const preferredNames = ['Ethernet', 'Wi-Fi', 'eth0', 'wlan0', 'en0'];

        for (const name of preferredNames) {
            if (interfaces[name]) {
                const ipv4 = interfaces[name]?.find((iface) => iface.family === 'IPv4' && !iface.internal);
                if (ipv4) return ipv4.address;
            }
        }

        // Fallback: unknown non-internal IPv4
        for (const name in interfaces) {
            const ipv4 = interfaces[name]?.find((iface) => iface.family === 'IPv4' && !iface.internal);
            if (ipv4) return ipv4.address;
        }

        return '172.17.0.2'; // Docker default fallback
    }

    /* ======================================================================
       Logging with Correlation IDs
    ====================================================================== */
    /**
     * @param {any} level
     * @param {any} message
     * @param {any} [meta]
     */
    /**
     * @param {any} level
     * @param {any} message
     * @param {any} [meta]
     */
    log(level, message, meta = {}) {
        const store = this.asyncLocalStorage.getStore();
        const correlationId = /** @type {any} */ (store)?.correlationId || meta.correlationId || 'unknown';

        const enrichedMeta = { ...meta, correlationId };
        const metaStr = ` [${correlationId.substring(0, 8)}]`;
        const metaJson = Object.keys(enrichedMeta).length > 1 ? ` ${JSON.stringify(enrichedMeta)}` : '';
        const formattedMessage = `[CHROME_PROXY]${metaStr} ${message}${metaJson}`;

        if (this.logger && typeof this.logger.log === 'function') {
            this.logger.log(level.toUpperCase(), formattedMessage);
        } else {
            const timestamp = new Date().toISOString();
            logger.info(`[${timestamp}] [${level.toUpperCase().padEnd(5)}] ${formattedMessage}`);
        }
    }

    /* ======================================================================
       Metrics Helper (replaces void err pattern)
    ====================================================================== */
    /**
     * @param {any} metric
     * @param {any} [labels]
     */
    /**
     * @param {any} metric
     * @param {any} [labels]
     */
    _incrementMetric(metric, labels = {}) {
        try {
            metric.inc(labels);
        } catch (/** @type {any} */ err) {
            // Non-critical: log once, don't spam
            this.log('debug', 'Metric increment failed (non-critical)', {
                metric: metric?.name || 'unknown',
                error: /** @type {any} */ (err).message,
            });
        }
    }

    /**
     * @param {any} metric
     * @param {any} value
     * @param {any} [labels]
     */
    /**
     * @param {any} metric
     * @param {any} value
     * @param {any} [labels]
     */
    _observeMetric(metric, value, labels = {}) {
        try {
            metric.observe(labels, value);
        } catch (/** @type {any} */ err) {
            this.log('debug', 'Metric observe failed (non-critical)', {
                metric: metric?.name || 'unknown',
                error: /** @type {any} */ (err).message,
            });
        }
    }

    /**
     * @param {any} metric
     * @param {any} value
     */
    /**
     * @param {any} metric
     * @param {any} value
     */
    _setMetric(metric, value) {
        try {
            metric.set(value);
        } catch (/** @type {any} */ err) {
            this.log('debug', 'Metric set failed (non-critical)', {
                metric: metric?.name || 'unknown',
                error: /** @type {any} */ (err).message,
            });
        }
    }

    /* ======================================================================
       NERV Integration (Optional)
    ====================================================================== */
    /**
     * @param {any} nerv
     */
    /**
     * @param {any} nerv
     */
    setNERV(nerv) {
        this.nerv = nerv; // ✅ Use this.nerv (not this._nerv) - align with all NERV adapters
        this.log('info', 'NERV integration enabled');
    }

    /**
     * @param {any} actionCode
     * @param {any} [payload]
     * @param {any} [correlationId]
     */
    /**
     * @param {any} actionCode
     * @param {any} [payload]
     * @param {any} [correlationId]
     */
    async _emitNervEvent(actionCode, payload = {}, correlationId = null) {
        try {
            if (!this.nerv || !HighLevelNERV || typeof HighLevelNERV.sendEvent !== 'function') {
                return null;
            }
            const actor = ActorRole.INFRA || 'INFRA';
            return await HighLevelNERV.sendEvent(this.nerv, actor, actionCode, payload, correlationId, null);
        } catch (/** @type {any} */ err) {
            this.log('debug', 'NERV publish failed (non-critical)', { error: /** @type {any} */ (err).message });
            return null;
        }
    }

    /* ======================================================================
       URL Rewriting (Chrome → Proxy)
    ====================================================================== */
    /**
     * @param {any} data
     * @param {any} hostFallback
     */
    /**
     * @param {any} data
     * @param {any} hostFallback
     */
    rewriteWebSocketURL(data, hostFallback) {
        try {
            const json = JSON.parse(data);
            const publicHost = this.config.PUBLIC_IP || (hostFallback ? String(hostFallback).split(':')[0] : null);

            const rewriteIfPresent = /** @type {(val: any) => any} */ (
                (val) => {
                    if (!val) return val;
                    return this._rewriteURL(val, publicHost);
                }
            );

            if (json.webSocketDebuggerUrl) {
                const original = json.webSocketDebuggerUrl;
                json.webSocketDebuggerUrl = rewriteIfPresent(original);
                this.log('debug', 'URL rewritten', { original, rewritten: json.webSocketDebuggerUrl });
            }

            if (Array.isArray(json)) {
                json.forEach((item) => {
                    if (item.webSocketDebuggerUrl) {
                        item.webSocketDebuggerUrl = rewriteIfPresent(item.webSocketDebuggerUrl);
                    }
                    if (item.devtoolsFrontendUrl) {
                        item.devtoolsFrontendUrl = rewriteIfPresent(item.devtoolsFrontendUrl);
                    }
                });
            }

            return JSON.stringify(json);
        } catch (/** @type {any} */ err) {
            this.log('error', 'JSON parse/rewrite failed', { error: /** @type {any} */ (err).message });
            return data;
        }
    }

    /**
     * @param {any} url
     * @param {any} publicHost
     */
    /**
     * @param {any} url
     * @param {any} publicHost
     */
    _rewriteURL(url, publicHost) {
        const replacementHost = publicHost || this.config.PUBLIC_IP || this.config.CHROME_HOST;

        try {
            // Handle plain host:port strings (no protocol)
            if (!/^https?:\/\//i.test(url) && !/^wss?:\/\//i.test(url)) {
                return String(url).replace(
                    new RegExp(
                        `(${this.config.CHROME_HOST}|localhost|127\\.0\\.0\\.1):${this.config.CHROME_PORT}`,
                        'g',
                    ),
                    `${replacementHost}:${this.config.PROXY_PORT}`,
                );
            }

            const u = new URL(url);
            if (u.hostname === this.config.CHROME_HOST || u.hostname === '127.0.0.1' || u.hostname === 'localhost') {
                u.hostname = replacementHost;
                u.port = String(this.config.PROXY_PORT);
            }
            return u.toString();
        } catch (/** @type {any} */ err) {
            // Fallback: regex replacement
            this.log('debug', 'URL parse failed, using regex fallback', {
                url,
                error: /** @type {any} */ (err).message,
            });
            return String(url).replace(
                new RegExp(`(${this.config.CHROME_HOST}|localhost|127\\.0\\.0\\.1):${this.config.CHROME_PORT}`, 'g'),
                `${replacementHost}:${this.config.PROXY_PORT}`,
            );
        }
    }

    /* ======================================================================
       Idle Connection Cleanup
    ====================================================================== */
    _cleanupIdleConnections() {
        const now = Date.now();
        for (const socket of Array.from(this.activeConnections)) {
            try {
                const last = socket?.__lastActivity || 0;
                if (last && now - last > this._idleTimeoutMs) {
                    this.log('warn', 'Closing idle websocket', { idleMs: now - last });
                    socket.destroy();
                    this.activeConnections.delete(socket);
                    this._setMetric(this.metrics.activeConnections, this.activeConnections.size);
                }
            } catch (/** @type {any} */ err) {
                this.log('debug', 'Cleanup error (non-critical)', { error: /** @type {any} */ (err).message });
            }
        }
    }

    /* ======================================================================
       IP Normalization (P1.6 - IPv6-mapped canonicalization)
    ====================================================================== */
    /**
     * @param {any} ip
     */
    /**
     * @param {any} ip
     */
    _normalizeIP(ip) {
        if (!ip) return '0.0.0.0';
        // Remove IPv6-mapped IPv4 prefix (::ffff:192.168.1.1 → 192.168.1.1)
        return ip.replace(/^::ffff:/i, '');
    }

    /* ======================================================================
       WebSocket Rate Limiting Helpers
    ====================================================================== */
    _cleanupStaleIPEntries() {
        // Remove IPs with 0 connections
        // Use Array.from() for TypeScript iterator compatibility
        for (const [ip, count] of Array.from(this.wsConnectionsPerIP.entries())) {
            if (count <= 0) {
                this.wsConnectionsPerIP.delete(ip);
            }
        }
    }

    /**
     * @param {any} ip
     */
    /**
     * @param {any} ip
     */
    _incrementIPConnection(ip) {
        const current = this.wsConnectionsPerIP.get(ip) || 0;
        this.wsConnectionsPerIP.set(ip, current + 1);
    }

    /**
     * @param {any} ip
     */
    /**
     * @param {any} ip
     */
    _decrementIPConnection(ip) {
        const current = this.wsConnectionsPerIP.get(ip) || 0;
        if (current > 0) {
            this.wsConnectionsPerIP.set(ip, current - 1);
        }
    }

    /* ======================================================================
       Health Check (Enhanced - validates Chrome)
    ====================================================================== */
    async _checkChromeHealth() {
        let timeout = null;
        try {
            const controller = new AbortController();
            timeout = setTimeout(() => controller.abort(), 3000);

            const res = await fetch(`http://${this.config.CHROME_HOST}:${this.config.CHROME_PORT}/json/version`, {
                signal: controller.signal,
            });

            if (!res.ok) {
                return { healthy: false, error: `HTTP ${res.status}` };
            }

            /** @type {{ Browser?: string; 'Protocol-Version'?: string; webSocketDebuggerUrl?: string }} */
            const json = await res.json();
            return {
                healthy: true,
                browser: json.Browser,
                protocolVersion: json['Protocol-Version'],
                webSocketDebuggerUrl: json.webSocketDebuggerUrl,
            };
        } catch (/** @type {any} */ err) {
            return { healthy: false, error: /** @type {any} */ (err).message };
        } finally {
            if (timeout) {
                clearTimeout(timeout);
            }
        }
    }

    /* ======================================================================
       Retry with Exponential Backoff
    ====================================================================== */
    /**
     * @param {any} fn
     * @param {number} [maxRetries]
     * @param {number} [baseDelay]
     */
    /**
     * @param {any} fn
     * @param {number} [maxRetries]
     * @param {number} [baseDelay]
     */
    async _retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                return await fn();
            } catch (/** @type {any} */ err) {
                if (attempt === maxRetries - 1) throw err;

                const delay = baseDelay * Math.pow(2, attempt);
                this.log('warn', `Retry ${attempt + 1}/${maxRetries} after ${delay}ms`, {
                    error: /** @type {any} */ (err).message,
                });

                await new Promise((resolve) => setTimeout(resolve, delay));
            }
        }
    }

    /* ======================================================================
       HTTP Request Handler
    ====================================================================== */

    /**
     * Handle HTTP request proxying to Chrome DevTools Protocol
     *
     * Features:
     *
     * - Circuit breaker protection
     * - Conditional buffering (/json/* paths for URL rewriting)
     * - Response streaming for non-JSON paths
     * - Cache for /json/version (30s TTL)
     * - CORS headers (whitelist-based)
     * - Prometheus metrics
     *
     * @example
     *     // Express integration
     *     app.use((req, res) => proxy.handleHTTPRequest(req, res));
     *
     * @param {IncomingMessage} req - Incoming HTTP request
     * @param {ServerResponse} res - HTTP response
     * @returns {void}
     */
    handleHTTPRequest(req, res) {
        this.stats.httpRequests++;

        const clientIP = req.socket.remoteAddress;
        const method = req.method || 'GET';
        const url = req.url || '/';

        this.log('info', `HTTP ${method} ${url}`, { from: clientIP });

        const start = process.hrtime();

        // Health check endpoints (skip circuit breaker)
        if (url === '/health' || url === '/healthz') {
            void this._handleHealthCheck(req, res);
            return;
        }

        // Check cache for /json/version
        if (url === '/json/version' && this.cache.version && Date.now() < this.cache.versionExpires) {
            this.stats.cacheHits++;
            this._incrementMetric(this.metrics.cacheHits);
            this._incrementMetric(this.metrics.httpRequests, { method, path: url, status: '200' });

            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(this.cache.version),
                'X-Cache': 'HIT',
                ...this._getCORSHeaders(req),
            });
            res.end(this.cache.version);

            const diff = process.hrtime(start);
            const duration = diff[0] + diff[1] / 1e9;
            this._observeMetric(this.metrics.requestDuration, duration, { method, path: url });
            return;
        }

        // Cache miss
        if (url === '/json/version') {
            this.stats.cacheMisses++;
            this._incrementMetric(this.metrics.cacheMisses);
        }

        const needsRewrite = url && url.startsWith('/json');
        /** @type {RequestOptions} */
        const options = {
            hostname: this.config.CHROME_HOST,
            port: this.config.CHROME_PORT,
            path: url,
            method: method,
            headers: req.headers,
        };

        // ✅ Wrap Chrome request with circuit breaker
        const MAX_JSON_BUFFER_SIZE = 10 * 1024 * 1024; // 10MB limit

        const proxyRequest = () => {
            return new Promise((resolve, reject) => {
                const proxyReq = http.request(options, (proxyRes) => {
                    // ✅ Conditional buffering: only buffer /json/* paths
                    if (needsRewrite) {
                        let data = '';
                        let bufferSize = 0;

                        proxyRes.on('data', (chunk) => {
                            bufferSize += chunk.length;

                            // ✅ Size limit enforcement
                            if (bufferSize > MAX_JSON_BUFFER_SIZE) {
                                proxyReq.destroy();
                                proxyRes.destroy();
                                reject(new Error(`Response too large (${bufferSize} bytes > 10MB limit)`));
                                return;
                            }

                            data += chunk;
                        });

                        proxyRes.on('end', () => {
                            resolve({ proxyRes, data });
                        });
                    } else {
                        // ✅ Streaming: no buffering for non-JSON paths
                        resolve({ proxyRes, data: null });
                    }
                });

                proxyReq.on('error', reject);
                req.pipe(proxyReq);
            });
        };

        this.circuitBreaker
            .call(proxyRequest)
            .then(({ proxyRes, data }) => {
                // ✅ Handle buffered response (JSON rewrite)
                if (needsRewrite && data !== null) {
                    const hostFallback = req?.headers?.host || null;
                    const finalData = this.rewriteWebSocketURL(data, hostFallback);

                    // Cache /json/version responses
                    if (url === '/json/version' && proxyRes.statusCode === 200) {
                        this.cache.version = finalData;
                        this.cache.versionExpires = Date.now() + this.cache.versionTTL;
                    }

                    const status = String(proxyRes.statusCode);
                    this._incrementMetric(this.metrics.httpRequests, { method, path: url, status });

                    // Remove transfer-encoding to avoid conflict with Content-Length
                    const headers = { ...proxyRes.headers };
                    delete headers['transfer-encoding'];

                    res.writeHead(proxyRes.statusCode, {
                        ...headers,
                        'Content-Length': Buffer.byteLength(finalData),
                        'X-Cache': 'MISS',
                        ...this._getCORSHeaders(req),
                    });
                    res.end(finalData);

                    this.log('debug', 'HTTP response sent (buffered)', {
                        status: proxyRes.statusCode,
                        length: finalData.length,
                        rewritten: true,
                    });

                    // ✅ Metric: Buffered response
                    this._incrementMetric(this.metrics.httpBuffered, { path: url });
                } else {
                    // ✅ Handle streamed response (no buffering)
                    const status = String(proxyRes.statusCode);
                    this._incrementMetric(this.metrics.httpRequests, { method, path: url, status });

                    res.writeHead(proxyRes.statusCode, {
                        ...proxyRes.headers,
                        ...this._getCORSHeaders(req),
                    });

                    proxyRes.pipe(res);

                    // ✅ P2.7: Handle streaming errors (count failures in circuit breaker)
                    proxyRes.on(
                        'error',
                        /** @type {(error: Error) => void} */ (
                            (streamErr) => {
                                this.circuitBreaker.onFailure(); // Count failure in circuit breaker
                                this.stats.errors++;
                                this._incrementMetric(this.metrics.proxyErrors, { type: 'stream_error' });
                                this.log('error', 'Proxy response stream error', {
                                    error: streamErr.message,
                                });

                                if (!res.headersSent) {
                                    res.writeHead(502, {
                                        'Content-Type': 'text/plain',
                                        ...this._getCORSHeaders(req),
                                    });
                                    res.end('Stream error');
                                }
                            }
                        ),
                    );

                    this.log('debug', 'HTTP response streaming', {
                        status: proxyRes.statusCode,
                        streaming: true,
                    });

                    // ✅ Metric: Streamed response
                    this._incrementMetric(this.metrics.httpStreamed);
                }

                // ✅ Common telemetry for both paths
                const store = this.asyncLocalStorage.getStore();
                const correlationId = store?.correlationId || req.headers?.['x-request-id'] || null;

                if (ActionCode) {
                    const diff = process.hrtime(start);
                    const duration = diff[0] + diff[1] / 1e9;

                    void this._emitNervEvent(
                        ActionCode.KERNEL_TELEMETRY,
                        {
                            event: 'proxy.http.response',
                            method,
                            path: url,
                            status: proxyRes.statusCode,
                            durationSeconds: duration,
                            buffered: needsRewrite,
                            rewritten: needsRewrite,
                        },
                        correlationId,
                    );
                }

                // Record duration
                const diff = process.hrtime(start);
                const duration = diff[0] + diff[1] / 1e9;
                this._observeMetric(this.metrics.requestDuration, duration, { method, path: url });
            })
            .catch((err) => {
                // ✅ P0.1 FIX: Detect circuit breaker rejection (let breaker manage state transition)
                const isCircuitBreakerError =
                    /** @type {any} */ (err).message && /** @type {any} */ (err).message.includes('Circuit breaker');

                if (isCircuitBreakerError) {
                    // Circuit breaker is OPEN - return 503 with Retry-After
                    const cbState = this.circuitBreaker.getState();
                    const retryInMs = cbState.nextAttempt; // ✅ P0.2 FIX: Already "ms remaining", not timestamp

                    this.log('warn', 'Circuit breaker OPEN, rejecting HTTP request', {
                        path: url,
                        retryInMs,
                    });

                    this._incrementMetric(this.metrics.httpRequests, { method, path: url, status: '503' });
                    this._incrementMetric(this.metrics.proxyErrors, { type: 'circuit_breaker_open' });

                    if (!res.headersSent) {
                        res.writeHead(503, {
                            'Content-Type': 'application/json',
                            'Retry-After': Math.ceil(retryInMs / 1000),
                            ...this._getCORSHeaders(req),
                        });

                        res.end(
                            JSON.stringify({
                                error: 'Chrome temporarily unavailable',
                                circuitBreaker: 'OPEN',
                                retryAfter: `${Math.ceil(retryInMs / 1000)}s`,
                                hint: 'Chrome circuit breaker is protecting against cascading failures',
                            }),
                        );
                    }
                } else {
                    // Regular connection error - return 502
                    this.stats.errors++;
                    this._incrementMetric(this.metrics.proxyErrors, { type: 'http_request' });
                    this._incrementMetric(this.metrics.httpRequests, { method, path: url, status: '502' });

                    this.log('error', 'Chrome unreachable', { error: /** @type {any} */ (err).message });

                    if (!res.headersSent) {
                        res.writeHead(502, {
                            'Content-Type': 'application/json',
                            ...this._getCORSHeaders(req),
                        });

                        res.end(
                            JSON.stringify({
                                error: 'Chrome unreachable',
                                message: /** @type {any} */ (err).message,
                                hint: `Ensure Chrome is running with --remote-debugging-port=${this.config.CHROME_PORT}`,
                            }),
                        );
                    }

                    // NERV error event (optional)
                    const store = this.asyncLocalStorage.getStore();
                    const correlationId = store?.correlationId || req.headers?.['x-request-id'] || null;

                    if (ActionCode) {
                        void this._emitNervEvent(
                            ActionCode.DRIVER_ERROR,
                            { event: 'proxy.http.error', error: /** @type {any} */ (err).message, path: url, method },
                            correlationId,
                        );
                    }
                }
            });
    }

    /* ======================================================================
       Health Check Handler
    ====================================================================== */
    /**
     * @param {any} req
     * @param {any} res
     */
    /**
     * @param {any} req
     * @param {any} res
     */
    async _handleHealthCheck(req, res) {
        const uptime = Math.floor((Date.now() - this.stats.startTime) / 1000);
        const chromeHealth = await this._checkChromeHealth();
        const circuitState = this.circuitBreaker.getState();

        const status = chromeHealth.healthy ? 'ok' : 'degraded';
        const statusCode = chromeHealth.healthy ? 200 : 503;

        const body = JSON.stringify({
            status,
            uptime,
            chrome: chromeHealth,
            circuitBreaker: circuitState,
            stats: {
                httpRequests: this.stats.httpRequests,
                wsUpgrades: this.stats.wsUpgrades,
                errors: this.stats.errors,
                activeConnections: this.activeConnections.size,
                cacheHits: this.stats.cacheHits,
                cacheMisses: this.stats.cacheMisses,
            },
        });

        res.writeHead(statusCode, {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            ...this._getCORSHeaders(req),
        });
        res.end(body);
    }

    /* ======================================================================
       CORS Headers (Whitelist)
    ====================================================================== */
    /**
     * @param {any} req
     */
    /**
     * @param {any} req
     */
    _getCORSHeaders(req) {
        const origin = req.headers.origin;

        // No origin header (same-origin request or curl)
        if (!origin) {
            return {}; // ✅ No CORS headers (same-origin always allowed)
        }

        // Check whitelist
        if ((this.config.ALLOWED_ORIGINS || []).includes(origin)) {
            return {
                'Access-Control-Allow-Origin': origin,
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, X-Request-Id, X-Correlation-Id',
                'Access-Control-Allow-Credentials': 'true',
            };
        }

        // ✅ Unmatched origin - no CORS headers (will fail in browser)
        this.log('debug', 'CORS rejected for origin', { origin });
        return {};
    }

    /* ======================================================================
       WebSocket Upgrade Handler
    ====================================================================== */

    /**
     * Handle WebSocket upgrade for Chrome DevTools Protocol connections
     *
     * Security & Rate Limiting:
     *
     * - Origin validation (whitelist-based, CORS doesn't protect WebSocket)
     * - Circuit breaker protection
     * - Global WebSocket connection limit (MAX_WS_GLOBAL)
     * - Per-IP connection limit (MAX_WS_PER_IP)
     * - IPv6-mapped IP normalization
     *
     * Connection Management:
     *
     * - TCP keep-alive (30s initial delay)
     * - Idle timeout detection
     * - Automatic cleanup on close/error
     * - Graceful degradation (fallback to raw socket if http-proxy fails)
     *
     * @example
     *     // HTTP server integration
     *     server.on('upgrade', (req, socket, head) => {
     *         proxy.handleWebSocketUpgrade(req, socket, head);
     *     });
     *
     * @param {IncomingMessage} req - HTTP upgrade request
     * @param {Socket} socket - TCP socket
     * @param {Buffer} head - First packet of upgraded stream
     * @returns {void}
     */
    handleWebSocketUpgrade(req, socket, head) {
        this.stats.wsUpgrades++;

        const rawIP = socket.remoteAddress;
        const clientIP = this._normalizeIP(rawIP); // ✅ P1.6: Normalize IPv6-mapped addresses
        const url = req.url;

        this.log('info', `WebSocket upgrade: ${url}`, { from: clientIP });

        // ✅ P1.3: Origin Validation (CORS doesn't protect WebSocket)
        const origin = req.headers.origin;
        if (origin && !(this.config.ALLOWED_ORIGINS || []).includes(origin)) {
            this.log('warn', 'WebSocket upgrade rejected: Origin not in whitelist', {
                origin,
                url,
            });

            this._incrementMetric(this.metrics.wsUpgrades, { success: 'false' });
            this._incrementMetric(this.metrics.proxyErrors, { type: 'origin_rejected' });

            socket.write('HTTP/1.1 403 Forbidden\r\n');
            socket.write('Content-Type: text/plain\r\n');
            socket.write('\r\n');
            socket.write('Origin not allowed\r\n');
            socket.destroy();

            return;
        }

        // ✅ P1.4 FIX: Circuit Breaker - Allow HALF_OPEN transition based on time
        if (this.circuitBreaker.state === 'OPEN') {
            // Check if it's time to attempt recovery (transition to HALF_OPEN)
            if (Date.now() < this.circuitBreaker.nextAttempt) {
                const cbState = this.circuitBreaker.getState();
                const retryInMs = cbState.nextAttempt; // Already "ms remaining"

                this.log('warn', 'Circuit breaker OPEN, rejecting WS upgrade', {
                    url,
                    retryInMs,
                });

                this._incrementMetric(this.metrics.wsUpgrades, { success: 'false' });
                this._incrementMetric(this.metrics.proxyErrors, { type: 'circuit_breaker_open' });

                socket.write('HTTP/1.1 503 Service Unavailable\r\n');
                socket.write('Content-Type: text/plain\r\n');
                socket.write(`Retry-After: ${Math.ceil(retryInMs / 1000)}\r\n`);
                socket.write('\r\n');
                socket.write('Chrome circuit breaker OPEN\r\n');
                socket.destroy();

                return;
            } else {
                // Time to try recovery - transition to HALF_OPEN
                this.circuitBreaker.state = 'HALF_OPEN';
                this.log('info', 'Circuit breaker transitioning to HALF_OPEN (WS upgrade)', { url });
            }
        }

        // ✅ Global WS Limit Check
        if (this.activeConnections.size >= this.MAX_WS_GLOBAL) {
            this.log('warn', 'Global WS limit reached', {
                active: this.activeConnections.size,
                limit: this.MAX_WS_GLOBAL,
                from: clientIP,
            });

            this._incrementMetric(this.metrics.wsUpgrades, { success: 'false' });
            this._incrementMetric(this.metrics.proxyErrors, { type: 'ws_global_limit' });
            this._incrementMetric(this.metrics.wsGlobalRejections); // ✅ Specific metric

            socket.write('HTTP/1.1 503 Service Unavailable\r\n');
            socket.write('Content-Type: text/plain\r\n');
            socket.write('Retry-After: 10\r\n');
            socket.write('\r\n');
            socket.write('WebSocket connection limit reached\r\n');
            socket.destroy();
            return;
        }

        // ✅ Per-IP WS Limit Check
        const ipConnections = this.wsConnectionsPerIP.get(clientIP) || 0;
        if (ipConnections >= this.MAX_WS_PER_IP) {
            this.log('warn', 'Per-IP WS limit reached', {
                ip: clientIP,
                connections: ipConnections,
                limit: this.MAX_WS_PER_IP,
            });

            this._incrementMetric(this.metrics.wsUpgrades, { success: 'false' });
            this._incrementMetric(this.metrics.proxyErrors, { type: 'ws_per_ip_limit' });
            this._incrementMetric(this.metrics.wsPerIPRejections); // ✅ Specific metric

            socket.write('HTTP/1.1 429 Too Many Requests\r\n');
            socket.write('Content-Type: text/plain\r\n');
            socket.write('Retry-After: 30\r\n');
            socket.write('\r\n');
            socket.write('Too many WebSocket connections from this IP\r\n');
            socket.destroy();
            return;
        }

        // ✅ Increment IP counter (accepted connection)
        this._incrementIPConnection(clientIP);

        this.log('info', `WebSocket upgrade accepted: ${url}`, {
            from: clientIP,
            ipConnections: ipConnections + 1,
            globalConnections: this.activeConnections.size + 1,
        });

        /**
         * Mark socket as active (tracks last activity timestamp)
         *
         * @param {Socket & { __lastActivity?: number }} s - Socket with custom property
         */
        const markActive = (s) => {
            try {
                s.__lastActivity = Date.now();
            } catch (/** @type {any} */ err) {
                this.log('debug', 'Mark active failed (non-critical)', { error: /** @type {any} */ (err).message });
            }
        };

        markActive(socket);
        socket.on('data', () => markActive(socket));

        // ✅ TCP Keep-Alive (corrected from WebSocket API)
        socket.setKeepAlive(true, 30000); // Enable with 30s initial delay

        // ✅ Timeout mechanism (instead of ping/pong)
        const idleTimeout = this._idleTimeoutMs;
        socket.setTimeout(idleTimeout);

        socket.on('timeout', () => {
            const trackedSocket = /** @type {net.Socket & { __lastActivity?: number }} */ (socket);
            const inactiveMs = Date.now() - (trackedSocket.__lastActivity || Date.now());
            this.log('warn', 'WebSocket idle timeout', {
                idleMs: inactiveMs,
                threshold: idleTimeout,
            });

            socket.destroy();
            this.activeConnections.delete(socket);
            this._setMetric(this.metrics.activeConnections, this.activeConnections.size);
        });

        // Cleanup function to prevent resource leaks
        let cleanupDone = false;
        const cleanup = () => {
            if (cleanupDone) return;
            cleanupDone = true;

            socket.setTimeout(0); // Clear timeout
            this.activeConnections.delete(socket);
            this._decrementIPConnection(clientIP); // ✅ Decrement per-IP counter
            this._setMetric(this.metrics.activeConnections, this.activeConnections.size);

            this.log('debug', 'WebSocket cleanup complete', {
                ip: clientIP,
                remainingFromIP: this.wsConnectionsPerIP.get(clientIP) || 0,
            });
        };
        socket.on('close', cleanup);

        // Use http-proxy if available
        if (this.wsProxy) {
            try {
                this.activeConnections.add(socket);

                this.wsProxy.ws(req, socket, head);

                this._incrementMetric(this.metrics.wsUpgrades, { success: 'true' });
                this._setMetric(this.metrics.activeConnections, this.activeConnections.size);

                // NERV telemetry (optional)
                const correlationId = req.headers?.['x-request-id'] || uuidv4();
                if (ActionCode) {
                    void this._emitNervEvent(
                        ActionCode.KERNEL_TELEMETRY,
                        { event: 'proxy.ws.upgrade', url, from: clientIP },
                        correlationId,
                    );
                }

                return;
            } catch (/** @type {any} */ err) {
                this.stats.errors++;
                this._incrementMetric(this.metrics.proxyErrors, { type: 'ws_upgrade' });
                this._incrementMetric(this.metrics.wsUpgrades, { success: 'false' });

                this.log('error', 'WS proxy (http-proxy) failed', { error: /** @type {any} */ (err).message });

                const correlationId = req.headers?.['x-request-id'] || uuidv4();
                if (ActionCode) {
                    void this._emitNervEvent(
                        ActionCode.DRIVER_ERROR,
                        { event: 'proxy.ws.proxy_error', error: /** @type {any} */ (err).message, url },
                        correlationId,
                    );
                }

                // Cleanup before destroying socket (prevents resource leak)
                cleanup();

                try {
                    socket.destroy();
                } catch (/** @type {any} */ destroyErr) {
                    this.log('debug', 'Socket destroy failed', { error: /** @type {any} */ (destroyErr).message });
                }
                return;
            }
        }

        // Fallback: raw socket proxying
        const proxySocket = net.connect(Number(this.config.CHROME_PORT), String(this.config.CHROME_HOST), () => {
            this.log('debug', 'Chrome WebSocket connected');
            proxySocket.write(`${req.method} ${url} HTTP/${req.httpVersion}\r\n`);
            Object.entries(req.headers).forEach(([key, value]) => {
                proxySocket.write(`${key}: ${value}\r\n`);
            });
            proxySocket.write('\r\n');
            if (head && head.length > 0) proxySocket.write(head);
        });

        socket.pipe(proxySocket);
        proxySocket.pipe(socket);

        this.activeConnections.add(socket);
        this._setMetric(this.metrics.activeConnections, this.activeConnections.size);
        this._incrementMetric(this.metrics.wsUpgrades, { success: 'true' });

        const correlationId = req.headers?.['x-request-id'] || uuidv4();
        if (ActionCode) {
            void this._emitNervEvent(
                ActionCode.KERNEL_TELEMETRY,
                { event: 'proxy.ws.connected', url, from: clientIP },
                correlationId,
            );
        }

        socket.on('close', () => {
            this.log('debug', 'WebSocket closed');
            proxySocket.destroy();
            cleanup();
        });

        proxySocket.on('error', (err) => {
            this.stats.errors++;
            this._incrementMetric(this.metrics.proxyErrors, { type: 'proxy_socket' });

            this.log('error', 'Proxy socket error', { error: /** @type {any} */ (err).message });

            if (ActionCode) {
                void this._emitNervEvent(
                    ActionCode.DRIVER_ERROR,
                    { event: 'proxy.ws.proxy_socket_error', error: /** @type {any} */ (err).message, url },
                    correlationId,
                );
            }

            // Cleanup before destroying socket (prevents resource leak)
            cleanup();
            socket.destroy();
        });

        socket.on('error', (err) => {
            this.stats.errors++;
            this._incrementMetric(this.metrics.proxyErrors, { type: 'client_socket' });

            this.log('error', 'Client socket error', { error: /** @type {any} */ (err).message });

            if (ActionCode) {
                void this._emitNervEvent(
                    ActionCode.DRIVER_ERROR,
                    { event: 'proxy.ws.client_socket_error', error: /** @type {any} */ (err).message, url },
                    correlationId,
                );
            }

            // Cleanup before destroying proxySocket (prevents resource leak)
            cleanup();
            proxySocket.destroy();
        });
    }

    /* ======================================================================
       Start Server
    ====================================================================== */

    /**
     * Start the proxy server
     *
     * Responsibilities:
     *
     * - Initialize http-proxy module
     * - Load NERV integration (optional)
     * - Setup Express middleware (helmet, compression, rate limiting)
     * - Configure health and metrics endpoints
     * - Create HTTP server with WebSocket upgrade support
     * - Register graceful shutdown handlers (SIGINT/SIGTERM)
     * - Send PM2 ready signal when listening
     *
     * @example
     *     const proxy = new ChromeProxyService(config);
     *     await proxy.start();
     *     console.log('Proxy listening on port', config.PROXY_PORT);
     *
     * @returns {Promise<void>} Resolves when server is listening
     * @throws {Error} If port is already in use or binding fails
     */
    async start() {
        // ✅ Wait for http-proxy to be ready (initialized in constructor)
        try {
            await this._proxyReady;
            this.log('info', 'http-proxy module ready');
        } catch (/** @type {any} */ err) {
            this.log('warn', 'http-proxy initialization failed, using fallback', {
                error: /** @type {any} */ (err).message,
            });
            this.wsProxy = null;
        }

        // NERV integration (optional)
        const nervEnabled = (process.env['NERV_INTEGRATION'] || 'true').toString().toLowerCase() !== 'false';
        if (nervEnabled) {
            try {
                const nervModule = /** @type {any} */ (await import('#nerv/nerv'));
                createNERV = nervModule?.createNERV || null;
                HighLevelNERV = /** @type {any} */ (await import('#nerv/adapters/high_level_adapter'));
                const nervConsts = /** @type {any} */ (await import('#shared/nerv/constants'));
                ActionCode = nervConsts?.ActionCode || null;
                ActorRole = nervConsts?.ActorRole || {};

                if (typeof createNERV === 'function') {
                    this.nerv = await createNERV();
                    this.log('info', 'NERV initialized for proxy service');
                } else {
                    this.log('info', 'NERV createNERV not available, skipping NERV integration');
                    this.nerv = null;
                }
            } catch (/** @type {any} */ err) {
                this.log('warn', 'NERV initialization failed or not available, continuing without NERV', {
                    error: /** @type {any} */ (err).message,
                });
                this.nerv = null;
                createNERV = null;
                HighLevelNERV = null;
                ActionCode = null;
                ActorRole = null;
            }
        }

        return new Promise((resolve, reject) => {
            this.app = express();

            // Security middleware
            try {
                this.app.use(helmet());
            } catch (/** @type {any} */ err) {
                this.log('warn', 'Helmet middleware failed', { error: /** @type {any} */ (err).message });
            }

            // Compression middleware
            try {
                this.app.use(
                    compression({
                        filter: (req, res) => {
                            if (req.headers['x-no-compression']) return false;
                            return compression.filter(req, res);
                        },
                        threshold: 512,
                    }),
                );
            } catch (/** @type {any} */ err) {
                this.log('warn', 'Compression middleware failed', { error: /** @type {any} */ (err).message });
            }

            // Rate limiting (1000 req/min)
            try {
                const limiter = rateLimit({
                    windowMs: 60 * 1000,
                    max: 1000,
                    message: 'Too many requests, please try again later',
                    standardHeaders: true,
                    legacyHeaders: false,
                    skip: (req) => req.url === '/health' || req.url === '/healthz',
                });
                this.app.use(limiter);
            } catch (/** @type {any} */ err) {
                this.log('warn', 'Rate limiting middleware failed', { error: /** @type {any} */ (err).message });
            }

            // Correlation ID middleware
            this.app.use((req, res, next) => {
                const correlationId = req.headers['x-correlation-id'] || req.headers['x-request-id'] || uuidv4();

                /** @type {any} */ (req).correlationId = correlationId;
                res.setHeader('X-Correlation-ID', correlationId);
                res.setHeader('X-Request-Id', correlationId);

                this.asyncLocalStorage.run({ correlationId }, () => next());
            });

            // Metrics endpoint
            this.app.get('/metrics', async (_req, res) => {
                try {
                    // Update circuit breaker state metric
                    const cbState = this.circuitBreaker.state;
                    const stateValue = cbState === 'CLOSED' ? 0 : cbState === 'HALF_OPEN' ? 1 : 2;
                    this._setMetric(this.metrics.circuitBreakerState, stateValue);

                    res.setHeader('Content-Type', promClient.register.contentType || 'text/plain; version=0.0.4');
                    res.end(await promClient.register.metrics());
                } catch (/** @type {any} */ err) {
                    this.log('error', 'Metrics endpoint error', { error: /** @type {any} */ (err).message });
                    res.statusCode = 500;
                    res.end('Metrics error');
                }
            });

            // Health check endpoint (for PM2 readiness checks and external monitoring)
            this.app.get(['/health', '/healthz'], async (req, res) => {
                try {
                    await this._handleHealthCheck(req, res);
                } catch (/** @type {any} */ err) {
                    this.log('error', 'Health check endpoint error', { error: /** @type {any} */ (err).message });
                    res.statusCode = 500;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(
                        JSON.stringify({
                            status: 'error',
                            error: /** @type {any} */ (err).message,
                            timestamp: Date.now(),
                        }),
                    );
                }
            });

            // Default route (proxy all other requests)
            this.app.use((req, res) => this.handleHTTPRequest(req, res));

            // Create HTTP server
            this.server = http.createServer(this.app);

            // ✅ Configure HTTP timeouts (Node.js best practices)
            this.server.headersTimeout = 65000; // Headers timeout (65s > HAProxy 60s)
            this.server.requestTimeout = 120000; // Request timeout (2 minutes)
            this.server.keepAliveTimeout = 65000; // Keep-alive timeout
            this.server.timeout = 0; // Socket timeout (0 = disabled, use requestTimeout)

            this.server.on('upgrade', this.handleWebSocketUpgrade.bind(this));

            // Start listening
            this.server.listen(Number(this.config.PROXY_PORT), String(this.config.PROXY_BIND), () => {
                this.log('info', '✅ Chrome Proxy Service v3.1 started');
                this.log('info', `   Listening: ${this.config.PROXY_BIND}:${this.config.PROXY_PORT}`);
                this.log('info', `   Forwarding to: ${this.config.CHROME_HOST}:${this.config.CHROME_PORT}`);
                this.log('info', `   Public URL: http://${this.config.PUBLIC_IP}:${this.config.PROXY_PORT}`);
                this.log('info', `   Idle timeout: ${this._idleTimeoutMs}ms`);
                this.log('info', `   CORS origins: ${(this.config.ALLOWED_ORIGINS || []).length} allowed`);

                // Signal to PM2 that process is ready (prevents race condition)
                if (process.send) {
                    process.send('ready');
                    this.log('debug', '   PM2 readiness signal sent');
                }

                resolve();
            });

            this.server.on('error', (err) => {
                const errnoErr = /** @type {NodeJS.ErrnoException} */ (err);
                if (errnoErr.code === 'EADDRINUSE') {
                    reject(
                        new Error(
                            `Port ${this.config.PROXY_PORT} is already in use. ` +
                                `Stop the process or use a different port.`,
                        ),
                    );
                } else {
                    reject(err);
                }
            });

            // Graceful shutdown handlers (only in standalone ownership mode)
            this._registerSignalHandlers();
        });
    }

    _registerSignalHandlers() {
        if (this._signalHandlersInstalled || this.config.AUTO_HANDLE_SIGNALS === false) {
            return;
        }

        /** @type {any} */ (this._signalHandlers).sigint = () => {
            void this._handleShutdown('SIGINT');
        };
        /** @type {any} */ (this._signalHandlers).sigterm = () => {
            void this._handleShutdown('SIGTERM');
        };

        process.on('SIGINT', /** @type {any} */ (this._signalHandlers.sigint));
        process.on('SIGTERM', /** @type {any} */ (this._signalHandlers.sigterm));
        this._signalHandlersInstalled = true;
    }

    _unregisterSignalHandlers() {
        if (!this._signalHandlersInstalled) {
            return;
        }

        if (this._signalHandlers.sigint) {
            process.removeListener('SIGINT', this._signalHandlers.sigint);
            this._signalHandlers.sigint = null;
        }

        if (this._signalHandlers.sigterm) {
            process.removeListener('SIGTERM', this._signalHandlers.sigterm);
            this._signalHandlers.sigterm = null;
        }

        this._signalHandlersInstalled = false;
    }

    /* ======================================================================
       Graceful Shutdown
    ====================================================================== */

    /**
     * Handle OS signals for graceful shutdown
     *
     * @private
     * @param {string} signal - Signal name (SIGINT, SIGTERM, etc.)
     * @returns {Promise<void>}
     */
    async _handleShutdown(signal) {
        this.log('warn', `Received ${signal}, shutting down gracefully...`);
        try {
            await this.stop();
            process.exit(0);
        } catch (/** @type {any} */ err) {
            this.log('error', 'Shutdown handler failed', {
                signal,
                error: err && /** @type {any} */ (err).message ? /** @type {any} */ (err).message : String(err),
            });
            process.exit(1);
        }
    }

    /**
     * Gracefully stop the proxy server
     *
     * Shutdown procedure:
     *
     * 1. Log final statistics (uptime, requests, errors, connections)
     * 2. Clear idle check and IP cleanup intervals
     * 3. Close all active WebSocket connections (10s timeout per connection)
     * 4. Close HTTP server (5s force timeout)
     *
     * @example
     *     await proxy.stop();
     *     console.log('Proxy stopped gracefully');
     *
     * @returns {Promise<void>} Resolves when server is fully stopped
     */
    async stop() {
        if (this._stopPromise) {
            return this._stopPromise;
        }

        this._stopPromise = (async () => {
            this.log('info', 'Shutting down proxy...');
            this._unregisterSignalHandlers();

            const uptime = Math.floor((Date.now() - this.stats.startTime) / 1000);
            this.log('info', 'Final statistics:', {
                uptime: `${uptime}s`,
                httpRequests: this.stats.httpRequests,
                wsUpgrades: this.stats.wsUpgrades,
                errors: this.stats.errors,
                activeConnections: this.activeConnections.size,
                cacheHits: this.stats.cacheHits,
                cacheMisses: this.stats.cacheMisses,
            });

            // Clear idle check interval
            if (this._idleCheckInterval) {
                clearInterval(this._idleCheckInterval);
            }

            // ✅ P1.5: Clear IP cleanup interval
            if (this._ipCleanupInterval) {
                clearInterval(this._ipCleanupInterval);
            }

            // Gracefully close active connections (10s timeout)
            const closePromises = Array.from(this.activeConnections).map((socket) => {
                return /** @type {Promise<void>} */ (
                    new Promise((resolve) => {
                        const forceSocketTimeout = setTimeout(() => {
                            if (!socket.destroyed) {
                                socket.destroy();
                            }
                            resolve();
                        }, 10000);

                        socket.once('close', () => {
                            clearTimeout(forceSocketTimeout);
                            resolve();
                        });
                        socket.end(); // Graceful close
                    })
                );
            });

            await Promise.all(closePromises);
            this.activeConnections.clear();

            // Close server
            await /** @type {Promise<void>} */ (
                new Promise((resolve) => {
                    if (this.server) {
                        const forceServerTimeout = setTimeout(() => {
                            this.log('warn', 'Forcing server shutdown after timeout');
                            resolve();
                        }, 5000);

                        this.server.close(() => {
                            clearTimeout(forceServerTimeout);
                            this.log('info', '✅ Proxy stopped');
                            resolve();
                        });
                    } else {
                        resolve();
                    }
                })
            );

            this.server = null;
        })();

        return this._stopPromise.finally(() => {
            this._stopPromise = null;
        });
    }
}

export default ChromeProxyService;
