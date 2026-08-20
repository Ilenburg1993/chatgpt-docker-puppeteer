// @ts-check

import { describe, expect, it } from 'vitest';

import {
    classifyRuntimeSdkRateLimitScope,
    describeSdkRecoveryPolicy,
    getSdkRecoveryPolicy,
} from '../../../src/copilot/presentation/sdk/recovery-policy.js';

describe('presentation/sdk-recovery-policy', () => {
    it('descreve rate_limit como bloqueio externo com ação operacional local', () => {
        const error = Object.assign(
            new Error('You have reached your weekly rate limit. Please switch to auto model.'),
            { status: 429 },
        );
        const policy = getSdkRecoveryPolicy(error, 'session');
        const message = describeSdkRecoveryPolicy(policy, error);

        expect(policy).toMatchObject({
            kind: 'rate_limit',
            allowReconnect: false,
            resetCircuit: true,
        });
        expect(message).toMatchObject({
            label: '[sdk quota]',
            headline: 'You have reached your weekly rate limit. Please switch to auto model.',
        });
        expect(message.detail).toContain('terminal');
        expect(message.actionHint).toContain('/model auto');
        expect(message.actionHint).toContain('/restart');
        expect(classifyRuntimeSdkRateLimitScope(error)).toBe('weekly_model');
    });

    it('descreve rate_limit de sessão sem sugerir auto como contorno', () => {
        const error = Object.assign(
            new Error(
                "You've hit your rate limit. Please wait for your limit to reset in 18 minutes. Learn More: https://docs.github.com/copilot/concepts/rate-limits.",
            ),
            { status: 429 },
        );
        const policy = getSdkRecoveryPolicy(error, 'session');
        const message = describeSdkRecoveryPolicy(policy, error);

        expect(policy).toMatchObject({
            kind: 'rate_limit',
            allowReconnect: false,
            resetCircuit: true,
        });
        expect(classifyRuntimeSdkRateLimitScope(error)).toBe('session');
        expect(message.detail).toContain('Limite de sessão');
        expect(message.actionHint).toContain('Aguarde o reset');
        expect(message.actionHint).toContain('não contorna limite de sessão');
    });

    it('descreve auth sem confundir com indisponibilidade de boot local', () => {
        const error = Object.assign(new Error('unauthorized'), { status: 401 });
        const policy = getSdkRecoveryPolicy(error, 'session');
        const message = describeSdkRecoveryPolicy(policy, error);

        expect(policy.kind).toBe('auth');
        expect(message.label).toBe('[sdk auth]');
        expect(message.detail).toContain('host local continua vivo');
        expect(message.actionHint).toContain('Reautentique');
    });

    it('classifica indisponibilidade 5xx do validador GitHub como rede mesmo quando o SDK prefixa Authentication failed', () => {
        const error = new Error(
            'Authentication failed: Failed to validate SDK token (503): GitHub returned: No server is currently available to service your request. Sorry about that.',
        );
        const policy = getSdkRecoveryPolicy(error, 'session');
        const message = describeSdkRecoveryPolicy(policy, error);

        expect(policy).toMatchObject({
            kind: 'network',
            retryable: true,
            allowReconnect: true,
        });
        expect(message.label).toBe('[sdk rede]');
        expect(message.detail).toContain('Falha transitória');
        expect(message.actionHint).not.toContain('Reautentique');
        expect(
            getSdkRecoveryPolicy(new Error('Authentication failed: token validation upstream (502)'), 'session').kind,
        ).toBe('network');
    });

    it('classifica bloqueios de conta e modelo sem sugerir reconnect local', () => {
        const accountPolicy = getSdkRecoveryPolicy(
            { status: 402, message: 'payment required for this account' },
            'session',
        );
        const modelPolicy = getSdkRecoveryPolicy(
            { status: 400, message: 'unsupported model for this request' },
            'session',
        );

        expect(accountPolicy).toMatchObject({
            kind: 'account',
            allowReconnect: false,
            resetCircuit: true,
        });
        expect(
            describeSdkRecoveryPolicy(accountPolicy, { message: 'payment required for this account' }),
        ).toMatchObject({
            label: '[sdk conta]',
        });
        expect(modelPolicy).toMatchObject({
            kind: 'model_unsupported',
            allowReconnect: false,
            resetCircuit: true,
        });
        expect(describeSdkRecoveryPolicy(modelPolicy, { message: 'unsupported model for this request' })).toMatchObject(
            {
                label: '[sdk modelo]',
            },
        );
    });
});
