// @ts-check

import { describe, expect, it } from 'vitest';

import {
    describeSdkRecoveryPolicy,
    getSdkRecoveryPolicy,
} from '../../../src/copilot/presentation/sdk-recovery-policy.js';

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
});
