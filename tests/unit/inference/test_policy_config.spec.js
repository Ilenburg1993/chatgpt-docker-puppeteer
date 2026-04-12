// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveInferencePolicy, validateInferenceRoute } from '../../../src/inference_gateway/policy_config.js';

test('resolveInferencePolicy respects precedence from defaults to overrides', () => {
    const resolved = resolveInferencePolicy({
        clientTag: 'audit_agent_patch',
        defaults: { timeoutMs: 1000, maxParallel: 1, degradedBehavior: 'degraded_continue' },
        envPolicy: { timeoutMs: 2000 },
        globalPolicy: { maxParallel: 2 },
        profilePolicy: { allowedModels: ['model-a'], maxTokens: 1200 },
        clientPolicy: { timeoutMs: 4000, allowedBackends: ['ollama_local'] },
        overrides: { timeoutMs: 5000, maxParallel: 3 },
    });

    assert.equal(resolved.clientTag, 'audit_agent_patch');
    assert.equal(resolved.effective.timeoutMs, 5000);
    assert.equal(resolved.effective.maxParallel, 3);
    assert.deepEqual(resolved.effective.allowedModels, ['model-a']);
    assert.deepEqual(resolved.effective.allowedBackends, ['ollama_local']);
    assert.equal(resolved.effective.maxTokens, 1200);
    assert.deepEqual(resolved.sourcesApplied, ['defaults', 'env', 'global', 'profile', 'client', 'overrides']);
});

test('validateInferenceRoute enforces model/backend allowlists', () => {
    const effective = {
        allowedModels: ['qwen2.5-coder:3b'],
        allowedBackends: ['ollama_local'],
    };

    assert.deepEqual(validateInferenceRoute(effective, { model: 'qwen2.5-coder:3b', backend: 'ollama_local' }), {
        ok: true,
    });
    assert.equal(validateInferenceRoute(effective, { model: 'other-model', backend: 'ollama_local' }).ok, false);
    assert.equal(validateInferenceRoute(effective, { model: 'qwen2.5-coder:3b', backend: 'ollama_cloud' }).ok, false);
});
