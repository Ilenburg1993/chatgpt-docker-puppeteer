// @ts-check

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    flushByokProviderHealth,
    readByokProviderHealthState,
    readByokProviderModelHealth,
    recordByokProviderModelCallFailure,
    recordByokProviderModelCallSuccess,
    resetByokProviderHealthForTests,
} from '../../../../src/copilot/terminal/state/byok-provider-health.js';

/** @type {string[]} */
const cleanupDirs = [];

async function useTempHealthPath() {
    const dir = await mkdtemp(join(tmpdir(), 'copilot-byok-health-'));
    cleanupDirs.push(dir);
    process.env['TERMINAL_BYOK_PROVIDER_HEALTH_PATH'] = join(dir, 'health.json');
}

describe('BYOK provider chat health state', () => {
    afterEach(async () => {
        resetByokProviderHealthForTests();
        delete process.env['TERMINAL_BYOK_PROVIDER_HEALTH_PATH'];
        delete process.env['TERMINAL_BYOK_PROVIDER_HEALTH_PERSIST_DISABLED'];
        while (cleanupDirs.length > 0) {
            const dir = cleanupDirs.pop();
            if (dir) await rm(dir, { recursive: true, force: true });
        }
    });

    it('persiste falha redigida e reidrata entre instâncias do processo', async () => {
        await useTempHealthPath();

        recordByokProviderModelCallFailure({
            profile: 'cerebras-free',
            provider: 'cerebras',
            model: 'gpt-oss-120b',
            message: 'Provider rejected request with Bearer abcdefghijklmnopqrstuvwxyz012345',
            errorContext: 'model_call',
            timestamp: 1_700_000_000_000,
        });
        await flushByokProviderHealth();
        resetByokProviderHealthForTests();

        const health = readByokProviderModelHealth({
            profile: 'cerebras-free',
            provider: 'cerebras',
            model: 'gpt-oss-120b',
        });

        expect(health?.lastStatus).toBe('failed');
        expect(health?.failureCount).toBe(1);
        expect(health?.lastMessage).toContain('[redacted]');
        expect(health?.lastMessage).not.toContain('abcdefghijklmnopqrstuvwxyz012345');
        expect(readByokProviderHealthState().records).toBe(1);
    });

    it('marca sucesso posterior como status operacional atual sem apagar histórico de falha', async () => {
        await useTempHealthPath();

        recordByokProviderModelCallFailure({
            profile: 'kilo',
            provider: 'kilo-code',
            model: 'kilo-auto/free',
            message: 'timeout',
            errorContext: 'model_call',
            timestamp: 1_700_000_000_000,
        });
        recordByokProviderModelCallSuccess({
            profile: 'kilo',
            provider: 'kilo-code',
            model: 'kilo-auto/free',
            timestamp: 1_700_000_010_000,
        });
        await flushByokProviderHealth();
        resetByokProviderHealthForTests();

        const health = readByokProviderModelHealth({
            profile: 'kilo',
            provider: 'kilo-code',
            model: 'kilo-auto/free',
        });

        expect(health?.lastStatus).toBe('ok');
        expect(health?.failureCount).toBe(1);
        expect(health?.successCount).toBe(1);
        expect(health?.lastFailureAt).toBe(1_700_000_000_000);
        expect(health?.lastSuccessAt).toBe(1_700_000_010_000);
    });
});
