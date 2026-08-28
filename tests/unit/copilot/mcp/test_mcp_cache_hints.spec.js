// @ts-check
import {
    Client,
    InMemoryResponseCacheStore,
    InMemoryTransport,
    StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { z } from 'zod';

import { MCP_PROTOCOL_MODERN_VERSION } from '#copilot/mcp/public/protocol/version';
import {
    buildMcpToolWireDescriptorSnapshot,
    createMcpToolSurfacePolicy,
    getCanonicalMcpTools,
} from '#copilot/mcp/public/registry';
import {
    buildCopilotMcpServerDescriptorManifest,
    createCopilotMcpServer,
    readCopilotMcpServerPolicy,
    readCopilotMcpServerProfile,
} from '#copilot/mcp/public/server';
import { createMcpModernHttpHandler } from '#copilot/mcp/public/transport/http/modern';

const EXPECTED_TOOLS_LIST_TTL_MS = 300_000;

/**
 * @param {'full' | 'latency'} mode
 * @param {InMemoryResponseCacheStore} cacheStore
 * @param {NodeJS.ProcessEnv} [env]
 */
async function runModernSurface(mode, cacheStore, env = {}) {
    const toolSurfacePolicy = createMcpToolSurfacePolicy({ mode });
    const profile = readCopilotMcpServerProfile(env);
    const canonicalTools = getCanonicalMcpTools({ toolSurfacePolicy });
    const wireSnapshot = buildMcpToolWireDescriptorSnapshot(canonicalTools);
    const handler = createMcpModernHttpHandler(() => createCopilotMcpServer({ toolSurfacePolicy, profile }), {
        keepAliveMs: 0,
    });
    /** @type {string[]} */
    const rpcMethods = [];
    /** @type {typeof fetch} */
    const fetchAdapter = async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        if (request.method === 'POST') {
            try {
                const payload = /** @type {{ method?: unknown }} */ (JSON.parse(await request.clone().text()));
                if (typeof payload.method === 'string') rpcMethods.push(payload.method);
            } catch {
                // The protocol assertion below is interested only in valid JSON-RPC method names.
            }
        }
        return handler.fetch(request);
    };
    const client = new Client(
        { name: `workspace-cache-hints-${mode}`, version: '1.0.0' },
        {
            responseCacheStore: cacheStore,
            cachePartition: 'test-principal',
            versionNegotiation: { mode: { pin: MCP_PROTOCOL_MODERN_VERSION } },
        },
    );
    const transport = new StreamableHTTPClientTransport(new URL('https://mcp.test/mcp'), { fetch: fetchAdapter });

    try {
        await client.connect(transport);
        const discover = client.getDiscoverResult();
        const list = await client.listTools();
        return {
            rpcMethods,
            discover,
            list,
            serverVersion: client.getServerVersion()?.version ?? '',
            manifest: buildCopilotMcpServerDescriptorManifest({ toolSurfacePolicy, profile }),
            wireSnapshot,
        };
    } finally {
        await client.close().catch(() => {});
        await handler.close();
    }
}

describe('MCP 2026 descriptor cache hints', () => {
    it('defaults to a private five-minute tools/list TTL with explicit rollback semantics', () => {
        const policy = readCopilotMcpServerPolicy({});
        const profile = readCopilotMcpServerProfile({});
        const disabledByTtl = readCopilotMcpServerProfile({ COPILOT_MCP_SERVER_TOOLS_LIST_CACHE_TTL_MS: '0' });
        const disabledByNotification = readCopilotMcpServerProfile({ COPILOT_MCP_SERVER_TOOLS_LIST_CHANGED: 'false' });

        assert.equal(policy.toolsListChanged, true);
        assert.equal(policy.toolsListCacheTtlMs, EXPECTED_TOOLS_LIST_TTL_MS);
        assert.deepEqual(profile.sdkOptions['cacheHints'], {
            'tools/list': { ttlMs: EXPECTED_TOOLS_LIST_TTL_MS, cacheScope: 'private' },
        });
        assert.equal(disabledByTtl.policy.toolsListCacheTtlMs, 0);
        assert.equal(disabledByTtl.sdkOptions['cacheHints'], undefined);
        assert.equal(disabledByNotification.policy.toolsListChanged, false);
        assert.equal(disabledByNotification.sdkOptions['cacheHints'], undefined);

        const longVersionProfile = readCopilotMcpServerProfile({
            COPILOT_MCP_SERVER_VERSION: 'v'.repeat(64),
        });
        const longVersionManifest = buildCopilotMcpServerDescriptorManifest({ profile: longVersionProfile });
        assert.equal(String(longVersionManifest['serverInfo']['version']).length, 64);
        assert.equal(String(longVersionManifest['descriptorFingerprintKind']), 'tools-list-wire-sha256-v1');
        assert.equal(String(longVersionManifest['descriptorCacheGeneration']).length, 64);
    });

    it('serves tools/list from cache within one descriptor generation and misses across fingerprint changes', async () => {
        const sharedStore = new InMemoryResponseCacheStore({ maxEntries: 32 });
        const full = await runModernSurface('full', sharedStore);
        const firstLatency = await runModernSurface('latency', sharedStore);
        const secondLatency = await runModernSurface('latency', sharedStore);
        const shorterLatency = await runModernSurface('latency', sharedStore, {
            COPILOT_MCP_SERVER_TOOLS_LIST_CACHE_TTL_MS: '60000',
        });
        const secondShorterLatency = await runModernSurface('latency', sharedStore, {
            COPILOT_MCP_SERVER_TOOLS_LIST_CACHE_TTL_MS: '60000',
        });

        assert.equal(full.discover?.ttlMs, 0);
        assert.equal(full.discover?.cacheScope, 'private');
        assert.equal(full.list.ttlMs, EXPECTED_TOOLS_LIST_TTL_MS);
        assert.equal(full.list.cacheScope, 'private');
        assert.equal(full.list.tools.length, 89);
        assert.deepEqual(full.rpcMethods, ['server/discover', 'tools/list']);

        assert.equal(firstLatency.list.tools.length, 52);
        assert.deepEqual(firstLatency.rpcMethods, ['server/discover', 'tools/list']);
        assert.notEqual(firstLatency.serverVersion, full.serverVersion);
        assert.notEqual(firstLatency.manifest['descriptorFingerprint'], full.manifest['descriptorFingerprint']);

        assert.equal(secondLatency.list.tools.length, 52);
        assert.equal(secondLatency.serverVersion, firstLatency.serverVersion);
        assert.equal(secondLatency.manifest['descriptorFingerprint'], firstLatency.manifest['descriptorFingerprint']);
        assert.deepEqual(secondLatency.rpcMethods, ['server/discover']);

        assert.equal(shorterLatency.list.ttlMs, 60_000);
        assert.equal(shorterLatency.list.tools.length, 52);
        assert.notEqual(shorterLatency.serverVersion, firstLatency.serverVersion);
        assert.equal(shorterLatency.manifest['descriptorFingerprint'], firstLatency.manifest['descriptorFingerprint']);
        assert.notEqual(
            shorterLatency.manifest['descriptorCacheGeneration'],
            firstLatency.manifest['descriptorCacheGeneration'],
        );
        assert.deepEqual(shorterLatency.rpcMethods, ['server/discover', 'tools/list']);
        assert.equal(secondShorterLatency.serverVersion, shorterLatency.serverVersion);
        assert.deepEqual(secondShorterLatency.rpcMethods, ['server/discover']);

        for (const sample of [full, firstLatency, shorterLatency]) {
            assert.deepEqual(sample.wireSnapshot.descriptors, sample.list.tools);
            assert.equal(sample.manifest['descriptorFingerprint'], sample.wireSnapshot.fingerprint);
            assert.equal(sample.manifest['descriptorFingerprintKind'], sample.wireSnapshot.fingerprintKind);
            assert.equal(String(sample.manifest['descriptorCacheGeneration']).length, 64);
            assert.ok(sample.serverVersion.includes('mcp.'));
            assert.ok(sample.serverVersion.length <= 64);
            assert.equal(sample.list.cacheScope, 'private');
        }
        assert.deepEqual(full.manifest['cacheHints'], {
            'tools/list': { ttlMs: EXPECTED_TOOLS_LIST_TTL_MS, cacheScope: 'private' },
        });
    });

    it('changes descriptor generation when a schema constraint changes without renaming a field', () => {
        const tool = getCanonicalMcpTools().find((row) => row.name === 'search');
        assert.ok(tool);

        const baseline = buildMcpToolWireDescriptorSnapshot([
            { ...tool, inputSchema: { query: z.string().min(1).max(512) } },
        ]);
        const stricter = buildMcpToolWireDescriptorSnapshot([
            { ...tool, inputSchema: { query: z.string().min(2).max(512) } },
        ]);

        assert.notEqual(baseline.fingerprint, stricter.fingerprint);
        assert.equal(
            /** @type {Record<string, any>} */ (baseline.descriptors[0])['inputSchema']['properties']['query'][
                'minLength'
            ],
            1,
        );
        assert.equal(
            /** @type {Record<string, any>} */ (stricter.descriptors[0])['inputSchema']['properties']['query'][
                'minLength'
            ],
            2,
        );
    });

    it('evicts a positive tools/list cache immediately when a modern subscription receives list_changed', async () => {
        const cacheStore = new InMemoryResponseCacheStore({ maxEntries: 32 });
        /** @type {string[]} */
        const rpcMethods = [];
        /** @type {(value: { error: Error | null; items: import('@modelcontextprotocol/client').Tool[] | null }) => void} */
        let resolveChanged = () => {};
        const changed = new Promise((resolve) => {
            resolveChanged = resolve;
        });
        const handler = createMcpModernHttpHandler(() => createCopilotMcpServer(), { keepAliveMs: 0 });
        /** @type {typeof fetch} */
        const fetchAdapter = async (input, init) => {
            const request = input instanceof Request ? input : new Request(input, init);
            if (request.method === 'POST') {
                try {
                    const payload = /** @type {{ method?: unknown }} */ (JSON.parse(await request.clone().text()));
                    if (typeof payload.method === 'string') rpcMethods.push(payload.method);
                } catch {
                    // The assertion below needs only valid JSON-RPC method names.
                }
            }
            return handler.fetch(request);
        };
        const client = new Client(
            { name: 'workspace-cache-hints-list-changed', version: '1.0.0' },
            {
                responseCacheStore: cacheStore,
                cachePartition: 'test-principal',
                versionNegotiation: { mode: { pin: MCP_PROTOCOL_MODERN_VERSION } },
                listChanged: {
                    tools: {
                        autoRefresh: false,
                        debounceMs: 0,
                        onChanged(error, items) {
                            resolveChanged({ error, items });
                        },
                    },
                },
            },
        );
        const transport = new StreamableHTTPClientTransport(new URL('https://mcp.test/mcp'), { fetch: fetchAdapter });

        try {
            await client.connect(transport);
            assert.deepEqual(client.autoOpenedSubscription?.honoredFilter, { toolsListChanged: true });
            assert.equal((await client.listTools()).tools.length, 89);
            assert.equal((await client.listTools()).tools.length, 89);
            assert.deepEqual(rpcMethods, ['server/discover', 'subscriptions/listen', 'tools/list']);

            handler.notify.toolsChanged();
            const notification = await Promise.race([
                changed,
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Timed out waiting for tools/list_changed.')), 2_000),
                ),
            ]);
            assert.deepEqual(notification, { error: null, items: null });

            assert.equal((await client.listTools()).tools.length, 89);
            assert.deepEqual(rpcMethods, ['server/discover', 'subscriptions/listen', 'tools/list', 'tools/list']);
        } finally {
            await client.close().catch(() => {});
            await handler.close();
        }
    });

    it('keeps cache hints out of the legacy wire result', async () => {
        const server = createCopilotMcpServer();
        const client = new Client({ name: 'workspace-cache-hints-legacy', version: '1.0.0' });
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

        try {
            await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
            const list = await client.listTools();

            assert.equal(client.getProtocolEra(), 'legacy');
            assert.equal(list.tools.length, 89);
            assert.equal('ttlMs' in list, false);
            assert.equal('cacheScope' in list, false);
        } finally {
            await Promise.allSettled([client.close(), server.close()]);
        }
    });
});
