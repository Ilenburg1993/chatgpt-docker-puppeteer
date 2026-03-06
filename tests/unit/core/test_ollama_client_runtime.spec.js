// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';

import { OllamaClient } from '../../../tools/ollama/client.mjs';

/**
 * @param {number} status
 * @param {any} data
 * @returns {any}
 */
function mockJsonResponse(status, data) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async json() {
            return data;
        },
        async text() {
            return JSON.stringify(data);
        },
    };
}

test('resolveRuntime forces local for embedding operation', () => {
    const client = new OllamaClient({
        cloudEnabled: true,
        nonEmbeddingRuntime: 'auto',
        fetch: async () => mockJsonResponse(200, { models: [] }),
    });

    const resolved = client.resolveRuntime({ operation: 'embedding', runtimePreference: 'cloud' });
    assert.equal(resolved.runtime, 'local');
    assert.equal(resolved.reason, 'embedding_local_only');
});

test('generateWithMetadata uses cloud first in auto mode', async () => {
    /** @type {any[]} */ const calls = [];
    const client = new OllamaClient({
        cloudEnabled: true,
        cloudBaseUrl: 'https://cloud.example',
        localBaseUrl: 'http://local.example',
        nonEmbeddingRuntime: 'auto',
        nonEmbeddingLocalFallback: true,
        fetch: async url => {
            calls.push(String(url));
            return mockJsonResponse(200, { response: 'cloud-ok' });
        },
    });

    const result = await client.generateWithMetadata('hello', 'qwen3-coder-next', { runtime: 'auto' });

    assert.equal(result.runtime, 'cloud');
    assert.equal(result.fallbackUsed, false);
    assert.deepEqual(result.attempts, ['cloud']);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].startsWith('https://cloud.example/api/generate'));
});

test('generateWithMetadata falls back to local when cloud fails and fallback is enabled', async () => {
    /** @type {any[]} */ const calls = [];
    const client = new OllamaClient({
        cloudEnabled: true,
        cloudBaseUrl: 'https://cloud.example',
        localBaseUrl: 'http://local.example',
        nonEmbeddingRuntime: 'auto',
        nonEmbeddingLocalFallback: true,
        fetch: async url => {
            const target = String(url);
            calls.push(target);

            if (target.startsWith('https://cloud.example')) {
                return mockJsonResponse(503, { error: 'cloud-down' });
            }

            return mockJsonResponse(200, { response: 'local-fallback-ok' });
        },
    });

    const result = await client.generateWithMetadata('hello', 'qwen2.5-coder:3b', { runtime: 'auto' });

    assert.equal(result.runtime, 'local');
    assert.equal(result.primaryRuntime, 'cloud');
    assert.equal(result.fallbackUsed, true);
    assert.deepEqual(result.attempts, ['cloud', 'local']);
    assert.equal(calls.length, 2);
});

test('generateWithMetadata returns explicit error when fallback is disabled', async () => {
    const client = new OllamaClient({
        cloudEnabled: true,
        cloudBaseUrl: 'https://cloud.example',
        localBaseUrl: 'http://local.example',
        nonEmbeddingRuntime: 'auto',
        nonEmbeddingLocalFallback: false,
        fetch: async () => mockJsonResponse(503, { error: 'cloud-down' }),
    });

    await assert.rejects(
        async () => client.generateWithMetadata('hello', 'qwen3-coder-next', { runtime: 'auto' }),
        /Cloud-first generation failed and local fallback is disabled/
    );
});

test('light local profile rejects heavy local model', async () => {
    let called = false;
    const client = new OllamaClient({
        cloudEnabled: false,
        nonEmbeddingRuntime: 'local',
        localModelProfile: 'light',
        fetch: async () => {
            called = true;
            return mockJsonResponse(200, { response: 'should-not-happen' });
        },
    });

    await assert.rejects(
        async () => client.generateWithMetadata('hello', 'qwen2.5-coder:7b', { runtime: 'local' }),
        /blocked by light profile/
    );

    assert.equal(called, false);
});

test('custom local allowlist permits configured model', async () => {
    const client = new OllamaClient({
        cloudEnabled: false,
        localBaseUrl: 'http://local.example',
        nonEmbeddingRuntime: 'local',
        localModelProfile: 'custom',
        localAllowedModels: ['my-local-model'],
        fetch: async url => {
            assert.ok(String(url).startsWith('http://local.example/api/generate'));
            return mockJsonResponse(200, { response: 'ok' });
        },
    });

    const result = await client.generateWithMetadata('hello', 'my-local-model', { runtime: 'local' });
    assert.equal(result.runtime, 'local');
    assert.equal(result.response, 'ok');
});

test('listModelsDetailed returns explicit cloud/local separation', async () => {
    const client = new OllamaClient({
        cloudEnabled: true,
        cloudBaseUrl: 'https://cloud.example',
        localBaseUrl: 'http://local.example',
        fetch: async url => {
            const target = String(url);
            if (target.startsWith('https://cloud.example')) {
                return mockJsonResponse(200, {
                    models: [{ name: 'qwen3-coder-next', size: 1, modified_at: '2026-01-01T00:00:00.000Z' }],
                });
            }

            return mockJsonResponse(200, {
                models: [{ name: 'nomic-embed-text', size: 1, modified_at: '2026-01-01T00:00:00.000Z' }],
            });
        },
    });

    const details = await client.listModelsDetailed();

    assert.equal(details.priority, 'cloud-first-non-embedding');
    assert.equal(details.cloud_models.length, 1);
    assert.equal(details.local_models.length, 1);
    assert.equal(details.cloud_models[0].name, 'qwen3-coder-next');
    assert.equal(details.local_models[0].name, 'nomic-embed-text');
});
