// @ts-check

import { describe, expect, it } from 'vitest';

import {
    buildAgentConnectedSsePayload,
    buildAgentSessionHttpPayload,
    buildAgentStatusHttpPayload,
    readAgentStatusSnapshot,
    readAgentStatusValue,
} from '../../../src/copilot/presentation/runtime-status.js';

describe('presentation/runtime-status', () => {
    const agent = /** @type {any} */ ({
        getStatusSnapshot: () => ({
            status: 'processing',
            sessionId: 'sess-123',
            model: 'gpt-5-mini',
            isResumed: true,
            resumeCount: 2,
            sendCount: 7,
            startedAt: 123,
            queueSize: 3,
        }),
    });

    it('readAgentStatusSnapshot retorna o snapshot bruto do runtime', () => {
        expect(readAgentStatusSnapshot(agent)).toEqual(
            expect.objectContaining({
                status: 'processing',
                sessionId: 'sess-123',
                model: 'gpt-5-mini',
            }),
        );
    });

    it('readAgentStatusValue extrai o status textual', () => {
        expect(readAgentStatusValue(agent)).toBe('processing');
    });

    it('buildAgentStatusHttpPayload inclui ok + snapshot', () => {
        expect(buildAgentStatusHttpPayload(agent)).toEqual(
            expect.objectContaining({
                ok: true,
                lifecycle: expect.any(Object),
                lifecycleSummary: expect.any(Object),
                status: 'processing',
                sessionId: 'sess-123',
                queueSize: 3,
            }),
        );
    });

    it('buildAgentStatusHttpPayload aceita metadata explícita de fallback', () => {
        expect(
            buildAgentStatusHttpPayload(agent, {
                runtimeId: 'default',
                requestedRuntimeId: 'missing',
                runtimeFound: false,
                usedDefaultRuntimeFallback: true,
            }),
        ).toEqual(
            expect.objectContaining({
                runtimeId: 'default',
                requestedRuntimeId: 'missing',
                runtimeFound: false,
                usedDefaultRuntimeFallback: true,
            }),
        );
    });

    it('buildAgentSessionHttpPayload projeta apenas os campos de sessão esperados', () => {
        expect(buildAgentSessionHttpPayload(agent)).toEqual({
            ok: true,
            sessionId: 'sess-123',
            model: 'gpt-5-mini',
            isResumed: true,
            resumeCount: 2,
            sendCount: 7,
            startedAt: 123,
        });
    });

    it('buildAgentSessionHttpPayload propaga metadata explícita de fallback', () => {
        expect(
            buildAgentSessionHttpPayload(agent, {
                runtimeId: 'default',
                requestedRuntimeId: 'missing',
                runtimeFound: false,
                usedDefaultRuntimeFallback: true,
            }),
        ).toEqual(
            expect.objectContaining({
                runtimeId: 'default',
                requestedRuntimeId: 'missing',
                runtimeFound: false,
                usedDefaultRuntimeFallback: true,
            }),
        );
    });

    it('buildAgentConnectedSsePayload acrescenta timestamp ao snapshot', () => {
        const payload = buildAgentConnectedSsePayload(agent);
        expect(payload).toEqual(
            expect.objectContaining({
                status: 'processing',
                sessionId: 'sess-123',
                timestamp: expect.any(Number),
            }),
        );
    });

    it('buildAgentConnectedSsePayload propaga metadata explícita de fallback', () => {
        const payload = buildAgentConnectedSsePayload(agent, {
            runtimeId: 'default',
            requestedRuntimeId: 'missing',
            runtimeFound: false,
            usedDefaultRuntimeFallback: true,
        });

        expect(payload).toEqual(
            expect.objectContaining({
                runtimeId: 'default',
                requestedRuntimeId: 'missing',
                runtimeFound: false,
                usedDefaultRuntimeFallback: true,
                timestamp: expect.any(Number),
            }),
        );
    });
});
