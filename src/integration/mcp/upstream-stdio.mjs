// @ts-check
/**
 * MCP Upstream Stdio Handler
 *
 * Spawns an MCP server as child process (stdio transport) and proxies tools to our unified Tool Registry with namespace
 * prefix.
 *
 * Use case: Import tools from GitHub MCP Server without HTTP overhead
 *
 * Example: const upstream = new MCPUpstreamStdio( 'npx', ['-y', '@modelcontextprotocol/server-github'], {
 * GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_xxx' } ); await upstream.start(); const tools = await upstream.listTools(); const
 * result = await upstream.callTool('create_issue', { ... });
 *
 * @status IN_PROGRESS (70% complete)
 * @todo Implement robust JSON-RPC message parsing
 *
 * @todo Add reconnection logic on process crash
 *
 * @todo Implement graceful shutdown
 */

import { spawn } from 'child_process';
import { EventEmitter } from 'events';

/** Classe exportada: MCPUpstreamStdio. */
export class MCPUpstreamStdio extends EventEmitter {
    /**
     * Create MCP Upstream Stdio handler
     *
     * @param {string} command - Command to spawn (e.g., 'npx', 'node')
     * @param {string[]} args - Command arguments
     * @param {object} env - Environment variables (merged with process.env)
     */
    constructor(command, args, env = {}) {
        super();

        this.command = command;
        this.args = args;
        this.env = { ...process.env, ...env };

        /** @type {any} */ this.process = null;
        this.requestId = 1;
        this.pendingRequests = new Map();

        this.buffer = ''; // Buffer for incomplete JSON-RPC messages
        this.initialized = false;
    }

    /**
     * Start the upstream MCP server process
     *
     * Steps:
     *
     * 1. Spawn child process with stdio pipes
     * 2. Setup message parsers for stdout/stderr
     * 3. Send initialize handshake
     * 4. Wait for capabilities response
     *
     * @returns {Promise<void>}
     * @throws {Error} If process fails to start or initialize times out
     */
    async start() {
        console.error(`[MCP Upstream] Starting: ${this.command} ${this.args.join(' ')}`);

        // Spawn process
        this.process = spawn(this.command, this.args, {
            env: this.env,
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        // Handle stdout (JSON-RPC responses)
        /** @type {any} */ (this.process).stdout.on('data', (/** @type {any} */ data) => {
            this._handleStdout(data);
        });

        // Handle stderr (logs from upstream server)
        /** @type {any} */ (this.process).stderr.on('data', (/** @type {any} */ data) => {
            const msg = data.toString().trim();
            if (msg) {
                console.error(`[MCP Upstream] stderr: ${msg}`);
            }
        });

        // Handle process exit
        /** @type {any} */ (this.process).on('exit', (/** @type {any} */ code, /** @type {any} */ signal) => {
            console.error(`[MCP Upstream] Process exited: code=${code} signal=${signal}`);
            this.initialized = false;
            this.emit('exit', { code, signal });
        });

        // Handle process errors
        this.process.on('error', (/** @type {any} */ error) => {
            console.error(`[MCP Upstream] Process error:`, error);
            this.emit('error', error);
        });

        // Wait for process to be ready (heuristic wait)
        // eslint-disable-next-line @typescript-eslint/no-implied-eval -- resolve is a function, not a string; no-implied-eval is a false positive here
        await new Promise((/** @type {any} */ resolve) => setTimeout(resolve, 1000));

        // Send initialize handshake
        try {
            const initResult = await this._sendRequest('initialize', {
                protocolVersion: '2024-11-05',
                capabilities: {
                    tools: {},
                },
                clientInfo: {
                    name: 'chatgpt-docker-upstream',
                    version: '1.0.0',
                },
            });

            console.error('[MCP Upstream] Initialize response:', JSON.stringify(initResult, null, 2));

            // Send notifications/initialized (no response expected)
            this._sendNotification('notifications/initialized', {});

            this.initialized = true;
            console.error('[MCP Upstream] Ready');
        } catch (/** @type {any} */ _raw_error) {
            const error = /** @type {any} */ (_raw_error);
            void this.stop();
            throw new Error(`Failed to initialize upstream: ${error.message}`); // eslint-disable-line preserve-caught-error
        }
    }

    /**
     * Handle stdout data (JSON-RPC messages)
     *
     * MCP stdio transport sends one JSON-RPC message per line. We buffer incomplete lines and parse complete ones.
     *
     * @private
     * @param {Buffer} data - Raw stdout data
     */
    _handleStdout(data) {
        this.buffer += data.toString();

        // Split by newlines (each line is one JSON-RPC message)
        const lines = this.buffer.split('\n');

        // Keep last (incomplete) line in buffer
        this.buffer = lines.pop() || '';

        // Parse complete lines
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            try {
                const msg = JSON.parse(trimmed);
                this._handleMessage(msg);
            } catch (/** @type {any} */ _raw_error) {
                const error = /** @type {any} */ (_raw_error);
                console.error('[MCP Upstream] JSON parse error:', error.message);
                console.error('[MCP Upstream] Invalid line:', trimmed.slice(0, 200));
            }
        }
    }

    /**
     * Handle parsed JSON-RPC message
     *
     * @private
     * @param {object} msg - Parsed JSON-RPC message
     * @param {string} msg.jsonrpc - JSON-RPC version (should be "2.0")
     * @param {number | string} msg.id - Request ID (undefined for notifications)
     * @param {object} msg.result - Result (for responses)
     * @param {object} msg.error - Error (for error responses)
     * @param {string} [msg.method] - Notification method
     * @param {object} [msg.params] - Notification params
     */
    _handleMessage(msg) {
        const { id, result, error, method } = msg;

        // Notification from server (no id)
        if (id === undefined || id === null) {
            console.error(`[MCP Upstream] Notification: ${method}`);
            this.emit('notification', { method, params: msg.params });
            return;
        }

        // Response to our request
        const pending = this.pendingRequests.get(id);
        if (!pending) {
            console.error(`[MCP Upstream] Received response for unknown request ID: ${id}`);
            return;
        }

        this.pendingRequests.delete(id);

        if (error) {
            pending.reject(new Error(/** @type {any} */ (error).message || JSON.stringify(error)));
        } else {
            pending.resolve(result);
        }
    }

    /**
     * Send JSON-RPC request and wait for response
     *
     * @private
     * @param {string} method - JSON-RPC method name
     * @param {object} params - Method parameters
     * @param {number} timeout - Timeout in milliseconds (default: 30s)
     * @returns {Promise<void>} Response result
     */
    _sendRequest(method, params = {}, timeout = 30000) {
        const id = this.requestId++;
        const request = {
            jsonrpc: '2.0',
            id,
            method,
            params,
        };

        return new Promise((resolve, reject) => {
            // Store pending request
            this.pendingRequests.set(id, { resolve, reject });

            // Send to stdin (one line per message)
            const line = JSON.stringify(request) + '\n';
            /** @type {any} */ (this.process).stdin.write(line);

            // Timeout handling
            const timeoutId = setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    reject(new Error(`Request ${method} timed out after ${timeout}ms`));
                }
            }, timeout);

            // Clear timeout when resolved/rejected
            const originalResolve = resolve;
            const originalReject = reject;

            this.pendingRequests.set(id, {
                resolve: (/** @type {any} */ result) => {
                    clearTimeout(timeoutId);
                    originalResolve(result);
                },
                reject: (/** @type {any} */ error) => {
                    clearTimeout(timeoutId);
                    originalReject(error);
                },
            });
        });
    }

    /**
     * Send JSON-RPC notification (no response expected)
     *
     * @private
     * @param {string} method - JSON-RPC method name
     * @param {object} params - Method parameters
     */
    _sendNotification(method, params = {}) {
        const notification = {
            jsonrpc: '2.0',
            method,
            params,
        };

        const line = JSON.stringify(notification) + '\n';
        /** @type {any} */ (this.process).stdin.write(line);
    }

    /**
     * List all available tools from upstream server
     *
     * @returns {Promise<{ tools: any[] }>} Tools list
     * @throws {Error} If not initialized or request fails
     */
    async listTools() {
        if (!this.initialized) {
            throw new Error('MCP Upstream not initialized');
        }

        return /** @type {any} */ (this._sendRequest('tools/list'));
    }

    /**
     * Call a tool on the upstream server
     *
     * @param {string} name - Tool name
     * @param {object} args - Tool arguments
     * @returns {Promise<void>} Tool result
     * @throws {Error} If not initialized or tool call fails
     */
    async callTool(name, args = {}) {
        if (!this.initialized) {
            throw new Error('MCP Upstream not initialized');
        }

        return this._sendRequest('tools/call', {
            name,
            arguments: args,
        });
    }

    /**
     * Stop the upstream server process
     *
     * @returns {Promise<void>}
     */
    async stop() {
        if (!this.process) {
            console.error('[MCP Upstream] Already stopped');
            return;
        }

        console.error('[MCP Upstream] Stopping process...');

        // Graceful shutdown: close stdin
        try {
            /** @type {any} */ (this.process).stdin.end();
        } catch (/** @type {any} */ _raw_error) {
            const error = /** @type {any} */ (_raw_error);
            console.error('[MCP Upstream] Error closing stdin:', error.message);
        }

        // Wait for process to exit (max 5s)
        const exitPromise = new Promise((/** @type {any} */ resolve) => {
            this.process.once('exit', resolve);
        });

        let killTimeoutId;
        const timeoutPromise = new Promise((/** @type {any} */ resolve) => {
            killTimeoutId = setTimeout(() => {
                console.error('[MCP Upstream] Process did not exit gracefully, killing...');
                /** @type {any} */ (this.process).kill('SIGTERM');
                resolve();
            }, 5000);
        });

        await Promise.race([exitPromise, timeoutPromise]);
        clearTimeout(killTimeoutId);

        // Force kill if still alive
        if (!this.process.killed) {
            console.error('[MCP Upstream] Force killing process...');
            /** @type {any} */ (this.process).kill('SIGKILL');
        }

        /** @type {any} */ this.process = null;
        this.initialized = false;
        this.pendingRequests.clear();

        console.error('[MCP Upstream] Stopped');
    }
}

// TODO: Implement in tool-registry.mjs:
//
// async function importUpstreamTools(/** @type {any} */ registry) {
//     if (process.env['MCP_UPSTREAM_ENABLED'] !== 'true') return;
//
//     const alias = process.env['MCP_UPSTREAM_ALIAS'] || 'upstream';
//     const prefix = process.env['MCP_UPSTREAM_TOOL_PREFIX'] || `mcp_${alias}__`;
//     const githubToken = process.env['GITHUB_PERSONAL_ACCESS_TOKEN'];
//
//     if (!githubToken) {
//         console.error('[Tool Registry] GITHUB_PERSONAL_ACCESS_TOKEN not set');
//         return;
//     }
//
//     const upstream = new MCPUpstreamStdio(
//         'npx',
//         ['-y', '@modelcontextprotocol/server-github'],
//         { GITHUB_PERSONAL_ACCESS_TOKEN: githubToken }
//     );
//
//     await upstream.start();
//
//     const result = await upstream.listTools();
//     const tools = result.tools || [];
//
//     for (const tool of tools) {
//         const localName = prefix + tool.name;
//
//         registry.register(
//             localName,
//             {
//                 description: `[GitHub] ${tool.description}`,
//                 inputSchema: tool.inputSchema
//             },
//             async (params) => {
//                 return upstream.callTool(tool.name, params);
//             }
//         );
//     }
//
//     global._mcpUpstream = upstream; // Keep alive
// }
