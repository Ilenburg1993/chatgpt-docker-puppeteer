// @ts-check - Type checking rigoroso habilitado (arquivo core)
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import * as logger from '#core/logger';
import { AsyncLocalStorage } from 'node:async_hooks';
import { v4 as uuidv4 } from 'uuid';
import promClient from 'prom-client';

// NERV integration (optional) - lazy loaded
let createNERV = null;
let HighLevelNERV = null;
let ActionCode = null;
let ActorRole = null;

import CONFIG from '#core/config';

// Configurações locais do proxy (sobrescrevem CONFIG se fornecidas via env)
const LOCAL_CONFIG = {
    PROXY_PORT: parseInt(String(process.env.CHROME_PROXY_PORT || CONFIG.CHROME_PROXY_PORT || '9224'), 10),
    CHROME_HOST: String(process.env.CHROME_HOST || CONFIG.CHROME_HOST || 'host.docker.internal'),
    CHROME_PORT: parseInt(String(process.env.CHROME_PORT || CONFIG.CHROME_PORT || '9225'), 10),
    PROXY_BIND: String(process.env.CHROME_PROXY_BIND || CONFIG.CHROME_PROXY_BIND || '0.0.0.0'),
    PUBLIC_IP: process.env.PUBLIC_IP || null,
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS
        ? process.env.ALLOWED_ORIGINS.split(',')
        : ['http://localhost:3008', 'http://127.0.0.1:3008', 'http://localhost:8080', 'http://127.0.0.1:8080']
};

/* ==========================================================================
   CircuitBreaker - Prevents cascading failures when Chrome is down
========================================================================== */
class CircuitBreaker {
    constructor(threshold = 5, timeout = 30000, name = 'default') {
        this.failures = 0;
        this.threshold = threshold;
        this.timeout = timeout;
        this.state = 'CLOSED';  // CLOSED, OPEN, HALF_OPEN
        this.nextAttempt = 0;
        this.name = name;
        this.successCount = 0;
    }

    async call(fn) {
        if (this.state === 'OPEN') {
            if (Date.now() < this.nextAttempt) {
                const waitMs = this.nextAttempt - Date.now();
                throw new Error(`Circuit breaker [${this.name}] OPEN (retry in ${Math.ceil(waitMs/1000)}s)`);
            }
            this.state = 'HALF_OPEN';
        }

        try {
            const result = await fn();
            this.onSuccess();
            return result;
        } catch (err) {
            this.onFailure();
            throw err;
        }
    }

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

    onFailure() {
        this.failures++;
        this.successCount = 0;
        if (this.failures >= this.threshold) {
            this.state = 'OPEN';
            this.nextAttempt = Date.now() + this.timeout;
        }
    }

    getState() {
        return {
            state: this.state,
            failures: this.failures,
            nextAttempt: this.nextAttempt > Date.now() ? this.nextAttempt - Date.now() : 0
        };
    }
}

/* ==========================================================================
   ChromeProxyService - Main Class
========================================================================== */
class ChromeProxyService {
    constructor(config = {}) {
        this.config = { ...LOCAL_CONFIG, ...config };

        // Validate config
        this._validateConfig();

        this.server = null;
        this.app = null;
        this.activeConnections = new Set();
        this.stats = {
            httpRequests: 0,
            wsUpgrades: 0,
            errors: 0,
            startTime: Date.now(),
            cacheHits: 0,
            cacheMisses: 0
        };

        this.logger = logger;
        this.asyncLocalStorage = new AsyncLocalStorage();

        // Prometheus metrics with labels
        try {
            // Default metrics are collected on scrape; no interval/timeout config needed.
            promClient.collectDefaultMetrics();
        } catch (err) {
            this.log('warn', 'Failed to collect default metrics', { error: err.message });
        }

        this.metrics = {
            httpRequests: new promClient.Counter({
                name: 'chrome_proxy_http_requests_total',
                help: 'Total HTTP requests',
                labelNames: ['method', 'path', 'status']
            }),
            wsUpgrades: new promClient.Counter({
                name: 'chrome_proxy_ws_upgrades_total',
                help: 'Total WebSocket upgrades',
                labelNames: ['success']
            }),
            proxyErrors: new promClient.Counter({
                name: 'chrome_proxy_errors_total',
                help: 'Total proxy errors',
                labelNames: ['type']
            }),
            activeConnections: new promClient.Gauge({
                name: 'chrome_proxy_active_connections',
                help: 'Active WebSocket connections'
            }),
            requestDuration: new promClient.Histogram({
                name: 'chrome_proxy_request_duration_seconds',
                help: 'Request duration in seconds',
                labelNames: ['method', 'path'],
                buckets: [0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5]
            }),
            cacheHits: new promClient.Counter({
                name: 'chrome_proxy_cache_hits_total',
                help: 'Cache hits'
            }),
            cacheMisses: new promClient.Counter({
                name: 'chrome_proxy_cache_misses_total',
                help: 'Cache misses'
            }),
            circuitBreakerState: new promClient.Gauge({
                name: 'chrome_proxy_circuit_breaker_state',
                help: 'Circuit breaker state (0=CLOSED, 1=HALF_OPEN, 2=OPEN)'
            })
        };

        // Circuit breaker for Chrome connection
        this.circuitBreaker = new CircuitBreaker(5, 30000, 'chrome-connection');

        // Cache for /json/version
        this.cache = {
            version: null,
            versionTTL: 30000, // 30s cache
            versionExpires: 0
        };

        // Detect PUBLIC_IP
        if (!this.config.PUBLIC_IP) {
            this.config.PUBLIC_IP = this._detectPublicIP();
        }

        // Initialize http-proxy (async — stores promise)
        this._proxyReady = this._initProxy();

        // Idle connection cleanup (5 minutes for LLM sessions)
        this._idleTimeoutMs = parseInt(process.env.WS_IDLE_TIMEOUT_MS || '300000', 10);
        this._idleCheckInterval = setInterval(
            () => this._cleanupIdleConnections(),
            Math.max(10000, this._idleTimeoutMs / 2)
        );
    }

    /**
     * Async initializer for http-proxy.
     * Called from the constructor; result stored in this._proxyReady.
     * @private
     */
    async _initProxy() {
        try {
            const httpProxy = await import('http-proxy').then(m => m.default ?? m);
            this.wsProxy = httpProxy.createProxyServer({
                target: `http://${this.config.CHROME_HOST}:${this.config.CHROME_PORT}`,
                ws: true,
                changeOrigin: true
            });
            this.wsProxy.on('error', (err, req, res) => {
                this.stats.errors++;
                this._incrementMetric(this.metrics.proxyErrors, { type: 'http_proxy' });
                this.log('error', 'Proxy error', { error: err.message });
                if (res && !res.finished) {
                    try {
                        res.writeHead(502, { 'Content-Type': 'text/plain' });
                        res.end('Proxy error');
                    } catch (writeErr) {
                        this.log('debug', 'Failed to send error response', { error: writeErr.message });
                    }
                }
            });
        } catch (err) {
            this.wsProxy = null;
            this.log('warn', 'http-proxy unavailable, falling back to raw socket method');
        }
    }

        /* ======================================================================
       Configuration Validation
    ====================================================================== */
    _validateConfig() {
        const required = ['PROXY_PORT', 'CHROME_HOST', 'CHROME_PORT'];
        const missing = required.filter(key => !this.config[key]);

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
        if (!Array.isArray(this.config.ALLOWED_ORIGINS) || this.config.ALLOWED_ORIGINS.length === 0) {
            throw new Error('ALLOWED_ORIGINS must be a non-empty array');
        }
    }

    /* ======================================================================
       Public IP Detection (Docker-aware)
    ====================================================================== */
    _detectPublicIP() {
        // 1. Env var (most reliable)
        if (process.env.PUBLIC_IP) {
            this.log('debug', 'Using PUBLIC_IP from env', { ip: process.env.PUBLIC_IP });
            return process.env.PUBLIC_IP;
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
        if (interfaces.eth0) {
            const ipv4 = interfaces.eth0.find(
                iface => iface.family === 'IPv4' && !iface.internal && iface.address.startsWith('172.')
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
                const ipv4 = interfaces[name].find(iface => iface.family === 'IPv4' && !iface.internal);
                if (ipv4) return ipv4.address;
            }
        }

        // Fallback: any non-internal IPv4
        for (const name in interfaces) {
            const ipv4 = interfaces[name].find(iface => iface.family === 'IPv4' && !iface.internal);
            if (ipv4) return ipv4.address;
        }

        return '172.17.0.2'; // Docker default fallback
    }

    /* ======================================================================
       Logging with Correlation IDs
    ====================================================================== */
    log(level, message, meta = {}) {
        const store = this.asyncLocalStorage.getStore();
        const correlationId = store?.correlationId || meta.correlationId || 'unknown';

        const enrichedMeta = { ...meta, correlationId };
        const metaStr = ` [${correlationId.substring(0, 8)}]`;
        const metaJson = Object.keys(enrichedMeta).length > 1 ? ` ${JSON.stringify(enrichedMeta)}` : '';
        const formattedMessage = `[CHROME_PROXY]${metaStr} ${message}${metaJson}`;

        if (this.logger && typeof this.logger.log === 'function') {
            this.logger.log(level.toUpperCase(), formattedMessage);
        } else {
            const timestamp = new Date().toISOString();
            console.log(`[${timestamp}] [${level.toUpperCase().padEnd(5)}] ${formattedMessage}`);
        }
    }

    /* ======================================================================
       Metrics Helper (replaces void err pattern)
    ====================================================================== */
    _incrementMetric(metric, labels = {}) {
        try {
            metric.inc(labels);
        } catch (err) {
            // Non-critical: log once, don't spam
            this.log('debug', 'Metric increment failed (non-critical)', {
                metric: metric?.name || 'unknown',
                error: err.message
            });
        }
    }

    _observeMetric(metric, value, labels = {}) {
        try {
            metric.observe(labels, value);
        } catch (err) {
            this.log('debug', 'Metric observe failed (non-critical)', {
                metric: metric?.name || 'unknown',
                error: err.message
            });
        }
    }

    _setMetric(metric, value) {
        try {
            metric.set(value);
        } catch (err) {
            this.log('debug', 'Metric set failed (non-critical)', {
                metric: metric?.name || 'unknown',
                error: err.message
            });
        }
    }

    /* ======================================================================
       NERV Integration (Optional)
    ====================================================================== */
    setNERV(nerv) {
        this._nerv = nerv;
        this.log('info', 'NERV integration enabled');
    }

    _emitNervEvent(actionCode, payload = {}, correlationId = null) {
        try {
            if (!this.nerv || !HighLevelNERV || typeof HighLevelNERV.sendEvent !== 'function') {
                return null;
            }
            const actor = ActorRole.INFRA || 'INFRA';
            return HighLevelNERV.sendEvent(this.nerv, actor, actionCode, payload, correlationId, null);
        } catch (err) {
            this.log('debug', 'NERV publish failed (non-critical)', { error: err.message });
            return null;
        }
    }

    /* ======================================================================
       URL Rewriting (Chrome → Proxy)
    ====================================================================== */
    rewriteWebSocketURL(data, hostFallback) {
        try {
            const json = JSON.parse(data);
            const publicHost = this.config.PUBLIC_IP || (hostFallback ? String(hostFallback).split(':')[0] : null);

            const rewriteIfPresent = val => {
                if (!val) return val;
                return this._rewriteURL(val, publicHost);
            };

            if (json.webSocketDebuggerUrl) {
                const original = json.webSocketDebuggerUrl;
                json.webSocketDebuggerUrl = rewriteIfPresent(original);
                this.log('debug', 'URL rewritten', { original, rewritten: json.webSocketDebuggerUrl });
            }

            if (Array.isArray(json)) {
                json.forEach(item => {
                    if (item.webSocketDebuggerUrl) {
                        item.webSocketDebuggerUrl = rewriteIfPresent(item.webSocketDebuggerUrl);
                    }
                    if (item.devtoolsFrontendUrl) {
                        item.devtoolsFrontendUrl = rewriteIfPresent(item.devtoolsFrontendUrl);
                    }
                });
            }

            return JSON.stringify(json);
        } catch (err) {
            this.log('error', 'JSON parse/rewrite failed', { error: err.message });
            return data;
        }
    }

    _rewriteURL(url, publicHost) {
        const replacementHost = publicHost || this.config.PUBLIC_IP || this.config.CHROME_HOST;

        try {
            // Handle plain host:port strings (no protocol)
            if (!/^https?:\/\//i.test(url) && !/^wss?:\/\//i.test(url)) {
                return String(url).replace(
                    new RegExp(
                        `(${this.config.CHROME_HOST}|localhost|127\\.0\\.0\\.1):${this.config.CHROME_PORT}`,
                        'g'
                    ),
                    `${replacementHost}:${this.config.PROXY_PORT}`
                );
            }

            const u = new URL(url);
            if (u.hostname === this.config.CHROME_HOST || u.hostname === '127.0.0.1' || u.hostname === 'localhost') {
                u.hostname = replacementHost;
                u.port = String(this.config.PROXY_PORT);
            }
            return u.toString();
        } catch (err) {
            // Fallback: regex replacement
            this.log('debug', 'URL parse failed, using regex fallback', { url, error: err.message });
            return String(url).replace(
                new RegExp(`(${this.config.CHROME_HOST}|localhost|127\\.0\\.0\\.1):${this.config.CHROME_PORT}`, 'g'),
                `${replacementHost}:${this.config.PROXY_PORT}`
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
            } catch (err) {
                this.log('debug', 'Cleanup error (non-critical)', { error: err.message });
            }
        }
    }

    /* ======================================================================
       Health Check (Enhanced - validates Chrome)
    ====================================================================== */
    async _checkChromeHealth() {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 3000);

            const res = await fetch(`http://${this.config.CHROME_HOST}:${this.config.CHROME_PORT}/json/version`, {
                signal: controller.signal
            });

            clearTimeout(timeout);

            if (!res.ok) {
                return { healthy: false, error: `HTTP ${res.status}` };
            }

            /** @type {{ Browser?: string, 'Protocol-Version'?: string, webSocketDebuggerUrl?: string }} */
            const json = await res.json();
            return {
                healthy: true,
                browser: json.Browser,
                protocolVersion: json['Protocol-Version'],
                webSocketDebuggerUrl: json.webSocketDebuggerUrl
            };
        } catch (err) {
            return { healthy: false, error: err.message };
        }
    }

    /* ======================================================================
       Retry with Exponential Backoff
    ====================================================================== */
    async _retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                return await fn();
            } catch (err) {
                if (attempt === maxRetries - 1) throw err;

                const delay = baseDelay * Math.pow(2, attempt);
                this.log('warn', `Retry ${attempt + 1}/${maxRetries} after ${delay}ms`, {
                    error: err.message
                });

                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    /* ======================================================================
       HTTP Request Handler
    ====================================================================== */
    handleHTTPRequest(req, res) {
        this.stats.httpRequests++;

        const clientIP = req.socket.remoteAddress;
        const method = req.method || 'GET';
        const url = req.url || '/';

        this.log('info', `HTTP ${method} ${url}`, { from: clientIP });

        const start = process.hrtime();

        // Health check endpoints
        if (url === '/health' || url === '/healthz') {
            this._handleHealthCheck(req, res);
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
                ...this._getCORSHeaders(req)
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
        /** @type {import('node:http').RequestOptions} */
        const options = {
            hostname: this.config.CHROME_HOST,
            port: this.config.CHROME_PORT,
            path: url,
            method: method,
            headers: req.headers
        };

        const proxyReq = http.request(options, proxyRes => {
            let data = '';
            proxyRes.on('data', chunk => {
                data += chunk;
            });

            proxyRes.on('end', () => {
                const hostFallback = req?.headers?.host || null;
                const finalData = needsRewrite ? this.rewriteWebSocketURL(data, hostFallback) : data;

                // Cache /json/version responses
                if (url === '/json/version' && proxyRes.statusCode === 200) {
                    this.cache.version = finalData;
                    this.cache.versionExpires = Date.now() + this.cache.versionTTL;
                }

                const status = String(proxyRes.statusCode);
                this._incrementMetric(this.metrics.httpRequests, { method, path: url, status });

                res.writeHead(proxyRes.statusCode, {
                    ...proxyRes.headers,
                    'Content-Length': Buffer.byteLength(finalData),
                    'X-Cache': 'MISS',
                    ...this._getCORSHeaders(req)
                });
                res.end(finalData);

                this.log('debug', 'HTTP response sent', {
                    status: proxyRes.statusCode,
                    length: finalData.length,
                    rewritten: needsRewrite
                });

                // NERV telemetry (optional)
                const store = this.asyncLocalStorage.getStore();
                const correlationId = store?.correlationId || req.headers?.['x-request-id'] || null;

                if (ActionCode) {
                    const diff = process.hrtime(start);
                    const duration = diff[0] + diff[1] / 1e9;

                    this._emitNervEvent(
                        ActionCode.KERNEL_TELEMETRY,
                        {
                            event: 'proxy.http.response',
                            method,
                            path: url,
                            status: proxyRes.statusCode,
                            durationSeconds: duration,
                            length: finalData.length,
                            rewritten: needsRewrite
                        },
                        correlationId
                    );
                }
            });
        });

        proxyReq.on('error', err => {
            this.stats.errors++;
            this._incrementMetric(this.metrics.proxyErrors, { type: 'http_request' });
            this._incrementMetric(this.metrics.httpRequests, { method, path: url, status: '502' });

            this.log('error', 'Chrome unreachable', { error: err.message });

            res.writeHead(502, {
                'Content-Type': 'text/plain',
                ...this._getCORSHeaders(req)
            });
            res.end(
                `Chrome unreachable: ${err.message}\n\n` +
                    `Please ensure Chrome is running with --remote-debugging-port=${this.config.CHROME_PORT}`
            );

            // NERV error event (optional)
            const store = this.asyncLocalStorage.getStore();
            const correlationId = store?.correlationId || req.headers?.['x-request-id'] || null;

            if (ActionCode) {
                this._emitNervEvent(
                    ActionCode.DRIVER_ERROR,
                    { event: 'proxy.http.error', error: err.message, path: url, method },
                    correlationId
                );
            }
        });

        req.pipe(proxyReq);

        res.on('finish', () => {
            const diff = process.hrtime(start);
            const duration = diff[0] + diff[1] / 1e9;
            this._observeMetric(this.metrics.requestDuration, duration, { method, path: url });
        });
    }

    /* ======================================================================
       Health Check Handler
    ====================================================================== */
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
                cacheMisses: this.stats.cacheMisses
            }
        });

        res.writeHead(statusCode, {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            ...this._getCORSHeaders(req)
        });
        res.end(body);
    }

    /* ======================================================================
       CORS Headers (Whitelist)
    ====================================================================== */
    _getCORSHeaders(req) {
        const origin = req.headers.origin;
        const allowedOrigin = this.config.ALLOWED_ORIGINS.includes(origin) ? origin : this.config.ALLOWED_ORIGINS[0];

        return {
            'Access-Control-Allow-Origin': allowedOrigin,
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, X-Request-Id, X-Correlation-Id',
            'Access-Control-Allow-Credentials': 'true'
        };
    }

    /* ======================================================================
       WebSocket Upgrade Handler
    ====================================================================== */
    handleWebSocketUpgrade(req, socket, head) {
        this.stats.wsUpgrades++;

        const clientIP = socket.remoteAddress;
        const url = req.url;

        this.log('info', `WebSocket upgrade: ${url}`, { from: clientIP });

        const markActive = s => {
            try {
                s.__lastActivity = Date.now();
            } catch (err) {
                this.log('debug', 'Mark active failed (non-critical)', { error: err.message });
            }
        };

        markActive(socket);
        socket.on('data', () => markActive(socket));

        // Ping/pong keep-alive
        const pingInterval = setInterval(() => {
            if (socket.readyState === 1) {
                // OPEN
                try {
                    socket.ping();
                    markActive(socket);
                } catch (err) {
                    this.log('debug', 'Ping failed', { error: err.message });
                }
            }
        }, 30000); // 30s ping interval

        // Cleanup function to prevent resource leaks
        let cleanupDone = false;
        const cleanup = () => {
            if (cleanupDone) return;
            cleanupDone = true;

            // Clear ping interval
            clearInterval(pingInterval);

            // Remove from active connections
            this.activeConnections.delete(socket);
            this._setMetric(this.metrics.activeConnections, this.activeConnections.size);

            this.log('debug', 'WebSocket cleanup complete');
        };

        socket.on('pong', () => markActive(socket));
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
                    this._emitNervEvent(
                        ActionCode.KERNEL_TELEMETRY,
                        { event: 'proxy.ws.upgrade', url, from: clientIP },
                        correlationId
                    );
                }

                return;
            } catch (err) {
                this.stats.errors++;
                this._incrementMetric(this.metrics.proxyErrors, { type: 'ws_upgrade' });
                this._incrementMetric(this.metrics.wsUpgrades, { success: 'false' });

                this.log('error', 'WS proxy (http-proxy) failed', { error: err.message });

                const correlationId = req.headers?.['x-request-id'] || uuidv4();
                if (ActionCode) {
                    this._emitNervEvent(
                        ActionCode.DRIVER_ERROR,
                        { event: 'proxy.ws.proxy_error', error: err.message, url },
                        correlationId
                    );
                }

                // Cleanup before destroying socket (prevents resource leak)
                cleanup();

                try {
                    socket.destroy();
                } catch (destroyErr) {
                    this.log('debug', 'Socket destroy failed', { error: destroyErr.message });
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
            this._emitNervEvent(
                ActionCode.KERNEL_TELEMETRY,
                { event: 'proxy.ws.connected', url, from: clientIP },
                correlationId
            );
        }

        socket.on('close', () => {
            this.log('debug', 'WebSocket closed');
            proxySocket.destroy();
            cleanup();
        });

        proxySocket.on('error', err => {
            this.stats.errors++;
            this._incrementMetric(this.metrics.proxyErrors, { type: 'proxy_socket' });

            this.log('error', 'Proxy socket error', { error: err.message });

            if (ActionCode) {
                this._emitNervEvent(
                    ActionCode.DRIVER_ERROR,
                    { event: 'proxy.ws.proxy_socket_error', error: err.message, url },
                    correlationId
                );
            }

            // Cleanup before destroying socket (prevents resource leak)
            cleanup();
            socket.destroy();
        });

        socket.on('error', err => {
            this.stats.errors++;
            this._incrementMetric(this.metrics.proxyErrors, { type: 'client_socket' });

            this.log('error', 'Client socket error', { error: err.message });

            if (ActionCode) {
                this._emitNervEvent(
                    ActionCode.DRIVER_ERROR,
                    { event: 'proxy.ws.client_socket_error', error: err.message, url },
                    correlationId
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
    async start() {
        // NERV integration (optional)
        const nervEnabled = (process.env.NERV_INTEGRATION || 'true').toString().toLowerCase() !== 'false';
        if (nervEnabled) {
            try {
                const nervModule = await import('#nerv/nerv');
                createNERV = nervModule?.createNERV || null;
                HighLevelNERV = await import('#nerv/adapters/high_level_adapter');
                const nervConsts = await import('#shared/nerv/constants');
                ActionCode = nervConsts?.ActionCode || null;
                ActorRole = nervConsts?.ActorRole || {};

                if (typeof createNERV === 'function') {
                    this.nerv = await createNERV();
                    this.log('info', 'NERV initialized for proxy service');
                } else {
                    this.log('info', 'NERV createNERV not available, skipping NERV integration');
                    this.nerv = null;
                }
            } catch (err) {
                this.log('warn', 'NERV initialization failed or not available, continuing without NERV', {
                    error: err.message
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
            } catch (err) {
                this.log('warn', 'Helmet middleware failed', { error: err.message });
            }

            // Compression middleware
            try {
                this.app.use(
                    compression({
                        filter: (req, res) => {
                            if (req.headers['x-no-compression']) return false;
                            return compression.filter(req, res);
                        },
                        threshold: 512
                    })
                );
            } catch (err) {
                this.log('warn', 'Compression middleware failed', { error: err.message });
            }

            // Rate limiting (1000 req/min)
            try {
                const limiter = rateLimit({
                    windowMs: 60 * 1000,
                    max: 1000,
                    message: 'Too many requests, please try again later',
                    standardHeaders: true,
                    legacyHeaders: false,
                    skip: req => req.url === '/health' || req.url === '/healthz'
                });
                this.app.use(limiter);
            } catch (err) {
                this.log('warn', 'Rate limiting middleware failed', { error: err.message });
            }

            // Correlation ID middleware
            this.app.use((req, res, next) => {
                const correlationId = req.headers['x-correlation-id'] || req.headers['x-request-id'] || uuidv4();

                req.correlationId = correlationId;
                res.setHeader('X-Correlation-ID', correlationId);
                res.setHeader('X-Request-Id', correlationId);

                this.asyncLocalStorage.run({ correlationId }, () => next());
            });

            // Metrics endpoint
            this.app.get('/metrics', async (req, res) => {
                try {
                    // Update circuit breaker state metric
                    const cbState = this.circuitBreaker.state;
                    const stateValue = cbState === 'CLOSED' ? 0 : cbState === 'HALF_OPEN' ? 1 : 2;
                    this._setMetric(this.metrics.circuitBreakerState, stateValue);

                    res.setHeader('Content-Type', promClient.register.contentType || 'text/plain; version=0.0.4');
                    res.end(await promClient.register.metrics());
                } catch (err) {
                    this.log('error', 'Metrics endpoint error', { error: err.message });
                    res.statusCode = 500;
                    res.end('Metrics error');
                }
            });

            // Default route (proxy all other requests)
            this.app.use((req, res) => this.handleHTTPRequest(req, res));

            // Create HTTP server
            this.server = http.createServer(this.app);
            this.server.on('upgrade', this.handleWebSocketUpgrade.bind(this));

            // Start listening
            this.server.listen(Number(this.config.PROXY_PORT), String(this.config.PROXY_BIND), () => {
                this.log('info', '✅ Chrome Proxy Service v2.0 started');
                this.log('info', `   Listening: ${this.config.PROXY_BIND}:${this.config.PROXY_PORT}`);
                this.log('info', `   Forwarding to: ${this.config.CHROME_HOST}:${this.config.CHROME_PORT}`);
                this.log('info', `   Public URL: http://${this.config.PUBLIC_IP}:${this.config.PROXY_PORT}`);
                this.log('info', `   Idle timeout: ${this._idleTimeoutMs}ms`);
                this.log('info', `   CORS origins: ${this.config.ALLOWED_ORIGINS.length} allowed`);
                resolve();
            });

            this.server.on('error', err => {
                if (err.code === 'EADDRINUSE') {
                    reject(
                        new Error(
                            `Port ${this.config.PROXY_PORT} is already in use. ` +
                                `Stop the process or use a different port.`
                        )
                    );
                } else {
                    reject(err);
                }
            });

            // Graceful shutdown handlers
            process.on('SIGINT', () => this._handleShutdown('SIGINT'));
            process.on('SIGTERM', () => this._handleShutdown('SIGTERM'));
        });
    }

    /* ======================================================================
       Graceful Shutdown
    ====================================================================== */
    async _handleShutdown(signal) {
        this.log('warn', `Received ${signal}, shutting down gracefully...`);
        await this.stop();
        process.exit(0);
    }

    async stop() {
        this.log('info', 'Shutting down proxy...');

        const uptime = Math.floor((Date.now() - this.stats.startTime) / 1000);
        this.log('info', 'Final statistics:', {
            uptime: `${uptime}s`,
            httpRequests: this.stats.httpRequests,
            wsUpgrades: this.stats.wsUpgrades,
            errors: this.stats.errors,
            activeConnections: this.activeConnections.size,
            cacheHits: this.stats.cacheHits,
            cacheMisses: this.stats.cacheMisses
        });

        // Clear idle check interval
        if (this._idleCheckInterval) {
            clearInterval(this._idleCheckInterval);
        }

        // Gracefully close active connections (10s timeout)
        const closePromises = Array.from(this.activeConnections).map(socket => {
            return new Promise(resolve => {
                socket.on('close', resolve);
                socket.end(); // Graceful close

                // Force after 10s
                setTimeout(() => {
                    if (!socket.destroyed) {
                        socket.destroy();
                    }
                    resolve();
                }, 10000);
            });
        });

        await Promise.all(closePromises);
        this.activeConnections.clear();

        // Close server
        return new Promise(resolve => {
            if (this.server) {
                this.server.close(() => {
                    this.log('info', '✅ Proxy stopped');
                    resolve();
                });

                // Force after 5s
                setTimeout(() => {
                    this.log('warn', 'Forcing server shutdown after timeout');
                    resolve();
                }, 5000);
            } else {
                resolve();
            }
        });
    }
}

export default ChromeProxyService;
