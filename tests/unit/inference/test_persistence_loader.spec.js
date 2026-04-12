// @ts-check
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { InferenceGateway } from '../../../src/inference_gateway/gateway.js';
import { loadInferencePoliciesFromDb } from '../../../src/inference_gateway/persistence.js';
import { upsertInferenceClientPolicy } from '../../../src/infra/db/inference_client_policy_repo.js';
import { upsertInferenceProfile } from '../../../src/infra/db/inference_profile_repo.js';
import { closeDb, getDb } from '../../../src/infra/db/sqlite.js';

function withTempDb(/** @type {any} */ fn) {
    return async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inference-loader-'));
        const dbPath = path.join(tmpDir, 'maestro.sqlite');
        const prev = process.env.MAESTRO_DB_PATH;
        process.env.MAESTRO_DB_PATH = dbPath;
        try {
            getDb();
            await fn();
        } finally {
            closeDb();
            if (prev === undefined) delete process.env.MAESTRO_DB_PATH;
            else process.env.MAESTRO_DB_PATH = prev;
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    };
}

test(
    'loadInferencePoliciesFromDb maps profile + client policy and gateway can apply them',
    withTempDb(async () => {
        const profile = upsertInferenceProfile({
            name: 'patch_safe',
            generation_params: { max_tokens: 444 },
            budget_policy: { timeout_ms: 12345, degraded_behavior: 'fail_closed' },
            validation_policy: { allowed_models: ['qwen2.5-coder:7b'], allowed_backends: ['ollama_local'] },
        });
        upsertInferenceClientPolicy({
            client_tag: 'audit_agent_patch',
            profile_id: /** @type {any} */ (profile).id,
            max_parallel: 1,
            timeout_ms: 7777,
            allowed_models: ['qwen2.5-coder:7b'],
            allowed_backends: ['ollama_local'],
        });

        const loaded = loadInferencePoliciesFromDb();
        assert.equal(loaded.meta.profileCount, 1);
        assert.equal(loaded.meta.clientPolicyCount, 1);
        assert.ok(loaded.profilePolicies.patch_safe);
        assert.ok(loaded.clientPolicies.audit_agent_patch);
        assert.equal(loaded.clientPolicies.audit_agent_patch.profile_name, 'patch_safe');

        const gateway = new InferenceGateway({
            ollamaClient: {
                async listModels() {
                    return [];
                },
            },
        });
        gateway.setPolicies({
            profilePolicies: loaded.profilePolicies,
            clientPolicies: loaded.clientPolicies,
        });

        const resolved = gateway.resolvePolicy({ clientTag: 'audit_agent_patch' });
        assert.equal(resolved.clientTag, 'audit_agent_patch');
        assert.equal(resolved.effective.timeoutMs, 7777);
        assert.deepEqual(resolved.effective.allowedModels, ['qwen2.5-coder:7b']);
        assert.deepEqual(resolved.effective.allowedBackends, ['ollama_local']);
        assert.equal(gateway.getPolicySummary().profileCount, 1);
        assert.equal(gateway.getPolicySummary().clientPolicyCount, 1);
    }),
);
