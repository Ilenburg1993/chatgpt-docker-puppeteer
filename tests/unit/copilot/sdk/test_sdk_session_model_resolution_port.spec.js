// @ts-check

import { describe, expect, it } from 'vitest';

import {
    resolveSessionAutoModel,
    setSessionAutoModelResolver,
} from '../../../../src/copilot/sdk/session/model-resolution-port.js';

describe('sdk/session/model-resolution-port', () => {
    it('resolveSessionAutoModel usa resolver injetado', async () => {
        setSessionAutoModelResolver(async (fallback) => `resolved:${fallback}`);

        await expect(resolveSessionAutoModel('gpt-5-mini')).resolves.toBe('resolved:gpt-5-mini');
    });

    it('setSessionAutoModelResolver(null) restaura resolver default sem quebrar reinjeção', async () => {
        setSessionAutoModelResolver(null);
        setSessionAutoModelResolver(async () => 'resolved-again');

        await expect(resolveSessionAutoModel('ignored')).resolves.toBe('resolved-again');
    });
});
