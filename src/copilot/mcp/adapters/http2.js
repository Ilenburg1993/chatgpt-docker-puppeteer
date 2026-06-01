// @ts-check
/**
 * Experimental HTTPS + HTTP/2 Streamable HTTP adapter for the Copilot MCP endpoint.
 *
 * This adapter is opt-in and uses Node's HTTP/2 compatibility API with allowHTTP1 enabled by default. It keeps the same
 * shared MCP/OAuth route handler as the HTTP/1.1 adapter and does not pre-read request bodies.
 *
 * @module copilot/mcp/adapters/http2
 */

import { createPrivateKey, createPublicKey, X509Certificate } from 'node:crypto';
import { createSecureServer } from 'node:http2';
import { readFile } from 'node:fs/promises';
import {
    MCP_PATH,
    configureHttp2ServerTiming,
    createMcpHttpRequestHandler,
    notifyMcpHttpStarted,
    readMcpHttpSessionRuntimeState,
} from './http-shared.js';
import { createMcpHttpProtocolState, recordMcpHttpProtocolRequest } from './http-protocol.js';
import { logMcp } from '#copilot/mcp/control-plane';

const DEFAULT_HTTP2_CERT_FILE = 'src/copilot/.ai/cloudflare/origin-cert.pem';
const DEFAULT_HTTP2_KEY_FILE = 'src/copilot/.ai/cloudflare/origin-key.pem';
const DEFAULT_HTTP2_MAX_CONCURRENT_STREAMS = 50;

/**
 * @typedef {object} McpHttp2ServerPolicy
 * @property {string} certFile
 * @property {string} keyFile
 * @property {boolean} allowHTTP1
 * @property {number} maxConcurrentStreams
 */

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {McpHttp2ServerPolicy}
 */
export function readMcpHttp2ServerPolicy(env = process.env) {
    return {
        certFile: normalizeRequiredPath(env['COPILOT_MCP_HTTP2_CERT_FILE'], DEFAULT_HTTP2_CERT_FILE),
        keyFile: normalizeRequiredPath(env['COPILOT_MCP_HTTP2_KEY_FILE'], DEFAULT_HTTP2_KEY_FILE),
        allowHTTP1: normalizeBooleanEnv(env['COPILOT_MCP_HTTP2_ALLOW_HTTP1'], true),
        maxConcurrentStreams: readPositiveIntegerEnv(
            env,
            'COPILOT_MCP_HTTP2_MAX_CONCURRENT_STREAMS',
            DEFAULT_HTTP2_MAX_CONCURRENT_STREAMS,
            1,
            1000,
        ),
    };
}

/**
 * @param {{ host?: string; port?: number }} [opts]
 * @returns {Promise<import('node:http2').Http2SecureServer>}
 */
export async function startHttp2McpServer(opts = {}) {
    const host = opts.host ?? process.env['COPILOT_MCP_HOST'] ?? '127.0.0.1';
    const port = opts.port ?? Number(process.env['COPILOT_MCP_PORT'] ?? 3333);
    const policy = readMcpHttp2ServerPolicy();
    const [cert, key] = await Promise.all([
        readFile(policy.certFile, 'utf8'),
        readFile(policy.keyFile, 'utf8'),
    ]).catch((error) => {
        throw new Error(
            `Cannot start MCP HTTP/2 server without TLS material. Set COPILOT_MCP_HTTP2_CERT_FILE and COPILOT_MCP_HTTP2_KEY_FILE or create ${DEFAULT_HTTP2_CERT_FILE} and ${DEFAULT_HTTP2_KEY_FILE}. Cause: ${error instanceof Error ? error.message : String(error)}`,
        );
    });
    validateTlsMaterial(cert, key, policy);

    const protocolState = createMcpHttpProtocolState(policy.allowHTTP1 ? 'h2-compat' : 'h2');
    const requestHandler = createMcpHttpRequestHandler({ host, port, protocolState, publicScheme: 'https' });
    const http2Server = createSecureServer(
        {
            allowHTTP1: policy.allowHTTP1,
            cert,
            key,
            settings: {
                enablePush: false,
                maxConcurrentStreams: policy.maxConcurrentStreams,
            },
        },
        async (req, res) => {
            recordMcpHttpProtocolRequest(protocolState, req);
            await requestHandler(req, res);
        },
    );

    const timingPolicy = configureHttp2ServerTiming(http2Server);
    await listenHttp2Server(http2Server, host, port);
    logMcp('INFO', 'MCP HTTP/2 server listening.', {
        url: `https://${host}:${port}${MCP_PATH}`,
        timingPolicy,
        sessionRuntime: readMcpHttpSessionRuntimeState(),
        http2: policy,
    });
    notifyMcpHttpStarted();
    return http2Server;
}

/**
 * @param {import('node:http2').Http2SecureServer} server
 * @param {string} host
 * @param {number} port
 * @returns {Promise<void>}
 */
function listenHttp2Server(server, host, port) {
    return new Promise((resolve, reject) => {
        /** @param {Error} error */
        const onError = (error) => {
            server.off('listening', onListening);
            reject(
                new Error(
                    `Cannot start MCP HTTP/2 server on ${host}:${port}. Is another MCP HTTP server already running? Cause: ${error instanceof Error ? error.message : String(error)}`,
                ),
            );
        };
        const onListening = () => {
            server.off('error', onError);
            resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, host);
    });
}

/**
 * @param {string} cert
 * @param {string} key
 * @param {McpHttp2ServerPolicy} policy
 * @returns {void}
 */
function validateTlsMaterial(cert, key, policy) {
    validatePemBlock(cert, 'CERTIFICATE', policy.certFile);
    validatePemBlock(key, 'PRIVATE KEY', policy.keyFile);
    try {
        const certificate = new X509Certificate(cert);
        const privateKey = createPrivateKey(key);
        const certPublicKey = certificate.publicKey.export({ format: 'der', type: 'spki' });
        const privatePublicKey = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
        if (!Buffer.from(certPublicKey).equals(Buffer.from(privatePublicKey))) {
            throw new Error('certificate public key differs from private key public key');
        }
    } catch (error) {
        throw new Error(
            `Invalid MCP HTTP/2 TLS material. Check ${policy.certFile} and ${policy.keyFile}; certificate and key must be PEM and must match. Cause: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
        );
    }
}

/**
 * @param {string} pem
 * @param {'CERTIFICATE' | 'PRIVATE KEY'} blockName
 * @param {string} file
 * @returns {void}
 */
function validatePemBlock(pem, blockName, file) {
    const text = String(pem).trimStart();
    if (!text.startsWith(`-----BEGIN ${blockName}-----`)) {
        throw new Error(`Invalid MCP HTTP/2 TLS file ${file}: expected PEM block -----BEGIN ${blockName}-----.`);
    }
    if (!text.includes(`-----END ${blockName}-----`)) {
        throw new Error(`Invalid MCP HTTP/2 TLS file ${file}: missing -----END ${blockName}-----.`);
    }
}

/**
 * @param {string | undefined} value
 * @param {string} fallback
 * @returns {string}
 */
function normalizeRequiredPath(value, fallback) {
    const path = String(value ?? fallback).trim();
    if (!path) return fallback;
    if (path.includes('\0')) throw new Error('MCP HTTP/2 TLS file path must not contain null bytes.');
    return path;
}

/**
 * @param {string | undefined} value
 * @param {boolean} fallback
 * @returns {boolean}
 */
function normalizeBooleanEnv(value, fallback) {
    const raw = String(value ?? '').trim().toLowerCase();
    if (!raw) return fallback;
    if (raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on') return true;
    if (raw === 'false' || raw === '0' || raw === 'no' || raw === 'off') return false;
    return fallback;
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string} name
 * @param {number} fallback
 * @param {number} minimum
 * @param {number} maximum
 * @returns {number}
 */
function readPositiveIntegerEnv(env, name, fallback, minimum, maximum) {
    const parsed = Number(env[name] ?? fallback);
    return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? Math.floor(parsed) : fallback;
}
