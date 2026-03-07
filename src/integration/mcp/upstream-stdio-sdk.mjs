// @ts-check
/**
 * MCP upstream client over stdio using the official MCP SDK.
 *
 * This spawns an MCP server process (e.g. GitHub MCP) and talks JSON-RPC over stdio.
 * It is intended to be used by the upstream manager to import tools and proxy calls.
 */

import { Client } from '@modelcontextprotocol/sdk/client';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

function withTimeout(/** @type {any} */ promise, /** @type {any} */ timeoutMs, /** @type {any} */ label) {
    const ms = Number(timeoutMs);
    if (!Number.isFinite(ms) || ms <= 0) return promise;

    /** @type {NodeJS.Timeout} */
    let t;
    const timeoutPromise = new Promise((_, reject) => {
        t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(t));
}

/** Classe exportada: MCPStdioUpstreamClient. */
export class MCPStdioUpstreamClient {
    /**
     * @param {{ alias: string, command: string, args: string[], env?: Record<string,string>, initTimeoutMs?: number, callTimeoutMs?: number }} opts
     */
    constructor(opts) {
        this.alias = opts.alias;
        this.command = opts.command;
        this.args = Array.isArray(opts.args) ? opts.args : [];
        this.env = opts.env || undefined;
        this.initTimeoutMs = Number(opts.initTimeoutMs || 30000);
        this.callTimeoutMs = Number(opts.callTimeoutMs || 90000);

        /** @type {Client | null} */
        this.client = null;
        /** @type {StdioClientTransport | null} */
        this.transport = null;
        this.connected = false;
    }

    async connect() {
        if (this.connected && this.client && this.transport) return;

        const transport = new StdioClientTransport({
            command: this.command,
            args: this.args,
            env: this.env,
            stderr: 'pipe',
        });

        const client = new Client(
            { name: 'chatgpt-docker-upstream', version: '1.0.0' },
            /** @type {any} */ ({ capabilities: { tools: {} } })
        );

        try {
            await withTimeout(client.connect(transport), this.initTimeoutMs, `[MCP stdio:${this.alias}] connect`);
            this.client = client;
            this.transport = transport;
            this.connected = true;
        } catch (/** @type {any} */ _raw_err) { const err = /** @type {any} */ (_raw_err);
            try {
                await client.close();
            } catch (/** @type {any} */ _raw_e) { const e = /** @type {any} */ (_raw_e);
                // ignore
            }
            try {
                await transport.close();
            } catch (/** @type {any} */ _raw_e) { const e = /** @type {any} */ (_raw_e);
                // ignore
            }
            throw err;
        }
    }

    async listTools() {
        if (!this.connected) await this.connect();
        return (/** @type {any} */ (this.client)).listTools();
    }

    /**
     * @param {{ name?: string, arguments?: Record<string, unknown>, signal?: AbortSignal }} [payload]
     */
    async callTool({ name, arguments: args = {}, signal } = {}) {
        if (!name) {
            throw new Error(`[MCP stdio:${this.alias}] tools/call requires name`);
        }
        if (signal?.aborted) {
            throw new Error(`[MCP stdio:${this.alias}] call aborted before start`);
        }
        if (!this.connected) await this.connect();

        // NOTE: MCP SDK does not currently accept AbortSignal for stdio calls.
        // We enforce an upper bound via timeout, and if it fires, we tear down the connection.
        try {
            return await withTimeout(
                (/** @type {any} */ (this.client)).callTool({ name, arguments: args }),
                this.callTimeoutMs,
                `[MCP stdio:${this.alias}] tools/call(${name})`
            );
        } catch (/** @type {any} */ _raw_err) { const err = /** @type {any} */ (_raw_err);
            // If call timed out or any transport error occurred, mark connection dead.
            await this.close().catch(() => {});
            throw err;
        }
    }

    async close() {
        const transport = this.transport;
        const client = this.client;
        this.transport = null;
        this.client = null;
        this.connected = false;

        try {
            if (client) await client.close();
        } finally {
            if (transport) await transport.close();
        }
    }
}
