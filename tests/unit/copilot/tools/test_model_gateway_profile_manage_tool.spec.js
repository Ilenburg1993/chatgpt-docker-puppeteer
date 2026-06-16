// @ts-check

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { modelGatewayProfileManageTool } from '../../../../src/copilot/tools/model-gateway/index.js';

const PROFILE_ENV_KEYS = Object.freeze([
    'COPILOT_BYOK_PROFILES_JSON',
    'COPILOT_BYOK_PROFILE',
    'COPILOT_BYOK_MODEL',
    'COPILOT_BYOK_PROVIDER_PRESET',
    'COPILOT_BYOK_BASE_URL',
    'COPILOT_MODEL_GATEWAY_BINDING_SOURCE',
    'OPENAI_API_KEY',
]);

/** @type {Record<string, string | undefined>} */
let savedEnv = {};

function validProfile() {
    return {
        providerId: 'openai',
        providerType: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4.1-mini',
        apiKeyEnv: 'OPENAI_API_KEY',
        metadata: { freeTier: true },
    };
}

/**
 * @param {Record<string, unknown>} args
 * @returns {Promise<Record<string, any>>}
 */
async function callProfileManage(args) {
    const raw = await modelGatewayProfileManageTool.handler(args);
    return JSON.parse(String(raw));
}

describe('model_gateway_profile_manage', () => {
    beforeEach(() => {
        savedEnv = Object.fromEntries(PROFILE_ENV_KEYS.map((key) => [key, process.env[key]]));
        for (const key of PROFILE_ENV_KEYS) delete process.env[key];
        process.env['OPENAI_API_KEY'] = 'sk-profile-manage-secret';
    });

    afterEach(() => {
        for (const key of PROFILE_ENV_KEYS) {
            if (savedEnv[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = savedEnv[key];
            }
        }
    });

    it('planeja upsert sem mutar o profile store e sem vazar segredo real', async () => {
        const result = await callProfileManage({
            mode: 'plan',
            operation: 'upsert',
            profileName: 'openai-test',
            profile: validProfile(),
            confirm: false,
            idempotencyKey: 'profile-test-plan-20260616',
        });

        expect(result).toMatchObject({
            ok: true,
            operation: 'profile.manage',
            status: 'planned',
            dryRun: true,
            data: {
                profileName: 'openai-test',
                operation: 'upsert',
                profile: {
                    name: 'openai-test',
                    providerId: 'openai',
                    ready: true,
                    auth: { apiKeyConfigured: true },
                    metadataKeys: ['freeTier'],
                    profileFreeTier: true,
                },
            },
            errors: [],
        });
        expect(process.env['COPILOT_BYOK_PROFILES_JSON']).toBeUndefined();
        expect(JSON.stringify(result)).not.toContain('sk-profile-manage-secret');
    });

    it('aplica upsert confirmado e remove perfil ativo limpando binding BYOK vivo', async () => {
        const upsert = await callProfileManage({
            mode: 'apply',
            operation: 'upsert',
            profileName: 'openai-test',
            profile: validProfile(),
            confirm: true,
            idempotencyKey: 'profile-test-apply-20260616',
        });
        const storedProfiles = JSON.parse(String(process.env['COPILOT_BYOK_PROFILES_JSON']));

        expect(upsert).toMatchObject({
            ok: true,
            status: 'committed',
            data: {
                profileName: 'openai-test',
                operation: 'upsert',
                profile: {
                    name: 'openai-test',
                    ready: true,
                    providerId: 'openai',
                },
            },
        });
        expect(storedProfiles['openai-test']).toMatchObject({
            providerId: 'openai',
            apiKeyEnv: 'OPENAI_API_KEY',
        });
        expect(JSON.stringify(storedProfiles)).not.toContain('sk-profile-manage-secret');

        process.env['COPILOT_BYOK_PROFILE'] = 'openai-test';
        process.env['COPILOT_BYOK_MODEL'] = 'gpt-4.1-mini';
        process.env['COPILOT_BYOK_PROVIDER_PRESET'] = 'openai';
        process.env['COPILOT_BYOK_BASE_URL'] = 'https://api.openai.com/v1';

        const removed = await callProfileManage({
            mode: 'apply',
            operation: 'remove',
            profileName: 'openai-test',
            profile: null,
            confirm: true,
            idempotencyKey: 'profile-test-remove-20260616',
        });

        expect(removed).toMatchObject({
            ok: true,
            status: 'committed',
            data: {
                profileName: 'openai-test',
                operation: 'remove',
                profile: null,
                activeProfile: null,
            },
            warnings: ['profile_removed_from_live_process_env'],
        });
        expect(process.env['COPILOT_BYOK_PROFILE']).toBeUndefined();
        expect(process.env['COPILOT_BYOK_MODEL']).toBeUndefined();
        expect(process.env['COPILOT_BYOK_PROVIDER_PRESET']).toBeUndefined();
        expect(process.env['COPILOT_BYOK_BASE_URL']).toBeUndefined();
    });

    it('aceita profile como JSON string parseável para tolerar tool-call serializado', async () => {
        const upsert = await callProfileManage({
            mode: 'apply',
            operation: 'upsert',
            profileName: 'openai-string-profile',
            profile: JSON.stringify(validProfile()),
            confirm: true,
            idempotencyKey: 'profile-test-string-apply-20260616',
        });
        const storedProfiles = JSON.parse(String(process.env['COPILOT_BYOK_PROFILES_JSON']));

        expect(upsert).toMatchObject({
            ok: true,
            status: 'committed',
            data: {
                profileName: 'openai-string-profile',
                operation: 'upsert',
                profile: {
                    name: 'openai-string-profile',
                    ready: true,
                    providerId: 'openai',
                },
            },
        });
        expect(storedProfiles['openai-string-profile']).toMatchObject({
            providerId: 'openai',
            apiKeyEnv: 'OPENAI_API_KEY',
        });
        expect(JSON.stringify(upsert)).not.toContain('sk-profile-manage-secret');
    });

    it('bloqueia apply sem confirmação e segredo inline sem mutar env', async () => {
        const confirmation = await callProfileManage({
            mode: 'apply',
            operation: 'upsert',
            profileName: 'openai-test',
            profile: validProfile(),
            confirm: false,
            idempotencyKey: 'profile-test-confirm-20260616',
        });
        const inlineSecret = await callProfileManage({
            mode: 'plan',
            operation: 'upsert',
            profileName: 'openai-test',
            profile: { ...validProfile(), apiKey: 'sk-inline-secret' },
            confirm: false,
            idempotencyKey: 'profile-test-inline-20260616',
        });

        expect(confirmation).toMatchObject({
            ok: false,
            status: 'confirmation_required',
            errors: [
                {
                    code: 'PROFILE_MANAGE_CONFIRMATION_REQUIRED',
                    retryable: true,
                },
            ],
        });
        expect(inlineSecret).toMatchObject({
            ok: false,
            status: 'invalid_profile',
            errors: [
                {
                    code: 'PROFILE_MANAGE_INVALID_PROFILE',
                    retryable: true,
                },
            ],
        });
        expect(process.env['COPILOT_BYOK_PROFILES_JSON']).toBeUndefined();
        expect(JSON.stringify(inlineSecret)).not.toContain('sk-inline-secret');
    });
});
