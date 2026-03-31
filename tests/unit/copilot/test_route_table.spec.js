// @ts-check
/**
 * tests/unit/copilot/test_route_table.spec.js
 *
 * Testes unitários para src/copilot/terminal/route-table.js
 *
 * Verifica:
 *
 * - Todas as rotas esperadas estão presentes
 * - matchRoute resolve corretamente para paths string e regex
 * - skipAuth está configurado para /health, /hub-health, /metrics
 * - Rotas com body parse estão marcadas corretamente
 * - Rate limiters estão atribuídos
 * - Sem duplicatas de (method + path)
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ROUTE_TABLE, matchRoute } from '../../../src/copilot/terminal/route-table.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Estrutura da tabela
// ═══════════════════════════════════════════════════════════════════════════════

describe('route-table › estrutura', () => {
    it('exporta ROUTE_TABLE como array não-vazio', () => {
        assert.ok(Array.isArray(ROUTE_TABLE));
        assert.ok(ROUTE_TABLE.length >= 25, `Expected >=25 routes, got ${ROUTE_TABLE.length}`);
    });

    it('cada rota tem method, path, handler', () => {
        for (const r of ROUTE_TABLE) {
            assert.ok(typeof r.method === 'string', `route missing method`);
            assert.ok(typeof r.path === 'string' || r.path instanceof RegExp, `route missing path`);
            assert.ok(typeof r.handler === 'function', `route ${r.method} ${r.path} missing handler`);
        }
    });

    it('não tem duplicatas de (method, path) para paths string', () => {
        const seen = new Set();
        for (const r of ROUTE_TABLE) {
            if (typeof r.path !== 'string') continue;
            const key = `${r.method} ${r.path}`;
            assert.ok(!seen.has(key), `Duplicata: ${key}`);
            seen.add(key);
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// skipAuth
// ═══════════════════════════════════════════════════════════════════════════════

describe('route-table › skipAuth', () => {
    const authExempt = ['/health', '/hub-health', '/metrics'];

    for (const path of authExempt) {
        it(`${path} tem skipAuth=true`, () => {
            const route = ROUTE_TABLE.find((r) => r.method === 'GET' && r.path === path);
            assert.ok(route, `rota GET ${path} não encontrada`);
            assert.equal(route.skipAuth, true);
        });
    }

    it('rotas de config NÃO são skipAuth', () => {
        const configRoutes = ROUTE_TABLE.filter((r) => typeof r.path === 'string' && r.path.startsWith('/config'));
        for (const r of configRoutes) {
            assert.ok(!r.skipAuth, `${r.method} ${r.path} não deveria ser skipAuth`);
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// matchRoute
// ═══════════════════════════════════════════════════════════════════════════════

describe('route-table › matchRoute', () => {
    it('resolve GET /health', () => {
        const r = matchRoute('GET', '/health');
        assert.ok(r);
        assert.equal(r.skipAuth, true);
    });

    it('resolve POST /inject', () => {
        const r = matchRoute('POST', '/inject');
        assert.ok(r);
        assert.equal(r.body, 'json');
        assert.equal(r.rateLimiter, 'inject');
    });

    it('resolve DELETE /config/tools/custom/my_tool', () => {
        const r = matchRoute('DELETE', '/config/tools/custom/my_tool');
        assert.ok(r);
    });

    it('resolve DELETE /memory/abc123', () => {
        const r = matchRoute('DELETE', '/memory/abc123');
        assert.ok(r);
    });

    it('resolve GET /sessions/uuid-123/turns (regex)', () => {
        const r = matchRoute('GET', '/sessions/uuid-123/turns');
        assert.ok(r);
    });

    it('retorna undefined para rota inexistente', () => {
        assert.equal(matchRoute('GET', '/nonexistent'), undefined);
    });

    it('retorna undefined para method errado', () => {
        assert.equal(matchRoute('POST', '/health'), undefined);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Body parsing e rate limiters
// ═══════════════════════════════════════════════════════════════════════════════

describe('route-table › body & rate limiters', () => {
    const bodied = [
        'POST /inject',
        'POST /pipeline',
        'POST /memory',
        'PUT /config/infinite-session',
        'PUT /config/skills',
        'PUT /config/tools',
        'POST /config/tools/custom',
    ];

    for (const key of bodied) {
        it(`${key} tem body='json'`, () => {
            const [method, path] = key.split(' ');
            const route = ROUTE_TABLE.find((r) => r.method === method && r.path === path);
            assert.ok(route, `rota ${key} não encontrada`);
            assert.equal(route.body, 'json');
        });
    }

    it('POST /inject tem rateLimiter=inject', () => {
        const r = matchRoute('POST', '/inject');
        assert.ok(r);
        assert.equal(r.rateLimiter, 'inject');
    });

    it('POST /pipeline tem rateLimiter=write', () => {
        const r = matchRoute('POST', '/pipeline');
        assert.ok(r);
        assert.equal(r.rateLimiter, 'write');
        assert.equal(r.rateLimiterKey, 'pipeline');
    });

    it('POST /memory tem rateLimiter=write', () => {
        const r = matchRoute('POST', '/memory');
        assert.ok(r);
        assert.equal(r.rateLimiter, 'write');
        assert.equal(r.rateLimiterKey, 'memory');
    });

    it('GET /events tem rateLimiter=sse', () => {
        const r = matchRoute('GET', '/events');
        assert.ok(r);
        assert.equal(r.rateLimiter, 'sse');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Params extraction
// ═══════════════════════════════════════════════════════════════════════════════

describe('route-table › params extraction', () => {
    it('GET /sessions extrai limit/offset/status', () => {
        const r = matchRoute('GET', '/sessions');
        assert.ok(r?.params);
        const url = new URL('http://localhost/sessions?limit=10&offset=5&status=active');
        const p = r.params(url, '/sessions');
        assert.deepEqual(p, { limit: 10, offset: 5, status: 'active' });
    });

    it('GET /sessions/:id/turns extrai sessionId', () => {
        const r = matchRoute('GET', '/sessions/abc-123/turns');
        assert.ok(r?.params);
        const url = new URL('http://localhost/sessions/abc-123/turns');
        const p = r.params(url, '/sessions/abc-123/turns');
        assert.equal(/** @type {any} */ (p).sessionId, 'abc-123');
    });

    it('GET /memory extrai tag/search/limit', () => {
        const r = matchRoute('GET', '/memory');
        assert.ok(r?.params);
        const url = new URL('http://localhost/memory?tag=geral&search=hello&limit=5');
        const p = r.params(url, '/memory');
        assert.deepEqual(p, { tag: 'geral', search: 'hello', limit: 5 });
    });

    it('GET /gh/issues extrai state/limit', () => {
        const r = matchRoute('GET', '/gh/issues');
        assert.ok(r?.params);
        const url = new URL('http://localhost/gh/issues?state=closed&limit=5');
        const p = r.params(url, '/gh/issues');
        assert.deepEqual(p, { state: 'closed', limit: 5 });
    });

    it('DELETE /config/tools/custom/:name extrai name', () => {
        const r = matchRoute('DELETE', '/config/tools/custom/my%20tool');
        assert.ok(r?.params);
        const url = new URL('http://localhost/config/tools/custom/my%20tool');
        const name = r.params(url, '/config/tools/custom/my%20tool');
        assert.deepEqual(name, { name: 'my tool' });
    });
});
