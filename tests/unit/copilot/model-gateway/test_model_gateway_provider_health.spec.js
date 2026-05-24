// @ts-check

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    flushByokProviderHealth,
    readByokProviderHealthState,
    readByokProviderModelHealth,
    recordByokProviderModelAgentProbeFailure,
    recordByokProviderModelAgentProbeSuccess,
    recordByokProviderModelCallFailure,
    recordByokProviderModelCallSuccess,
    resetByokProviderHealthForTests,
} from '../../../../src/copilot/model-gateway/health/provider-health.js';

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
            routeProfile: 'cerebras-free',
            providerId: 'cerebras',
            providerModel: 'gpt-oss-120b',
            message: 'Provider rejected request with Bearer abcdefghijklmnopqrstuvwxyz012345',
            errorContext: 'model_call',
            timestamp: 1_700_000_000_000,
        });
        await flushByokProviderHealth();
        resetByokProviderHealthForTests();

        const health = readByokProviderModelHealth({
            routeProfile: 'cerebras-free',
            providerId: 'cerebras',
            providerModel: 'gpt-oss-120b',
        });

        expect(health?.routeProfile).toBe('cerebras-free');
        expect(health?.providerId).toBe('cerebras');
        expect(health?.providerModel).toBe('gpt-oss-120b');
        expect(health?.lastStatus).toBe('failed');
        expect(health?.failureCount).toBe(1);
        expect(health?.lastMessage).toContain('[redacted]');
        expect(health?.lastMessage).not.toContain('abcdefghijklmnopqrstuvwxyz012345');
        expect(readByokProviderHealthState().records).toBe(1);
    });

    it('marca sucesso posterior como status operacional atual sem apagar histórico de falha', async () => {
        await useTempHealthPath();

        recordByokProviderModelCallFailure({
            routeProfile: 'kilo',
            providerId: 'kilo-code',
            providerModel: 'kilo-auto/free',
            message: 'timeout',
            errorContext: 'model_call',
            timestamp: 1_700_000_000_000,
        });
        recordByokProviderModelCallSuccess({
            routeProfile: 'kilo',
            providerId: 'kilo-code',
            providerModel: 'kilo-auto/free',
            successContext: 'llm.usage',
            timestamp: 1_700_000_010_000,
        });
        await flushByokProviderHealth();
        resetByokProviderHealthForTests();

        const health = readByokProviderModelHealth({
            routeProfile: 'kilo',
            providerId: 'kilo-code',
            providerModel: 'kilo-auto/free',
        });

        expect(health?.lastStatus).toBe('ok');
        expect(health?.failureCount).toBe(1);
        expect(health?.successCount).toBe(1);
        expect(health?.lastFailureAt).toBe(1_700_000_000_000);
        expect(health?.lastSuccessAt).toBe(1_700_000_010_000);
        expect(health?.lastSuccessContext).toBe('llm.usage');
    });

    it('persiste health agente separado do chat para tool calling e ask_user', async () => {
        await useTempHealthPath();

        recordByokProviderModelCallSuccess({
            routeProfile: 'kilo',
            providerId: 'kilo-code',
            providerModel: 'kilo-auto/free',
            timestamp: 1_700_000_000_000,
        });
        recordByokProviderModelAgentProbeFailure({
            routeProfile: 'kilo',
            providerId: 'kilo-code',
            providerModel: 'kilo-auto/free',
            message: 'tool was not invoked',
            errorContext: 'byok_agent_probe',
            timestamp: 1_700_000_010_000,
        });
        recordByokProviderModelAgentProbeSuccess({
            routeProfile: 'kilo',
            providerId: 'kilo-code',
            providerModel: 'kilo-auto/free',
            timestamp: 1_700_000_020_000,
        });
        await flushByokProviderHealth();
        resetByokProviderHealthForTests();

        const health = readByokProviderModelHealth({
            routeProfile: 'kilo',
            providerId: 'kilo-code',
            providerModel: 'kilo-auto/free',
        });

        expect(health?.lastStatus).toBe('ok');
        expect(health?.agentProbeStatus).toBe('ok');
        expect(health?.agentProbeFailureCount).toBe(1);
        expect(health?.agentProbeSuccessCount).toBe(1);
        expect(health?.lastAgentProbeFailureAt).toBe(1_700_000_010_000);
        expect(health?.lastAgentProbeSuccessAt).toBe(1_700_000_020_000);
    });

    it('migra registros schema v1 profile/provider/model para identidade gateway canônica', async () => {
        await useTempHealthPath();
        const filePath = process.env['TERMINAL_BYOK_PROVIDER_HEALTH_PATH'];
        expect(filePath).toBeTruthy();
        await writeFile(
            /** @type {string} */ (filePath),
            `${JSON.stringify({
                schemaVersion: 1,
                updatedAt: '2026-05-24T00:00:00.000Z',
                records: [
                    {
                        key: 'legacy|groq|llama',
                        profile: 'legacy',
                        provider: 'groq',
                        model: 'llama',
                        lastStatus: 'ok',
                        successCount: 1,
                        lastSuccessAt: 1_700_000_030_000,
                    },
                ],
            })}\n`,
            'utf8',
        );

        const health = readByokProviderModelHealth({
            routeProfile: 'legacy',
            providerId: 'groq',
            providerModel: 'llama',
        });

        expect(health).toEqual(
            expect.objectContaining({
                key: 'legacy|groq|llama',
                routeProfile: 'legacy',
                providerId: 'groq',
                providerModel: 'llama',
                lastStatus: 'ok',
            }),
        );
    });
});
