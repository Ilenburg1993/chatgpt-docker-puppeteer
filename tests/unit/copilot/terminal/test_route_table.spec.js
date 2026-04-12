// @ts-check
/**
 * tests/unit/copilot/terminal/test_route_table.spec.js
 *
 * F186: Testes para route-table.js — matchRoute e integridade da ROUTE_TABLE.
 */
import { describe, it, expect } from 'vitest';

import { matchRoute, ROUTE_TABLE } from '../../../../src/copilot/terminal/route-table.js';

describe('route-table matchRoute', () => {
    it('resolve GET /health', () => {
        const route = matchRoute('GET', '/health');
        expect(route).toBeDefined();
        expect(route?.skipAuth).toBe(true);
    });

    it('resolve GET /metrics com custom=true', () => {
        const route = matchRoute('GET', '/metrics');
        expect(route).toBeDefined();
        expect(route?.custom).toBe(true);
    });

    it('resolve POST /inject com rateLimiter', () => {
        const route = matchRoute('POST', '/inject');
        expect(route).toBeDefined();
        expect(route?.rateLimiter).toBe('inject');
        expect(route?.body).toBe('json');
    });

    it('resolve GET /events (SSE) com custom', () => {
        const route = matchRoute('GET', '/events');
        expect(route).toBeDefined();
        expect(route?.custom).toBe(true);
        expect(route?.rateLimiter).toBe('sse');
    });

    it('retorna undefined para rota inexistente', () => {
        expect(matchRoute('GET', '/non-existent')).toBeUndefined();
    });

    it('retorna undefined para método errado', () => {
        expect(matchRoute('DELETE', '/health')).toBeUndefined();
    });

    it('resolve regex path: GET /sessions/:id/turns', () => {
        const route = matchRoute('GET', '/sessions/sess-abc-123/turns');
        expect(route).toBeDefined();
        expect(route?.handler).toBeDefined();
    });

    it('resolve regex path: POST /handoff/:id/accept', () => {
        const route = matchRoute('POST', '/handoff/hoff-1/accept');
        expect(route).toBeDefined();
    });

    it('resolve regex path: DELETE /memory/:id', () => {
        const route = matchRoute('DELETE', '/memory/mem-xyz');
        expect(route).toBeDefined();
    });

    it('resolve regex path: DELETE /config/tools/custom/:name', () => {
        const route = matchRoute('DELETE', '/config/tools/custom/myTool');
        expect(route).toBeDefined();
    });
});

describe('route-table params extraction', () => {
    it('extrai sessionId de /sessions/:id/turns', () => {
        const route = matchRoute('GET', '/sessions/sess-42/turns');
        expect(route?.params).toBeDefined();
        if (route?.params) {
            const parsed = route.params(new URL('http://x/sessions/sess-42/turns'), '/sessions/sess-42/turns');
            expect(parsed.sessionId).toBe('sess-42');
        }
    });

    it('extrai handoffId de /handoff/:id/accept', () => {
        const route = matchRoute('POST', '/handoff/hoff-1/accept');
        if (route?.params) {
            const parsed = route.params(new URL('http://x/handoff/hoff-1/accept'), '/handoff/hoff-1/accept');
            expect(parsed.handoffId).toBe('hoff-1');
        }
    });

    it('extrai name decodificado de /config/tools/custom/:name', () => {
        const route = matchRoute('DELETE', '/config/tools/custom/my%20tool');
        if (route?.params) {
            const parsed = route.params(
                new URL('http://x/config/tools/custom/my%20tool'),
                '/config/tools/custom/my%20tool',
            );
            expect(parsed.name).toBe('my tool');
        }
    });

    it('extrai limit de query param em /history', () => {
        const route = matchRoute('GET', '/history');
        if (route?.params) {
            const parsed = route.params(new URL('http://x/history?limit=10'), '/history');
            expect(parsed.limit).toBe(10);
        }
    });
});

describe('route-table ROUTE_TABLE integrity', () => {
    it('todas as rotas possuem method, path e handler', () => {
        for (const route of ROUTE_TABLE) {
            expect(route.method).toBeDefined();
            expect(route.path).toBeDefined();
            expect(typeof route.handler).toBe('function');
        }
    });

    it('sem rotas duplicadas (method + path string)', () => {
        const stringRoutes = ROUTE_TABLE.filter((r) => typeof r.path === 'string');
        const keys = stringRoutes.map((r) => `${r.method}:${r.path}`);
        const unique = new Set(keys);
        expect(unique.size).toBe(keys.length);
    });
});
