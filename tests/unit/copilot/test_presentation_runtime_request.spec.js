// @ts-check

import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    buildDefaultCopilotApiRouteDeps: vi.fn((runtimeId) => ({
        agent: { status: 'idle' },
        runtimeId: runtimeId ?? 'default',
    })),
}));

vi.mock('../../../src/copilot/presentation/runtime-route-deps.js', () => ({
    buildDefaultCopilotApiRouteDeps: mocks.buildDefaultCopilotApiRouteDeps,
}));

import {
    resolveCopilotApiRouteDeps,
    resolveRequestedRuntimeId,
} from '../../../src/copilot/presentation/runtime-request.js';

describe('presentation/runtime-request.js', () => {
    it('resolveRequestedRuntimeId respeita a precedência canônica', () => {
        const req = /** @type {import('express').Request} */ (
            /** @type {unknown} */ ({
                query: { runtimeId: 'query-id', runtime: 'query-fallback' },
                headers: { 'x-agent-runtime-id': 'header-id' },
                body: { runtimeId: 'body-id' },
                params: { runtimeId: 'param-id' },
            })
        );

        expect(resolveRequestedRuntimeId(req)).toBe('query-id');
    });

    it('cai para header/body/params quando query não estiver presente', () => {
        const headerReq = /** @type {import('express').Request} */ (
            /** @type {unknown} */ ({
                query: {},
                headers: { 'x-agent-runtime-id': 'header-id' },
                body: {},
                params: {},
            })
        );
        const bodyReq = /** @type {import('express').Request} */ (
            /** @type {unknown} */ ({
                query: {},
                headers: {},
                body: { runtimeId: 'body-id' },
                params: {},
            })
        );
        const paramReq = /** @type {import('express').Request} */ (
            /** @type {unknown} */ ({
                query: {},
                headers: {},
                body: {},
                params: { runtimeId: 'param-id' },
            })
        );

        expect(resolveRequestedRuntimeId(headerReq)).toBe('header-id');
        expect(resolveRequestedRuntimeId(bodyReq)).toBe('body-id');
        expect(resolveRequestedRuntimeId(paramReq)).toBe('param-id');
    });

    it('normaliza runtimeId com trimming e ignora vazios na precedência', () => {
        const req = /** @type {import('express').Request} */ (
            /** @type {unknown} */ ({
                query: { runtimeId: '   ' },
                headers: { 'x-agent-runtime-id': '  alt-runtime  ' },
                body: {},
                params: {},
            })
        );

        expect(resolveRequestedRuntimeId(req)).toBe('alt-runtime');
    });

    it('resolve deps do copilot-api a partir do runtimeId resolvido', () => {
        const req = /** @type {import('express').Request} */ (
            /** @type {unknown} */ ({
                query: { runtimeId: 'default' },
                headers: {},
                body: {},
                params: {},
            })
        );

        expect(resolveCopilotApiRouteDeps(req).runtimeId).toBe('default');
        expect(mocks.buildDefaultCopilotApiRouteDeps).toHaveBeenCalledWith('default');
    });
});
