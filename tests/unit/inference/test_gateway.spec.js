// @ts-check
import assert from 'node:assert/strict';

import { InferenceGateway } from '../../../src/inference_gateway/gateway.js';

test('InferenceGateway generate uses policy precedence and validates route', async () => {
    /** @type {any[]} */ const calls = [];
    const gateway = new InferenceGateway({
        ollamaClient: {
            async generate(/** @type {any} */ prompt, /** @type {any} */ model, /** @type {any} */ options) {
                calls.push({ op: 'generate', prompt, model, options });
                return { response: 'ok', model: model || 'default' };
            },
        },
        clientPolicies: {
            audit_agent_patch: { allowed_models: ['qwen2.5-coder:3b'], max_parallel: 1 },
        },
    });

    const result = await gateway.generate({
        clientTag: 'audit_agent_patch',
        prompt: 'fix bug',
        model: 'qwen2.5-coder:3b',
        maxTokens: 321,
        runtime: 'local',
    });

    assert.equal(result.ok, true);
    assert.equal(result.clientTag, 'audit_agent_patch');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.max_tokens, 321);
});

test('InferenceGateway rejects disallowed route by client policy', async () => {
    const gateway = new InferenceGateway({
        ollamaClient: {
            async generate() {
                return { response: 'ok' };
            },
        },
        clientPolicies: {
            audit_agent_patch: { allowed_models: ['qwen2.5-coder:3b'] },
        },
    });

    await assert.rejects(
        () => gateway.generate({ clientTag: 'audit_agent_patch', prompt: 'x', model: 'other-model' }),
        /não permitido/,
    );
});

test('InferenceGateway enforces per-client concurrency limit', async () => {
    let release;
    const blocker = new Promise((resolve) => {
        release = resolve;
    });
    const gateway = new InferenceGateway({
        ollamaClient: {
            async generate() {
                await blocker;
                return { response: 'ok' };
            },
        },
        clientPolicies: { audit_agent_triage: { max_parallel: 1 } },
    });

    const p1 = gateway.generate({ clientTag: 'audit_agent_triage', prompt: 'a' });
    await assert.rejects(() => gateway.generate({ clientTag: 'audit_agent_triage', prompt: 'b' }), /concorrência/);
    /** @type {any} */ (release)();
    await p1;
});
