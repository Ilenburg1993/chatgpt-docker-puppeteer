// @ts-check
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- legacy fixture inference is intentionally outside the MCP strict hardening pass

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    comparableModelGatewayRuntimeHealthRecord,
    diffModelGatewayRuntimeHealthSnapshots,
    flushByokProviderHealth,
    readByokProviderHealthState,
    readByokProviderModelHealth,
    recordByokProviderModelAgentProbeFailure,
    recordByokProviderModelAgentProbeSuccess,
    recordByokProviderModelCallFailure,
    recordByokProviderModelCallSuccess,
    recordByokProviderModelProbeResult,
    resetByokProviderHealthForTests,
    summarizeModelGatewayRuntimeHealthRecords,
} from '../../../../src/copilot/model-gateway/health/index.js';

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
            failureKind: 'rate-limit',
            failureStatusCode: 429,
            retryAfterSeconds: 30,
            resetAt: '2026-05-25T00:01:00.000Z',
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
        expect(health?.lastFailureKind).toBe('rate-limit');
        expect(health?.lastFailureStatusCode).toBe(429);
        expect(health?.lastRetryAfterSeconds).toBe(30);
        expect(health?.lastResetAt).toBe('2026-05-25T00:01:00.000Z');
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
        expect(health?.lastFailureKind).toBeNull();
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

    it('registra probes descartáveis por tipo sem transformar streaming/json em saúde de chat', async () => {
        await useTempHealthPath();

        recordByokProviderModelProbeResult({
            routeProfile: 'openrouter-free',
            providerId: 'openrouter',
            providerModel: 'stream-model',
            probeKind: 'streaming',
            status: 'no-delta',
            ok: false,
            providerAttempted: true,
            message: 'sem delta',
            errorContext: 'byok_streaming_probe',
            failureKind: 'rate-limit',
            failureStatusCode: 429,
            retryAfterSeconds: 10,
            timestamp: 1_700_000_040_000,
        });
        recordByokProviderModelProbeResult({
            routeProfile: 'openrouter-free',
            providerId: 'openrouter',
            providerModel: 'stream-model',
            probeKind: 'json',
            status: 'ok',
            ok: true,
            providerAttempted: true,
            timestamp: 1_700_000_050_000,
        });
        await flushByokProviderHealth();
        resetByokProviderHealthForTests();

        const health = readByokProviderModelHealth({
            routeProfile: 'openrouter-free',
            providerId: 'openrouter',
            providerModel: 'stream-model',
        });

        expect(health?.lastStatus).toBeNull();
        expect(health?.probes?.['streaming']).toEqual(
            expect.objectContaining({
                status: 'no-delta',
                ok: false,
                failureCount: 1,
                lastMessage: 'sem delta',
                lastFailureKind: 'rate-limit',
                lastFailureStatusCode: 429,
                lastRetryAfterSeconds: 10,
            }),
        );
        expect(health?.probes?.['json']).toEqual(
            expect.objectContaining({
                status: 'ok',
                ok: true,
                successCount: 1,
            }),
        );
    });

    it('classifica diff de runtime health separando regressão, falha nova e recuperação', () => {
        const before = [
            comparableModelGatewayRuntimeHealthRecord({
                routeProfile: 'kilo',
                providerId: 'kilo-code',
                providerModel: 'stable',
                lastStatus: 'ok',
                lastSuccessAt: 1_000,
            }),
            comparableModelGatewayRuntimeHealthRecord({
                routeProfile: 'kilo',
                providerId: 'kilo-code',
                providerModel: 'recovering',
                agentProbeStatus: 'failed',
                lastAgentProbeFailureAt: 1_000,
            }),
            comparableModelGatewayRuntimeHealthRecord({
                routeProfile: 'openrouter-free',
                providerId: 'openrouter',
                providerModel: 'unknown-before',
            }),
        ];
        const after = [
            comparableModelGatewayRuntimeHealthRecord({
                routeProfile: 'kilo',
                providerId: 'kilo-code',
                providerModel: 'stable',
                lastStatus: 'failed',
                lastSuccessAt: 1_000,
                lastFailureAt: 2_000,
                lastFailureKind: 'model_call',
            }),
            comparableModelGatewayRuntimeHealthRecord({
                routeProfile: 'kilo',
                providerId: 'kilo-code',
                providerModel: 'recovering',
                agentProbeStatus: 'ok',
                lastAgentProbeFailureAt: 1_000,
                lastAgentProbeSuccessAt: 3_000,
            }),
            comparableModelGatewayRuntimeHealthRecord({
                routeProfile: 'openrouter-free',
                providerId: 'openrouter',
                providerModel: 'unknown-before',
                agentProbeStatus: 'failed',
                lastAgentProbeFailureAt: 2_000,
            }),
            comparableModelGatewayRuntimeHealthRecord({
                routeProfile: 'kilo',
                providerId: 'kilo-code',
                providerModel: 'new-empty-agent',
                agentProbeStatus: 'failed',
                lastAgentProbeFailureAt: 4_000,
            }),
        ];

        const diff = diffModelGatewayRuntimeHealthSnapshots(before, after);
        const summary = summarizeModelGatewayRuntimeHealthRecords(after);

        expect(diff.summary).toEqual({
            added: 1,
            removed: 0,
            changed: 3,
            regressions: 1,
            newFailures: 1,
            becameFailed: 1,
            recovered: 1,
        });
        expect(diff.regressions[0]?.key).toBe('kilo|kilo-code|stable');
        expect(diff.newFailures[0]?.key).toBe('kilo|kilo-code|new-empty-agent');
        expect(diff.recovered[0]?.key).toBe('kilo|kilo-code|recovering');
        expect(summary.byStatus.failed).toBe(3);
        expect(summary.byStatus.ok).toBe(1);
    });

    it('inclui probes live na comparação sem tratar vision como falha bloqueante', () => {
        const before = [
            comparableModelGatewayRuntimeHealthRecord({
                routeProfile: 'repo_agent',
                providerId: 'zai',
                providerModel: 'glm-4.5-flash',
                probes: {
                    live_turn: { status: 'ok', ok: true },
                    live_tool_protocol: { status: 'ok', ok: true },
                    vision: { status: 'failed', ok: false },
                },
            }),
        ];
        const after = [
            comparableModelGatewayRuntimeHealthRecord({
                routeProfile: 'repo_agent',
                providerId: 'zai',
                providerModel: 'glm-4.5-flash',
                probes: {
                    live_turn: { status: 'failed', ok: false },
                    live_tool_protocol: { status: 'ok', ok: true },
                    vision: { status: 'failed', ok: false },
                },
            }),
        ];

        const diff = diffModelGatewayRuntimeHealthSnapshots(before, after);
        const summary = summarizeModelGatewayRuntimeHealthRecords(after);

        expect(before[0].failedProbeKinds).toEqual(['vision']);
        expect(before[0].blockingFailedProbeKinds).toEqual([]);
        expect(after[0].blockingFailedProbeKinds).toEqual(['live_turn']);
        expect(diff.summary).toEqual({
            added: 0,
            removed: 0,
            changed: 1,
            regressions: 1,
            newFailures: 0,
            becameFailed: 1,
            recovered: 0,
        });
        expect(diff.changed[0]?.changedFields).toContain('probeStatusFingerprint');
        expect(summary.byProbeStatus['live_turn:failed']).toBe(1);
        expect(summary.byProbeStatus['vision:failed']).toBe(1);
    });
});
