/* ==========================================================================
   scripts/chrome-proxy-service.js
   Chrome DevTools Protocol WebSocket Proxy with URL Rewriting

   Purpose: Enable Docker container → Windows Chrome connection by:
   - Proxying HTTP /json endpoints with URL rewriting
   - Transparently proxying WebSocket upgrades
   - Rewriting localhost URLs to public IP

   Usage:
   - Windows: node chrome-proxy-service.js [PUBLIC_IP] [LOG_LEVEL]
   - Example: node chrome-proxy-service.js 192.168.0.2 info

   Architecture:
    Container → Proxy (0.0.0.0:9224) → Chrome (127.0.0.1)
========================================================================== */

const http = require('http');
const net = require('net');
const os = require('os');

// Optional operational libraries
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const pino = require('pino');
const { AsyncLocalStorage } = require('async_hooks');
const { v4: uuidv4 } = require('uuid');
const promClient = require('prom-client');

// NERV integration (optional)
const { createNERV } = require('../src/nerv/nerv');
const HighLevelNERV = require('../src/nerv/adapters/high_level_adapter');
const { ActionCode, ActorRole } = require('../src/shared/nerv/constants');
const { CONNECTION_MODES } = require('../src/core/constants/browser');
/* ==========================================================================
   CONFIGURATION
========================================================================== */
const CONFIG = {
    PROXY_PORT: parseInt(process.env.CHROME_PROXY_PORT || '9224'),
    CHROME_HOST: process.env.CHROME_HOST || '127.0.0.1',
    CHROME_PORT: parseInt(process.env.CHROME_PORT || '9224'),
    PUBLIC_IP: process.env.PUBLIC_IP || null, // Auto-detect if not set
    LOG_LEVEL: process.env.LOG_LEVEL || 'info' // debug, info, warn, error
};

/* ==========================================================================
   CHROME PROXY SERVICE CLASS
========================================================================== */
class ChromeProxyService {
    constructor(config = {}) {
        this.config = { ...CONFIG, ...config };
        this.server = null;
        this.app = null;
        this.activeConnections = new Set();
        this.stats = {
            httpRequests: 0,
            wsUpgrades: 0,
            errors: 0,
            startTime: Date.now()
        };

        // Logger
        this.logger = pino({ level: this.config.LOG_LEVEL || 'info' });

        // AsyncLocalStorage for request correlation
        this.asyncLocalStorage = new AsyncLocalStorage();

        // Prometheus metrics (register defaults)
        try {
            promClient.collectDefaultMetrics({ timeout: 5000 });
        } catch (_e) {
            // ignore if collectDefaultMetrics fails
        }

        this.metrics = {
            httpRequests: new promClient.Counter({
                name: 'chrome_proxy_http_requests_total',
                help: 'Total HTTP requests'
            }),
            wsUpgrades: new promClient.Counter({
                name: 'chrome_proxy_ws_upgrades_total',
                help: 'Total WebSocket upgrades'
            }),
            proxyErrors: new promClient.Counter({ name: 'chrome_proxy_errors_total', help: 'Total proxy errors' }),
            activeConnections: new promClient.Gauge({
                name: 'chrome_proxy_active_connections',
                help: 'Active connections'
            }),
            requestDuration: new promClient.Histogram({
                name: 'chrome_proxy_request_duration_seconds',
                help: 'Request duration seconds',
                buckets: [0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5]
            })
        };

        // Auto-detect public IP if not provided
        if (!this.config.PUBLIC_IP) {
            this.config.PUBLIC_IP = this._detectPublicIP();
        }

        // Create a websocket/http proxy for robust upgrade handling
        try {
            const httpProxy = require('http-proxy');
            this.wsProxy = httpProxy.createProxyServer({
                target: `http://${this.config.CHROME_HOST}:${this.config.CHROME_PORT}`,
                ws: true,
                changeOrigin: true
            });

            this.wsProxy.on('error', (err, req, res) => {
                this.stats.errors++;
                this.log('error', 'Proxy error', { error: err && err.message ? err.message : String(err) });
                try {
                    if (res && !res.finished) {
                        res.writeHead(502, { 'Content-Type': 'text/plain' });
                        res.end('Proxy error');
                    }
                } catch (_e) {
                    // ignore
                }
            });
        } catch (_e) {
            // Fallback: if http-proxy not available, will use raw socket proxy earlier implementation
            this.wsProxy = null;
            this.log('warn', 'http-proxy unavailable, falling back to raw socket method');
        }

        // Idle connection checker (cleanup stale sockets)
        this._idleTimeoutMs = parseInt(process.env.WS_IDLE_TIMEOUT_MS || '60000', 10);
        this._idleCheckInterval = setInterval(
            () => this._cleanupIdleConnections(),
            Math.max(10000, this._idleTimeoutMs / 2)
        );
    }
    /**
     * Auto-detect public IP address from network interfaces
     */
    _detectPublicIP() {
        const interfaces = os.networkInterfaces();

        // Try common interface names first
        const preferredNames = ['Ethernet', 'Wi-Fi', 'eth0', 'wlan0', 'en0'];

        for (const name of preferredNames) {
            if (interfaces[name]) {
                const ipv4 = interfaces[name].find(iface => iface.family === 'IPv4' && !iface.internal);
                if (ipv4) {
                    return ipv4.address;
                }
            }
        }

        // Fallback: find any non-internal IPv4
        for (const name in interfaces) {
            const ipv4 = interfaces[name].find(iface => iface.family === 'IPv4' && !iface.internal);
            if (ipv4) {
                return ipv4.address;
            }
        }

        // Last resort
        return '192.168.0.2';
    }

    /**
     * Logging with level filtering
     */
    log(level, message, meta = {}) {
        const store = this.asyncLocalStorage.getStore();
        const requestId = store && store.requestId ? store.requestId : undefined;
        const logMeta = { ...meta };
        if (requestId) logMeta.requestId = requestId;

        if (this.logger && typeof this.logger[level] === 'function') {
            this.logger[level](logMeta, message);
        } else if (this.logger && typeof this.logger.info === 'function') {
            this.logger.info(logMeta, message);
        } else {
            const timestamp = new Date().toISOString();
            const metaStr = Object.keys(logMeta).length > 0 ? JSON.stringify(logMeta) : '';
            console.log(`[${timestamp}] [${level.toUpperCase().padEnd(5)}] ${message} ${metaStr}`);
        }
    }

    /**
     * Rewrite WebSocket URLs in JSON responses
     * Replaces localhost/127.0.0.1 with public IP
     */
    rewriteWebSocketURL(data) {
        try {
            const json = JSON.parse(data);

            const rewriteIfPresent = val => {
                if (!val) return val;
                try {
                    return this._rewriteURL(val);
                } catch (_e) {
                    return String(val).replace(
                        new RegExp(
                            `(${this.config.CHROME_HOST}|localhost|127\\.0\\.0\\.1):${this.config.CHROME_PORT}`,
                            'g'
                        ),
                        `${this.config.PUBLIC_IP}:${this.config.PROXY_PORT}`
                    );
                }
            };

            // Rewrite single webSocketDebuggerUrl (for /json/version)
            if (json.webSocketDebuggerUrl) {
                const original = json.webSocketDebuggerUrl;
                json.webSocketDebuggerUrl = rewriteIfPresent(original);
                this.log('debug', 'URL rewritten', { original, rewritten: json.webSocketDebuggerUrl });
            }

            // Rewrite array of targets/pages (for /json and /json/list)
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
        } catch (_err) {
            this.log('error', 'JSON parse/rewrite failed', {
                error: _err && _err.message ? _err.message : String(_err)
            });
            return data;
        }
    }

    /**
     * Helper: Rewrite a single URL
     */
    _rewriteURL(url) {
        try {
            // If url doesn't look absolute, fallback to string replacement
            if (!/^https?:\/\//i.test(url) && !/^wss?:\/\//i.test(url)) {
                return String(url).replace(
                    new RegExp(
                        `(${this.config.CHROME_HOST}|localhost|127\\.0\\.0\\.1):${this.config.CHROME_PORT}`,
                        'g'
                    ),
                    `${this.config.PUBLIC_IP}:${this.config.PROXY_PORT}`
                );
            }

            const u = new URL(url);
            if (u.hostname === this.config.CHROME_HOST || u.hostname === '127.0.0.1' || u.hostname === 'localhost') {
                u.hostname = this.config.PUBLIC_IP;
                u.port = String(this.config.PROXY_PORT);
            }
            return u.toString();
        } catch (_e) {
            return String(url).replace(
                new RegExp(`(${this.config.CHROME_HOST}|localhost|127\\.0\\.0\\.1):${this.config.CHROME_PORT}`, 'g'),
                `${this.config.PUBLIC_IP}:${this.config.PROXY_PORT}`
            );
        }
    }

    /**
     * Cleanup idle connections that have been inactive over the configured timeout
     */
    _cleanupIdleConnections() {
        const now = Date.now();
        for (const socket of Array.from(this.activeConnections)) {
            try {
                const last = socket && socket.__lastActivity ? socket.__lastActivity : 0;
                if (last && now - last > this._idleTimeoutMs) {
                    this.log('warn', 'Closing idle websocket', { idleMs: now - last });
                    try {
                        socket.destroy();
                    } catch (_e) {}
                    this.activeConnections.delete(socket);
                    try {
                        this.metrics.activeConnections.set(this.activeConnections.size);
                    } catch (_e) {}
                }
            } catch (_e) {
                // ignore per-socket cleanup errors
            }
        }
    }

    /**
     * Emit a structured event to NERV if available
     */
    _emitNervEvent(actionCode, payload = {}, correlationId = null) {
        try {
            if (!this.nerv || !HighLevelNERV || typeof HighLevelNERV.sendEvent !== 'function') return null;
            const actor = ActorRole.INFRA || 'INFRA';
            return HighLevelNERV.sendEvent(this.nerv, actor, actionCode, payload, correlationId, null);
        } catch (_err) {
            // non-fatal: keep proxy running even if NERV publish fails
            this.log('debug', 'NERV publish failed', { error: _err && _err.message ? _err.message : String(_err) });
            return null;
        }
    }

    /**
     * Handle HTTP requests (with URL rewriting for /json endpoints)
     */
    handleHTTPRequest(req, res) {
        this.stats.httpRequests++;
        try {
            this.metrics.httpRequests.inc();
        } catch (_e) {}

        const clientIP = req.socket.remoteAddress;
        this.log('info', `HTTP ${req.method} ${req.url}`, { from: clientIP });

        const start = process.hrtime();

        // Health endpoint
        if (req.url === '/health' || req.url === '/healthz') {
            const uptime = Math.floor((Date.now() - this.stats.startTime) / 1000);
            const body = JSON.stringify({
                status: 'ok',
                uptime,
                httpRequests: this.stats.httpRequests,
                wsUpgrades: this.stats.wsUpgrades
            });
            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
                'Access-Control-Allow-Origin': '*'
            });
            res.end(body);
            return;
        }

        // Determine if this endpoint needs URL rewriting
        const needsRewrite = req.url && req.url.startsWith('/json');

        // Proxy request to Chrome
        const options = {
            hostname: this.config.CHROME_HOST,
            port: this.config.CHROME_PORT,
            path: req.url,
            method: req.method,
            headers: req.headers
        };

        const proxyReq = http.request(options, proxyRes => {
            let data = '';

            proxyRes.on('data', chunk => {
                data += chunk;
            });

            proxyRes.on('end', () => {
                // Rewrite URLs if this is a /json endpoint
                const finalData = needsRewrite ? this.rewriteWebSocketURL(data) : data;

                // Send response to client
                res.writeHead(proxyRes.statusCode, {
                    ...proxyRes.headers,
                    'Content-Length': Buffer.byteLength(finalData),
                    'Access-Control-Allow-Origin': '*'
                });
                res.end(finalData);

                this.log('debug', 'HTTP response sent', {
                    status: proxyRes.statusCode,
                    length: finalData.length,
                    rewritten: needsRewrite
                });
                try {
                    const store = this.asyncLocalStorage.getStore();
                    const requestId =
                        store && store.requestId
                            ? store.requestId
                            : (req.headers && req.headers['x-request-id']) || null;
                    const diff = process.hrtime(start);
                    const duration = diff[0] + diff[1] / 1e9;
                    this._emitNervEvent(
                        ActionCode.KERNEL_TELEMETRY,
                        {
                            event: 'proxy.http.response',
                            method: req.method,
                            path: req.url,
                            status: proxyRes.statusCode,
                            durationSeconds: duration,
                            length: finalData.length,
                            rewritten: needsRewrite
                        },
                        requestId
                    );
                } catch (_e) {
                    // ignore nerv emission errors
                }
            });
        });

        proxyReq.on('error', err => {
            this.stats.errors++;
            try {
                this.metrics.proxyErrors.inc();
            } catch (_e) {}
            this.log('error', 'Chrome unreachable', { error: err.message });

            res.writeHead(502, { 'Content-Type': 'text/plain' });
            res.end(
                `Chrome unreachable: ${err.message}\n\nPlease ensure Chrome is running with --remote-debugging-port=${this.config.CHROME_PORT}`
            );
            try {
                const store = this.asyncLocalStorage.getStore();
                const requestId =
                    store && store.requestId ? store.requestId : (req.headers && req.headers['x-request-id']) || null;
                this._emitNervEvent(
                    ActionCode.DRIVER_ERROR,
                    { event: 'proxy.http.error', error: err.message, path: req.url, method: req.method },
                    requestId
                );
            } catch (_e) {}
        });

        // Forward request body
        req.pipe(proxyReq);

        // When response finishes, observe duration
        res.on('finish', () => {
            try {
                const diff = process.hrtime(start);
                const duration = diff[0] + diff[1] / 1e9;
                this.metrics.requestDuration.observe(duration);
            } catch (_e) {}
        });
    }

    /**
     * Handle WebSocket upgrade (transparent proxy)
     */
    handleWebSocketUpgrade(req, socket, head) {
        this.stats.wsUpgrades++;
        try {
            this.metrics.wsUpgrades.inc();
        } catch (_e) {}

        const clientIP = socket.remoteAddress;
        this.log('info', `WebSocket upgrade: ${req.url}`, { from: clientIP });

        // Track and attach activity timestamp
        const markActive = s => {
            try {
                s.__lastActivity = Date.now();
            } catch (_) {}
        };

        markActive(socket);
        socket.on('data', () => markActive(socket));

        // Prefer http-proxy if available for robust websocket handling
        if (this.wsProxy) {
            try {
                this.activeConnections.add(socket);
                socket.on('close', () => {
                    this.log('debug', 'WebSocket closed');
                    this.activeConnections.delete(socket);
                    try {
                        this.metrics.activeConnections.set(this.activeConnections.size);
                    } catch (_e) {}
                });

                // Proxy the websocket upgrade
                this.wsProxy.ws(req, socket, head);
                try {
                    const requestId = (req && req.headers && req.headers['x-request-id']) || uuidv4();
                    this._emitNervEvent(
                        ActionCode.KERNEL_TELEMETRY,
                        { event: 'proxy.ws.upgrade', url: req.url, from: clientIP },
                        requestId
                    );
                } catch (_e) {}

                try {
                    this.metrics.activeConnections.set(this.activeConnections.size);
                } catch (_e) {}
                return;
            } catch (_err) {
                this.stats.errors++;
                try {
                    this.metrics.proxyErrors.inc();
                } catch (_e) {}
                this.log('error', 'WS proxy (http-proxy) failed', {
                    error: _err && _err.message ? _err.message : String(_err)
                });
                try {
                    const requestId = (req && req.headers && req.headers['x-request-id']) || uuidv4();
                    this._emitNervEvent(
                        ActionCode.DRIVER_ERROR,
                        {
                            event: 'proxy.ws.proxy_error',
                            error: _err && _err.message ? _err.message : String(_err),
                            url: req.url
                        },
                        requestId
                    );
                } catch (_e) {}
                try {
                    socket.destroy();
                } catch (_) {}
                return;
            }
        }

        // Fallback: raw socket proxy to Chrome
        const proxySocket = net.connect(this.config.CHROME_PORT, this.config.CHROME_HOST, () => {
            this.log('debug', 'Chrome WebSocket connected');

            // Forward HTTP upgrade request
            proxySocket.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`);

            // Forward headers
            Object.entries(req.headers).forEach(([key, value]) => {
                proxySocket.write(`${key}: ${value}\r\n`);
            });

            proxySocket.write('\r\n');

            // Forward upgrade payload (if any)
            if (head && head.length > 0) {
                proxySocket.write(head);
            }
        });

        // Bidirectional pipe: Client ↔ Proxy ↔ Chrome
        socket.pipe(proxySocket);
        proxySocket.pipe(socket);

        // Track active connections
        this.activeConnections.add(socket);
        try {
            this.metrics.activeConnections.set(this.activeConnections.size);
        } catch (_e) {}

        try {
            const requestId = (req && req.headers && req.headers['x-request-id']) || uuidv4();
            this._emitNervEvent(
                ActionCode.KERNEL_TELEMETRY,
                { event: 'proxy.ws.connected', url: req.url, from: clientIP },
                requestId
            );
        } catch (_e) {}

        // Cleanup on close
        socket.on('close', () => {
            this.log('debug', 'WebSocket closed');
            this.activeConnections.delete(socket);
            proxySocket.destroy();
            try {
                this.metrics.activeConnections.set(this.activeConnections.size);
            } catch (_e) {}
        });

        // Error handling
        proxySocket.on('error', err => {
            this.stats.errors++;
            try {
                this.metrics.proxyErrors.inc();
            } catch (_e) {}
            this.log('error', 'Proxy socket error', { error: err.message });
            try {
                const requestId = (req && req.headers && req.headers['x-request-id']) || uuidv4();
                this._emitNervEvent(
                    ActionCode.DRIVER_ERROR,
                    { event: 'proxy.ws.proxy_socket_error', error: err.message, url: req.url },
                    requestId
                );
            } catch (_e) {}
            socket.destroy();
        });

        socket.on('error', err => {
            this.stats.errors++;
            try {
                this.metrics.proxyErrors.inc();
            } catch (_e) {}
            this.log('error', 'Client socket error', { error: err.message });
            try {
                const requestId = (req && req.headers && req.headers['x-request-id']) || uuidv4();
                this._emitNervEvent(
                    ActionCode.DRIVER_ERROR,
                    { event: 'proxy.ws.client_socket_error', error: err.message, url: req.url },
                    requestId
                );
            } catch (_e) {}
            proxySocket.destroy();
        });
    }

    /**
     * Start the proxy server
     */
    async start() {
        // initialize NERV integration if enabled (non-fatal)
        const nervEnabled = (process.env.NERV_INTEGRATION || 'true').toString().toLowerCase() !== 'false';
        if (nervEnabled && typeof createNERV === 'function') {
            try {
                this.nerv = await createNERV();
                this.log('info', 'NERV initialized for proxy service');
            } catch (err) {
                this.log('warn', 'NERV initialization failed, continuing without NERV', {
                    error: err && err.message ? err.message : String(err)
                });
                this.nerv = null;
            }
        }

        return new Promise((resolve, reject) => {
            // Create Express app to add middleware (helmet, rate-limit) and metrics endpoints
            this.app = express();

            // Basic security hardening
            try {
                this.app.use(helmet());
            } catch (_e) {
                /* ignore if helmet missing */
            }

            // Rate limiter (basic)
            try {
                const limiter = rateLimit({
                    windowMs: 60 * 1000,
                    max: 400,
                    standardHeaders: true,
                    legacyHeaders: false
                });
                this.app.use(limiter);
            } catch (_e) {
                /* ignore if rate-limit missing */
            }

            // Request ID + ALS middleware
            this.app.use((req, res, next) => {
                const id = req.headers['x-request-id'] || uuidv4();
                res.setHeader('X-Request-Id', id);
                this.asyncLocalStorage.run({ requestId: id }, () => next());
            });

            // Metrics endpoint
            this.app.get('/metrics', async (req, res) => {
                try {
                    res.setHeader('Content-Type', promClient.register.contentType || 'text/plain; version=0.0.4');
                    res.end(await promClient.register.metrics());
                } catch (_err) {
                    res.statusCode = 500;
                    res.end('metrics error');
                }
            });

            // Health handled by existing logic; route to handleHTTPRequest for everything else
            this.app.use((req, res) => this.handleHTTPRequest(req, res));

            // Create HTTP server from Express app
            this.server = http.createServer(this.app);

            // Handle WebSocket upgrades
            this.server.on('upgrade', this.handleWebSocketUpgrade.bind(this));

            // Listen on all interfaces
            this.server.listen(this.config.PROXY_PORT, '0.0.0.0', () => {
                this.log('info', '✅ Chrome Proxy Service started');
                this.log('info', `   Listening: 0.0.0.0:${this.config.PROXY_PORT}`);
                this.log('info', `   Forwarding to: ${this.config.CHROME_HOST}:${this.config.CHROME_PORT}`);
                this.log('info', `   Public URL: http://${this.config.PUBLIC_IP}:${this.config.PROXY_PORT}`);
                this.log('info', '');
                this.log('info', '🧪 Test endpoints:');
                this.log('info', `   - Local:  http://localhost:${this.config.PROXY_PORT}/json/version`);
                this.log('info', `   - Remote: http://${this.config.PUBLIC_IP}:${this.config.PROXY_PORT}/json/version`);
                this.log('info', '');
                resolve();
            });

            // Error handling
            this.server.on('error', err => {
                if (err.code === 'EADDRINUSE') {
                    reject(
                        new Error(
                            `Port ${this.config.PROXY_PORT} is already in use. Stop the process or use a different port.`
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

    /**
     * Handle graceful shutdown
     */
    async _handleShutdown(signal) {
        this.log('warn', `Received ${signal}, shutting down gracefully...`);
        await this.stop();
        process.exit(0);
    }

    /**
     * Stop the proxy server
     */
    async stop() {
        this.log('info', 'Shutting down proxy...');

        // Print stats
        const uptime = Math.floor((Date.now() - this.stats.startTime) / 1000);
        this.log('info', 'Final statistics:', {
            uptime: `${uptime}s`,
            httpRequests: this.stats.httpRequests,
            wsUpgrades: this.stats.wsUpgrades,
            errors: this.stats.errors,
            activeConnections: this.activeConnections.size
        });

        // Close all active WebSocket connections
        this.activeConnections.forEach(socket => socket.destroy());
        this.activeConnections.clear();

        // Close HTTP server
        return new Promise(resolve => {
            if (this.server) {
                this.server.close(() => {
                    this.log('info', '✅ Proxy stopped');
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }
}

/* ==========================================================================
   CLI ENTRY POINT
========================================================================== */
if (require.main === module) {
    // CLI parsing: supports positional `PUBLIC_IP LOG_LEVEL` or flags `--public-ip/-p` and `--log-level/-l`
    let publicIP = null;
    let logLevel = null;
    for (let i = 2; i < process.argv.length; i++) {
        const a = process.argv[i];
        if ((a === '--public-ip' || a === '-p') && i + 1 < process.argv.length) {
            publicIP = process.argv[++i];
            continue;
        }
        if ((a === '--log-level' || a === '-l') && i + 1 < process.argv.length) {
            logLevel = process.argv[++i];
            continue;
        }
        if (!publicIP) {
            publicIP = a;
            continue;
        }
        if (!logLevel) {
            logLevel = a;
            continue;
        }
    }

    const proxy = new ChromeProxyService({
        PUBLIC_IP: publicIP || undefined,
        LOG_LEVEL: logLevel || undefined
    });

    proxy.start().catch(err => {
        console.error(`\n❌ Failed to start Chrome Proxy Service:`);
        console.error(`   ${err.message}\n`);

        if (err.message.includes('EADDRINUSE')) {
            console.error('💡 Troubleshooting:');
            console.error('   1. Check if another process is using the port:');
            console.error(`      netstat -ano | findstr :${CONFIG.PROXY_PORT}`);
            console.error('   2. Kill the process or use a different port:');
            console.error(`      set CHROME_PROXY_PORT=9225 && node chrome-proxy-service.js\n`);
        } else if (err.message.includes('unreachable')) {
            console.error('💡 Troubleshooting:');
            console.error('   1. Ensure Chrome is running with remote debugging:');
            console.error(`      chrome.exe --remote-debugging-port=${CONFIG.CHROME_PORT}`);
            console.error(`   2. Test Chrome endpoint: curl http://localhost:${CONFIG.CHROME_PORT}/json/version\n`);
        }

        process.exit(1);
    });
}

/* ==========================================================================
   EXPORTS (for programmatic usage)
========================================================================== */
module.exports = ChromeProxyService;
