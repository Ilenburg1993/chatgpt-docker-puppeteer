// @ts-check
/**
 * Runtime-generation isolation tests for MCP OAuth composition.
 */

import { startHttpMcpServer } from '#copilot/mcp/public/adapters/http1';
import { createComposedMcpProcessHost } from '#copilot/mcp/public/composition/process-host';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'vitest';

/** @returns {Promise<number>} */
async function reservePort() {
    const probe = createNetServer();
    await new Promise((resolve, reject) => {
        probe.once('error', reject);
        probe.listen(0, '127.0.0.1', resolve);
    });
    const address = probe.address();
    assert.ok(address && typeof address === 'object');
    const port = address.port;
    await new Promise((resolve, reject) => probe.close((error) => (error ? reject(error) : resolve(undefined))));
    return port;
}

/** @param {import('node:http').Server} server */
async function closeServer(server) {
    if (!server.listening) return;
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve(undefined))));
}

/** @param {string} resource @param {string} dir */
function buildGenerationEnv(resource, dir) {
    return {
        NODE_ENV: 'test',
        COPILOT_MCP_AUTH_MODE: 'oauth',
        COPILOT_MCP_AUTH_ENFORCEMENT: 'all',
        COPILOT_MCP_PUBLIC_URL: `${resource}/mcp`,
        COPILOT_MCP_CLOUDFLARE_PUBLIC_URL: 'https://mcp.aurelin.org/mcp',
        COPILOT_MCP_DEV_OAUTH_KEY_FILE: path.join(dir, 'oauth-key.pem'),
        COPILOT_MCP_DEV_OAUTH_REFRESH_TOKEN_FILE: path.join(dir, 'refresh-tokens.json'),
        COPILOT_MCP_DEV_OAUTH_CLIENT_FILE: path.join(dir, 'clients.json'),
        COPILOT_MCP_DEV_OAUTH_RATE_LIMIT_REGISTER_PER_WINDOW: '1',
        COPILOT_MCP_AUDIT_FILE: path.join(dir, 'audit.jsonl'),
        COPILOT_MCP_ALLOWED_ORIGINS: 'https://chatgpt.com,http://127.0.0.1',
        COPILOT_MCP_JWKS_WARMUP_ENABLED: 'false',
        COPILOT_MCP_STARTUP_SMOKE_ENABLED: 'false',
    };
}

/** @param {string} url @param {string} clientName */
async function requestClientRegistration(url, clientName) {
    const response = await fetch(`${url}/oauth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client_name: clientName, redirect_uris: ['http://127.0.0.1/callback'] }),
    });
    const payload = /** @type {Record<string, unknown>} */ (await response.json());
    return { response, payload };
}

/** @param {string} url @param {string} clientName */
async function registerClient(url, clientName) {
    const { response, payload } = await requestClientRegistration(url, clientName);
    assert.equal(response.status, 201, JSON.stringify(payload));
    assert.match(String(payload['client_id'] ?? ''), /^mcp_dev_/u);
    return payload;
}

/** @param {NodeJS.ProcessEnv} env @param {string} hostId @param {number} port */
async function startGeneration(env, hostId, port) {
    const processHost = createComposedMcpProcessHost({ hostId, env, backgroundServices: false });
    const server = await startHttpMcpServer({
        host: '127.0.0.1',
        port,
        processHost,
        processConfig: processHost.processConfig,
    });
    return { processHost, server };
}

describe('MCP OAuth runtime generations', () => {
    it('isolates in-memory issuer state across concurrent hosts and reloads persisted state only into a new generation', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'mcp-auth-generations-'));
        const dirA = path.join(root, 'a');
        const dirB = path.join(root, 'b');
        const portA = await reservePort();
        const portB = await reservePort();
        const resourceA = `http://127.0.0.1:${portA}`;
        const resourceB = `http://127.0.0.1:${portB}`;
        const envA = /** @type {NodeJS.ProcessEnv} */ (buildGenerationEnv(resourceA, dirA));
        const envB = /** @type {NodeJS.ProcessEnv} */ (buildGenerationEnv(resourceB, dirB));
        let generationA = await startGeneration(envA, `auth-generation-a-${randomBytes(4).toString('hex')}`, portA);
        const generationB = await startGeneration(envB, `auth-generation-b-${randomBytes(4).toString('hex')}`, portB);

        try {
            assert.equal(generationA.processHost.authRuntime.issuerRuntime.readState().registeredClients, 0);
            assert.equal(generationB.processHost.authRuntime.issuerRuntime.readState().registeredClients, 0);

            await registerClient(resourceA, 'generation-a-client');
            assert.equal(generationA.processHost.authRuntime.issuerRuntime.readState().registeredClients, 1);
            assert.equal(generationA.processHost.authRuntime.issuerRuntime.readState().requestBudgetEntries, 1);
            assert.equal(generationB.processHost.authRuntime.issuerRuntime.readState().registeredClients, 0);
            assert.equal(generationB.processHost.authRuntime.issuerRuntime.readState().requestBudgetEntries, 0);

            const generationAThrottled = await requestClientRegistration(resourceA, 'generation-a-throttled');
            assert.equal(generationAThrottled.response.status, 429);
            assert.equal(generationAThrottled.payload['error'], 'temporarily_unavailable');
            assert.equal(generationA.processHost.authRuntime.issuerRuntime.readState().requestBudgetEntries, 1);
            assert.equal(generationB.processHost.authRuntime.issuerRuntime.readState().requestBudgetEntries, 0);

            await registerClient(resourceB, 'generation-b-client');
            assert.equal(generationA.processHost.authRuntime.issuerRuntime.readState().registeredClients, 1);
            assert.equal(generationB.processHost.authRuntime.issuerRuntime.readState().registeredClients, 1);

            await closeServer(generationA.server);
            await generationA.processHost.dispose();
            generationA = await startGeneration(
                envA,
                `auth-generation-a-restarted-${randomBytes(4).toString('hex')}`,
                portA,
            );

            assert.equal(generationA.processHost.authRuntime.issuerRuntime.readState().registeredClients, 0);
            const persisted = await generationA.processHost.authRuntime.issuerRuntime.readPersistenceStatus();
            assert.equal(persisted.clientStore.loadedFromFile, true);
            assert.equal(persisted.dynamicClientCount, 1);
            assert.equal(generationA.processHost.authRuntime.issuerRuntime.readState().registeredClients, 1);
            assert.equal(generationB.processHost.authRuntime.issuerRuntime.readState().registeredClients, 1);
        } finally {
            await closeServer(generationA.server).catch(() => undefined);
            await closeServer(generationB.server).catch(() => undefined);
            await generationA.processHost.dispose().catch(() => undefined);
            await generationB.processHost.dispose().catch(() => undefined);
            await rm(root, { recursive: true, force: true });
        }
    });
});
