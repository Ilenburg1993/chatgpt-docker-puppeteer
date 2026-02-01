/* ==========================================================================
   src/infra/proxy/chromeProxyService.js
   Chrome DevTools Protocol WebSocket Proxy (refatorado como módulo)

   Exporta: ChromeProxyService (start/stop)
========================================================================== */

const http = require('http');
const net = require('net');
const os = require('os');

const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const logger = require('@core/logger');  // Use system logger
const { AsyncLocalStorage } = require('async_hooks');
const { v4: uuidv4 } = require('uuid');
const promClient = require('prom-client');

// NERV integration (optional) - lazy loaded
let createNERV = null;
let HighLevelNERV = null;
let ActionCode = null;
let ActorRole = null;

const CONFIG = {
    PROXY_PORT: parseInt(process.env.CHROME_PROXY_PORT || '9224'),
    CHROME_HOST: process.env.CHROME_HOST || '127.0.0.1',
    CHROME_PORT: parseInt(process.env.CHROME_PORT || '9225'),
    PROXY_BIND: process.env.CHROME_PROXY_BIND || '0.0.0.0',
    PUBLIC_IP: process.env.PUBLIC_IP || null,
    LOG_LEVEL: process.env.LOG_LEVEL || 'info'
};

class ChromeProxyService {
    constructor(config = {}) {
        this.config = { ...CONFIG, ...config };
        this.server = null;
        this.app = null;
        this.activeConnections = new Set();
        this.stats = { httpRequests: 0, wsUpgrades: 0, errors: 0, startTime: Date.now() };

        this.logger = logger; // Use system logger
        this.asyncLocalStorage = new AsyncLocalStorage();

        try {
            promClient.collectDefaultMetrics({ timeout: 5000 });
        } catch (err) {
            void err;
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

        if (!this.config.PUBLIC_IP) this.config.PUBLIC_IP = this._detectPublicIP();

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
                } catch (err) {
                    void err;
                }
            });
        } catch (err) {
            this.wsProxy = null;
            this.log('warn', 'http-proxy unavailable, falling back to raw socket method');
            void err;
        }

        this._idleTimeoutMs = parseInt(process.env.WS_IDLE_TIMEOUT_MS || '60000', 10);
        this._idleCheckInterval = setInterval(
            () => this._cleanupIdleConnections(),
            Math.max(10000, this._idleTimeoutMs / 2)
        );
    }

    _detectPublicIP() {
        const interfaces = os.networkInterfaces();
        const preferredNames = ['Ethernet', 'Wi-Fi', 'eth0', 'wlan0', 'en0'];
        for (const name of preferredNames) {
            if (interfaces[name]) {
                const ipv4 = interfaces[name].find(iface => iface.family === 'IPv4' && !iface.internal);
                if (ipv4) return ipv4.address;
            }
        }
        for (const name in interfaces) {
            const ipv4 = interfaces[name].find(iface => iface.family === 'IPv4' && !iface.internal);
            if (ipv4) return ipv4.address;
        }
        return '192.168.0.2';
    }

    log(level, message, meta = {}) {
        const store = this.asyncLocalStorage.getStore();
        const requestId = store && store.requestId ? store.requestId : undefined;
        const metaStr = requestId ? ` [${requestId}]` : '';
        const metaJson = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
        const formattedMessage = `[CHROME_PROXY]${metaStr} ${message}${metaJson}`;

        if (this.logger && typeof this.logger.log === 'function') {
            this.logger.log(level.toUpperCase(), formattedMessage);
        } else {
            const timestamp = new Date().toISOString();
            console.log(`[${timestamp}] [${level.toUpperCase().padEnd(5)}] ${formattedMessage}`);
        }
    }

    setNERV(nerv) {
        this._nerv = nerv;
        this.log('info', 'NERV integration enabled');
    }

    // Accept an optional host fallback (e.g., req.headers.host) to make
    // rewrites reliable when PUBLIC_IP is not configured.
    rewriteWebSocketURL(data, hostFallback) {
        try {
            const json = JSON.parse(data);
            const publicHost = this.config.PUBLIC_IP || (hostFallback ? String(hostFallback).split(':')[0] : null);
            const rewriteIfPresent = val => {
                if (!val) return val;
                try {
                    return this._rewriteURL(val);
                } catch (err) {
                    void err;
                    const replacementHost = publicHost || this.config.PUBLIC_IP || this.config.CHROME_HOST;
                    return String(val).replace(
                        new RegExp(
                            `(${this.config.CHROME_HOST}|localhost|127\\.0\\.0\\.1):${this.config.CHROME_PORT}`,
                            'g'
                        ),
                        `${replacementHost}:${this.config.PROXY_PORT}`
                    );
                }
            };
            if (json.webSocketDebuggerUrl) {
                const original = json.webSocketDebuggerUrl;
                json.webSocketDebuggerUrl = rewriteIfPresent(original);
                this.log('debug', 'URL rewritten', { original, rewritten: json.webSocketDebuggerUrl });
            }
            if (Array.isArray(json)) {
                json.forEach(item => {
                    if (item.webSocketDebuggerUrl)
                        item.webSocketDebuggerUrl = rewriteIfPresent(item.webSocketDebuggerUrl);
                    if (item.devtoolsFrontendUrl) item.devtoolsFrontendUrl = rewriteIfPresent(item.devtoolsFrontendUrl);
                });
            }
            return JSON.stringify(json);
        } catch (err) {
            this.log('error', 'JSON parse/rewrite failed', {
                error: err && err.message ? err.message : String(err)
            });
            return data;
        }
    }

    _rewriteURL(url, publicHost) {
        try {
            const replacementHost = publicHost || this.config.PUBLIC_IP || this.config.CHROME_HOST;
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
            void err;
            const replacementHost = publicHost || this.config.PUBLIC_IP || this.config.CHROME_HOST;
            return String(url).replace(
                new RegExp(`(${this.config.CHROME_HOST}|localhost|127\\.0\\.0\\.1):${this.config.CHROME_PORT}`, 'g'),
                `${replacementHost}:${this.config.PROXY_PORT}`
            );
        }
    }

    _cleanupIdleConnections() {
        const now = Date.now();
        for (const socket of Array.from(this.activeConnections)) {
            try {
                const last = socket && socket.__lastActivity ? socket.__lastActivity : 0;
                if (last && now - last > this._idleTimeoutMs) {
                    this.log('warn', 'Closing idle websocket', { idleMs: now - last });
                    try {
                        socket.destroy();
                    } catch (err) {
                        void err;
                    }
                    this.activeConnections.delete(socket);
                    try {
                        this.metrics.activeConnections.set(this.activeConnections.size);
                    } catch (err) {
                        void err;
                    }
                }
            } catch (err) {
                void err;
            }
        }
    }

    _emitNervEvent(actionCode, payload = {}, correlationId = null) {
        try {
            if (!this.nerv || !HighLevelNERV || typeof HighLevelNERV.sendEvent !== 'function') return null;
            const actor = ActorRole.INFRA || 'INFRA';
            return HighLevelNERV.sendEvent(this.nerv, actor, actionCode, payload, correlationId, null);
        } catch (err) {
            this.log('debug', 'NERV publish failed', { error: err && err.message ? err.message : String(err) });
            return null;
        }
    }

    handleHTTPRequest(req, res) {
        this.stats.httpRequests++;
        try {
            this.metrics.httpRequests.inc();
        } catch (err) {
            void err;
        }
        const clientIP = req.socket.remoteAddress;
        this.log('info', `HTTP ${req.method} ${req.url}`, { from: clientIP });
        const start = process.hrtime();
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
        const needsRewrite = req.url && req.url.startsWith('/json');
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
                    // Pass req.headers.host as fallback for PUBLIC_IP so rewriting
                    // can use the Host header when PUBLIC_IP is not configured.
                    const hostFallback = (req && req.headers && req.headers.host) ? req.headers.host : null;
                    const finalData = needsRewrite ? this.rewriteWebSocketURL(data, hostFallback) : data;
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
                    if (ActionCode)
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
                } catch (err) {
                    void err;
                }
            });
        });
        proxyReq.on('error', err => {
            this.stats.errors++;
            try {
                this.metrics.proxyErrors.inc();
            } catch (err) {
                void err;
            }
            this.log('error', 'Chrome unreachable', { error: err.message });
            res.writeHead(502, { 'Content-Type': 'text/plain' });
            res.end(
                `Chrome unreachable: ${err.message}\n\nPlease ensure Chrome is running with --remote-debugging-port=${this.config.CHROME_PORT}`
            );
            try {
                const store = this.asyncLocalStorage.getStore();
                const requestId =
                    store && store.requestId ? store.requestId : (req.headers && req.headers['x-request-id']) || null;
                if (ActionCode)
                    this._emitNervEvent(
                        ActionCode.DRIVER_ERROR,
                        { event: 'proxy.http.error', error: err.message, path: req.url, method: req.method },
                        requestId
                    );
            } catch (err) {
                void err;
            }
        });
        req.pipe(proxyReq);
        res.on('finish', () => {
            try {
                const diff = process.hrtime(start);
                const duration = diff[0] + diff[1] / 1e9;
                this.metrics.requestDuration.observe(duration);
            } catch (err) {
                void err;
            }
        });
    }

    handleWebSocketUpgrade(req, socket, head) {
        this.stats.wsUpgrades++;
        try {
            this.metrics.wsUpgrades.inc();
        } catch (err) {
            void err;
        }
        const clientIP = socket.remoteAddress;
        this.log('info', `WebSocket upgrade: ${req.url}`, { from: clientIP });
        const markActive = s => {
            try {
                s.__lastActivity = Date.now();
            } catch (err) {
                void err;
            }
        };
        markActive(socket);
        socket.on('data', () => markActive(socket));
        if (this.wsProxy) {
            try {
                this.activeConnections.add(socket);
                socket.on('close', () => {
                    this.log('debug', 'WebSocket closed');
                    this.activeConnections.delete(socket);
                    try {
                        this.metrics.activeConnections.set(this.activeConnections.size);
                    } catch (err) {
                        void err;
                    }
                });
                this.wsProxy.ws(req, socket, head);
                try {
                    const requestId = (req && req.headers && req.headers['x-request-id']) || uuidv4();
                    if (ActionCode)
                        this._emitNervEvent(
                            ActionCode.KERNEL_TELEMETRY,
                            { event: 'proxy.ws.upgrade', url: req.url, from: clientIP },
                            requestId
                        );
                } catch (err) {
                    void err;
                }
                try {
                    this.metrics.activeConnections.set(this.activeConnections.size);
                } catch (err) {
                    void err;
                }
                return;
            } catch (err) {
                this.stats.errors++;
                try {
                    this.metrics.proxyErrors.inc();
                } catch (err) {
                    void err;
                }
                this.log('error', 'WS proxy (http-proxy) failed', {
                    error: err && err.message ? err.message : String(err)
                });
                try {
                    const requestId = (req && req.headers && req.headers['x-request-id']) || uuidv4();
                    if (ActionCode)
                        this._emitNervEvent(
                            ActionCode.DRIVER_ERROR,
                            {
                                event: 'proxy.ws.proxy_error',
                                error: err && err.message ? err.message : String(err),
                                url: req.url
                            },
                            requestId
                        );
                } catch (err) {
                    void err;
                }
                try {
                    socket.destroy();
                } catch (err) {
                    void err;
                }
                return;
            }
        }
        const proxySocket = net.connect(this.config.CHROME_PORT, this.config.CHROME_HOST, () => {
            this.log('debug', 'Chrome WebSocket connected');
            proxySocket.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`);
            Object.entries(req.headers).forEach(([key, value]) => {
                proxySocket.write(`${key}: ${value}\r\n`);
            });
            proxySocket.write('\r\n');
            if (head && head.length > 0) proxySocket.write(head);
        });
        socket.pipe(proxySocket);
        proxySocket.pipe(socket);
        this.activeConnections.add(socket);
        try {
            this.metrics.activeConnections.set(this.activeConnections.size);
        } catch (err) {
            void err;
        }
        try {
            const requestId = (req && req.headers && req.headers['x-request-id']) || uuidv4();
            if (ActionCode)
                this._emitNervEvent(
                    ActionCode.KERNEL_TELEMETRY,
                    { event: 'proxy.ws.connected', url: req.url, from: clientIP },
                    requestId
                );
        } catch (err) {
            void err;
        }
        socket.on('close', () => {
            this.log('debug', 'WebSocket closed');
            this.activeConnections.delete(socket);
            proxySocket.destroy();
            try {
                this.metrics.activeConnections.set(this.activeConnections.size);
            } catch (err) {
                void err;
            }
        });
        proxySocket.on('error', err => {
            this.stats.errors++;
            try {
                this.metrics.proxyErrors.inc();
            } catch (err) {
                void err;
            }
            this.log('error', 'Proxy socket error', { error: err.message });
            try {
                const requestId = (req && req.headers && req.headers['x-request-id']) || uuidv4();
                if (ActionCode)
                    this._emitNervEvent(
                        ActionCode.DRIVER_ERROR,
                        { event: 'proxy.ws.proxy_socket_error', error: err.message, url: req.url },
                        requestId
                    );
            } catch (err) {
                void err;
            }
            socket.destroy();
        });
        socket.on('error', err => {
            this.stats.errors++;
            try {
                this.metrics.proxyErrors.inc();
            } catch (err) {
                void err;
            }
            this.log('error', 'Client socket error', { error: err.message });
            try {
                const requestId = (req && req.headers && req.headers['x-request-id']) || uuidv4();
                if (ActionCode)
                    this._emitNervEvent(
                        ActionCode.DRIVER_ERROR,
                        { event: 'proxy.ws.client_socket_error', error: err.message, url: req.url },
                        requestId
                    );
            } catch (err) {
                void err;
            }
            proxySocket.destroy();
        });
    }

    async start() {
        const nervEnabled = (process.env.NERV_INTEGRATION || 'true').toString().toLowerCase() !== 'false';
        if (nervEnabled) {
            try {
                const nervModule = require('../../nerv/nerv');
                createNERV = nervModule && nervModule.createNERV ? nervModule.createNERV : null;
                HighLevelNERV = require('../../nerv/adapters/high_level_adapter');
                const nervConsts = require('../../shared/nerv/constants');
                ActionCode = nervConsts && nervConsts.ActionCode ? nervConsts.ActionCode : nervConsts;
                ActorRole = nervConsts && nervConsts.ActorRole ? nervConsts.ActorRole : {};
                if (typeof createNERV === 'function') {
                    this.nerv = await createNERV();
                    this.log('info', 'NERV initialized for proxy service');
                } else {
                    this.log('info', 'NERV createNERV not available, skipping NERV integration');
                    this.nerv = null;
                }
            } catch (err) {
                this.log('warn', 'NERV initialization failed or not available, continuing without NERV', {
                    error: err && err.message ? err.message : String(err)
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
            try {
                this.app.use(helmet());
            } catch (err) {
                void err;
            }
            try {
                const limiter = rateLimit({
                    windowMs: 60 * 1000,
                    max: 400,
                    standardHeaders: true,
                    legacyHeaders: false
                });
                this.app.use(limiter);
            } catch (err) {
                void err;
            }
            this.app.use((req, res, next) => {
                const id = req.headers['x-request-id'] || uuidv4();
                res.setHeader('X-Request-Id', id);
                this.asyncLocalStorage.run({ requestId: id }, () => next());
            });
            this.app.get('/metrics', async (req, res) => {
                try {
                    res.setHeader('Content-Type', promClient.register.contentType || 'text/plain; version=0.0.4');
                    res.end(await promClient.register.metrics());
                } catch (err) {
                    res.statusCode = 500;
                    res.end('metrics error');
                    void err;
                }
            });
            this.app.use((req, res) => this.handleHTTPRequest(req, res));
            this.server = http.createServer(this.app);
            this.server.on('upgrade', this.handleWebSocketUpgrade.bind(this));
            this.server.listen(this.config.PROXY_PORT, this.config.PROXY_BIND, () => {
                this.log('info', '✅ Chrome Proxy Service started');
                this.log('info', `   Listening: ${this.config.PROXY_BIND}:${this.config.PROXY_PORT}`);
                this.log('info', `   Forwarding to: ${this.config.CHROME_HOST}:${this.config.CHROME_PORT}`);
                this.log('info', `   Public URL: http://${this.config.PUBLIC_IP}:${this.config.PROXY_PORT}`);
                resolve();
            });
            this.server.on('error', err => {
                if (err.code === 'EADDRINUSE')
                    reject(
                        new Error(
                            `Port ${this.config.PROXY_PORT} is already in use. Stop the process or use a different port.`
                        )
                    );
                else reject(err);
            });
            process.on('SIGINT', () => this._handleShutdown('SIGINT'));
            process.on('SIGTERM', () => this._handleShutdown('SIGTERM'));
        });
    }

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
            activeConnections: this.activeConnections.size
        });
        this.activeConnections.forEach(socket => socket.destroy());
        this.activeConnections.clear();
        return new Promise(resolve => {
            if (this.server) {
                this.server.close(() => {
                    this.log('info', '✅ Proxy stopped');
                    resolve();
                });
            } else resolve();
        });
    }
}

module.exports = ChromeProxyService;
