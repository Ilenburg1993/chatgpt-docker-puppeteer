// @ts-check

import { describe, expect, it } from 'vitest';

import {
    buildAgentHealthHttpResponse,
    buildAgentModuleHealth,
    buildLegacyAgentHealth,
    getAgentHealthHttpStatus,
    getAgentHealthSnapshotCompat,
} from '../../../src/copilot/presentation/runtime-health.js';

describe('presentation/runtime-health', () => {
    it('usa getHealthSnapshot quando o runtime já expõe a projection canônica', () => {
        const health = getAgentHealthSnapshotCompat(
            /** @type {any} */ ({
                getHealthSnapshot: () => ({
                    ok: true,
                    status: 'healthy',
                    checks: { dialog: {}, io: {}, quota: {}, boot: {} },
                }),
            }),
        );

        expect(health).toEqual(expect.objectContaining({ ok: true, status: 'healthy' }));
        expect(getAgentHealthHttpStatus(/** @type {any} */ (health))).toBe(200);
    });

    it('mantém fallback legado e projeção de módulo', () => {
        const runtime = /** @type {any} */ ({
            status: 'idle',
            sessionId: 'sess-1',
            dialogLoopActive: false,
            dialogPaused: false,
            getSdkResourceSnapshot: () => ({ allCoreResourcesAvailable: true }),
            getStatusSnapshot: () => ({
                status: 'idle',
                sessionId: 'sess-1',
                model: 'gpt-5-mini',
                queueSize: 0,
                pendingQuestion: null,
                isResumed: false,
                resumeCount: 0,
                sendCount: 0,
                startedAt: 1,
                starvationAlert: false,
                oldestTaskWaitMs: 0,
            }),
        });

        const legacy = buildLegacyAgentHealth(runtime);
        const moduleHealth = buildAgentModuleHealth(
            /** @type {any} */ ({ ...runtime, getHealthSnapshot: () => legacy }),
        );

        expect(legacy.ok).toBe(true);
        expect(moduleHealth.ok).toBe(true);
        expect(moduleHealth.details).toEqual(
            expect.objectContaining({
                status: 'idle',
                model: 'gpt-5-mini',
                shuttingDown: false,
                lifecycle: expect.objectContaining({ shuttingDown: false }),
            }),
        );
    });

    it('projeta resposta HTTP de health com metadata runtime canônica', () => {
        const response = buildAgentHealthHttpResponse('missing-runtime-id');

        expect(response.statusCode).toBeGreaterThanOrEqual(200);
        expect(response.statusCode).toBeLessThanOrEqual(503);
        expect(response.body).toEqual(
            expect.objectContaining({
                runtimeId: expect.any(String),
                requestedRuntimeId: 'missing-runtime-id',
                runtimeFound: false,
                usedDefaultRuntimeFallback: true,
                status: expect.any(String),
            }),
        );
    });
});
