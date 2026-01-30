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
        this.activeConnections = new Set();
        this.stats = {
            httpRequests: 0,
            wsUpgrades: 0,
            errors: 0,
            startTime: Date.now()
        };

        // Auto-detect public IP if not provided
        if (!this.config.PUBLIC_IP) {
            this.config.PUBLIC_IP = this._detectPublicIP();
        }
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
        const levels = { debug: 0, info: 1, warn: 2, error: 3 };
        const currentLevel = levels[this.config.LOG_LEVEL] || 1;

        if (levels[level] >= currentLevel) {
            const timestamp = new Date().toISOString();
            const metaStr = Object.keys(meta).length > 0 ? JSON.stringify(meta) : '';
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

            // Rewrite single webSocketDebuggerUrl (for /json/version)
            if (json.webSocketDebuggerUrl) {
                const original = json.webSocketDebuggerUrl;
                json.webSocketDebuggerUrl = this._rewriteURL(original);

                this.log('debug', 'URL rewritten', {
                    original,
                    rewritten: json.webSocketDebuggerUrl
                });
            }

            // Rewrite array of targets/pages (for /json and /json/list)
            if (Array.isArray(json)) {
                json.forEach(item => {
                    if (item.webSocketDebuggerUrl) {
                        item.webSocketDebuggerUrl = this._rewriteURL(item.webSocketDebuggerUrl);
                    }
                    if (item.devtoolsFrontendUrl) {
                        item.devtoolsFrontendUrl = this._rewriteURL(item.devtoolsFrontendUrl);
                    }
                });
            }

            return JSON.stringify(json);
        } catch (e) {
            this.log('error', 'JSON parse/rewrite failed', { error: e.message });
            return data;
        }
    }

    /**
     * Helper: Rewrite a single URL
     */
    _rewriteURL(url) {
        return url
            .replace(
                `${this.config.CHROME_HOST}:${this.config.CHROME_PORT}`,
                `${this.config.PUBLIC_IP}:${this.config.PROXY_PORT}`
            )
            .replace(`localhost:${this.config.CHROME_PORT}`, `${this.config.PUBLIC_IP}:${this.config.PROXY_PORT}`);
    }

    /**
     * Handle HTTP requests (with URL rewriting for /json endpoints)
     */
    handleHTTPRequest(req, res) {
        this.stats.httpRequests++;

        const clientIP = req.socket.remoteAddress;
        this.log('info', `HTTP ${req.method} ${req.url}`, { from: clientIP });

        // Determine if this endpoint needs URL rewriting
        const needsRewrite = req.url.startsWith('/json');

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
            });
        });

        proxyReq.on('error', err => {
            this.stats.errors++;
            this.log('error', 'Chrome unreachable', { error: err.message });

            res.writeHead(502, { 'Content-Type': 'text/plain' });
            res.end(
                `Chrome unreachable: ${err.message}\n\nPlease ensure Chrome is running with --remote-debugging-port=${this.config.CHROME_PORT}`
            );
        });

        // Forward request body
        req.pipe(proxyReq);
    }

    /**
     * Handle WebSocket upgrade (transparent proxy)
     */
    handleWebSocketUpgrade(req, socket, head) {
        this.stats.wsUpgrades++;

        const clientIP = socket.remoteAddress;
        this.log('info', `WebSocket upgrade: ${req.url}`, { from: clientIP });

        // Connect to Chrome
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

        // Cleanup on close
        socket.on('close', () => {
            this.log('debug', 'WebSocket closed');
            this.activeConnections.delete(socket);
            proxySocket.destroy();
        });

        // Error handling
        proxySocket.on('error', err => {
            this.stats.errors++;
            this.log('error', 'Proxy socket error', { error: err.message });
            socket.destroy();
        });

        socket.on('error', err => {
            this.stats.errors++;
            this.log('error', 'Client socket error', { error: err.message });
            proxySocket.destroy();
        });
    }

    /**
     * Start the proxy server
     */
    async start() {
        return new Promise((resolve, reject) => {
            // Create HTTP server
            this.server = http.createServer(this.handleHTTPRequest.bind(this));

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
    const publicIP = process.argv[2];
    const logLevel = process.argv[3];

    const proxy = new ChromeProxyService({
        PUBLIC_IP: publicIP,
        LOG_LEVEL: logLevel
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
