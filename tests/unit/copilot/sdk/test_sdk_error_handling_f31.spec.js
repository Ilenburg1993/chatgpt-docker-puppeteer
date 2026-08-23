// @ts-check
import {
    SdkConfigError,
    SdkOperationError,
    classifySdkError,
    getSdkRecoveryPolicy,
    toSdkOperationError,
} from '#copilot/sdk/errors';
import { describe, expect, it } from 'vitest';

describe('SDK-owned error contracts', () => {
    it('SdkConfigError owns SDK configuration failures without a cross-domain superclass', () => {
        const error = new SdkConfigError('bad SDK config');
        expect(error).toBeInstanceOf(Error);
        expect(error.name).toBe('SdkConfigError');
        expect(error.code).toBe('SDK_CONFIG_ERROR');
        expect(error.status).toBe(400);
    });
    it('SdkOperationError preserves operation, taxonomy and cause', () => {
        const cause = Object.assign(new Error('network'), { code: 'ECONNRESET' });
        const error = toSdkOperationError('session.create', cause);
        expect(error).toBeInstanceOf(SdkOperationError);
        expect(error.operation).toBe('session.create');
        expect(error.kind).toBe('network');
        expect(error.cause).toBe(cause);
    });
    it('taxonomy and recovery policy stay SDK-owned and operationally consistent', () => {
        const error = Object.assign(new Error('too many requests'), { status: 429 });
        expect(classifySdkError(error)).toBe('rate_limit');
        expect(getSdkRecoveryPolicy(error, 'connection')).toMatchObject({
            retryable: false,
            allowReconnect: false,
            tripCircuit: false,
        });
    });
});
