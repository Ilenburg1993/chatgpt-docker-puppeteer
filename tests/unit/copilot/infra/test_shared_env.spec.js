// @ts-check

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    readEnvIntAtLeast,
    readEnvNonNegativeInt,
    readEnvPositiveInt,
} from '../../../../src/copilot/infra/platform/env.js';

afterEach(() => {
    vi.unstubAllEnvs();
});

describe('infra/shared/env', () => {
    it('usa fallback para inteiros positivos inválidos', () => {
        vi.stubEnv('TEST_POSITIVE_INT', 'disabled');
        expect(readEnvPositiveInt('TEST_POSITIVE_INT', 42)).toBe(42);
        vi.stubEnv('TEST_POSITIVE_INT', '0');
        expect(readEnvPositiveInt('TEST_POSITIVE_INT', 42)).toBe(42);
    });

    it('aceita zero apenas no helper não negativo', () => {
        vi.stubEnv('TEST_NON_NEGATIVE_INT', '0');
        expect(readEnvNonNegativeInt('TEST_NON_NEGATIVE_INT', 42)).toBe(0);
    });

    it('preserva o domínio especial -1/0/>0 quando configurado', () => {
        vi.stubEnv('TEST_INT_AT_LEAST', '-1');
        expect(readEnvIntAtLeast('TEST_INT_AT_LEAST', 42, -1)).toBe(-1);
        vi.stubEnv('TEST_INT_AT_LEAST', '-2');
        expect(readEnvIntAtLeast('TEST_INT_AT_LEAST', 42, -1)).toBe(42);
        vi.stubEnv('TEST_INT_AT_LEAST', '1.5');
        expect(readEnvIntAtLeast('TEST_INT_AT_LEAST', 42, -1)).toBe(42);
    });
});
