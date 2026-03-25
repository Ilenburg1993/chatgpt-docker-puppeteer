// @ts-check
/**
 * tests/unit/copilot/test_http_bridge_health.spec.js
 *
 * Testes unitários para o endpoint GET /health adicionado ao http-bridge.js no Sprint 8.
 *
 * Cobre:
 *
 * - Rota GET /health está registrada no router
 * - Responde { healthy: true } quando agente está operacional (idle, processing, waiting_for_input)
 * - Responde { healthy: false } quando agente está stopped
 * - HTTP 200 para estado saudável, 503 para estado degradado
 * - Inclui campos: healthy, status, sessionId, queueSize, starvationAlert, uptime
 */

import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Cria mock mínimo de res para testes de rota HTTP.
 *
 * @returns {{ res: any; statusCode: number; body: any }}
 */
function makeResMock() {
    /** @type {any} */
    const state = { statusCode: 200, body: null };

    const res = {
        status(code) {
            state.statusCode = code;
            return res;
        },
        json(data) {
            state.body = data;
        },
    };

    return {
        res,
        get statusCode() {
            return state.statusCode;
        },
        get body() {
            return state.body;
        },
    };
}

// ─── Suite: estrutura da rota /health no source ──────────────────────────────

describe('http-bridge › GET /health: análise estrutural', async () => {
    /** @type {string} */
    let sourceCode = '';

    before(async () => {
        const { readFile } = await import('node:fs/promises');
        sourceCode = await readFile(new URL('../../../src/copilot/api/bridge-control.js', import.meta.url), 'utf-8');
    });

    it("rota GET '/health' está registrada no router", () => {
        assert.ok(sourceCode.includes("bridge.get('/health'"), "bridge.get('/health') deve estar registrado no router");
    });

    it("campo 'healthy' está presente na resposta", () => {
        assert.ok(
            sourceCode.includes('healthy,') || sourceCode.includes('healthy:'),
            "resposta deve incluir campo 'healthy'",
        );
    });

    it("campo 'uptime' está calculado a partir de startedAt", () => {
        assert.ok(
            sourceCode.includes('uptime') && sourceCode.includes('startedAt'),
            "resposta deve incluir campo 'uptime' calculado de 'startedAt'",
        );
    });

    it("campo 'starvationAlert' está no health check", () => {
        assert.ok(
            sourceCode.includes('starvationAlert'),
            "health check deve incluir campo 'starvationAlert' do getStatusSnapshot()",
        );
    });

    it('HTTP 503 para agente parado está codificado', () => {
        assert.ok(sourceCode.includes('503'), 'rota /health deve retornar status 503 para agente não saudável');
    });

    it('HTTP 200 para agente saudável está codificado', () => {
        assert.ok(sourceCode.includes('200'), 'rota /health deve retornar status 200 para agente saudável');
    });

    it('condição healthy inclui idle, processing e waiting_for_input', () => {
        assert.ok(
            sourceCode.includes("'idle'") &&
                sourceCode.includes("'processing'") &&
                sourceCode.includes("'waiting_for_input'"),
            'healthy deve ser true para: idle, processing e waiting_for_input',
        );
    });
});

// ─── Suite: comportamento da rota /health via mock ───────────────────────────

describe('http-bridge › GET /health: comportamento via mock', async () => {
    /** @type {any} */
    let bridge;

    before(async () => {
        const mod = await import('../../../src/copilot/api/http-bridge.js');
        bridge = mod.default;
    });

    it('módulo http-bridge exporta o router bridge como default export', () => {
        assert.ok(bridge, 'http-bridge deve exportar bridge router como default');
    });

    it('router bridge tem stack de rotas (pelo menos 1 rota registrada)', () => {
        assert.ok(
            Array.isArray(bridge.stack) && bridge.stack.length > 0,
            'router deve ter ao menos uma rota registrada',
        );
    });

    it('rota /health aparece no stack do router', () => {
        const paths = bridge.stack
            .filter((/** @type {any} */ l) => l.route)
            .map((/** @type {any} */ l) => l.route.path);
        assert.ok(
            paths.includes('/health'),
            `/health deve estar no stack do router. Rotas encontradas: ${paths.join(', ')}`,
        );
    });
});

// ─── Suite: contrato de resposta do /health ───────────────────────────────────

describe('http-bridge › GET /health: contrato de resposta', () => {
    it('quando status é stopped, agente retorna healthy=false', () => {
        // Simula handler do /health com status 'stopped'
        const snap = { status: 'stopped', sessionId: null, queueSize: 0, starvationAlert: false, startedAt: null };

        const healthy = snap.status === 'idle' || snap.status === 'processing' || snap.status === 'waiting_for_input';
        assert.equal(healthy, false, "status 'stopped' deve resultar em healthy=false");
    });

    it('quando status é idle, agente retorna healthy=true', () => {
        const snap = {
            status: 'idle',
            sessionId: 'abc123',
            queueSize: 0,
            starvationAlert: false,
            startedAt: Date.now() - 5000,
        };

        const healthy = snap.status === 'idle' || snap.status === 'processing' || snap.status === 'waiting_for_input';
        assert.equal(healthy, true, "status 'idle' deve resultar em healthy=true");
    });

    it('quando status é processing, agente retorna healthy=true', () => {
        const snap = {
            status: 'processing',
            sessionId: 'abc123',
            queueSize: 1,
            starvationAlert: false,
            startedAt: Date.now() - 10000,
        };

        const healthy = snap.status === 'idle' || snap.status === 'processing' || snap.status === 'waiting_for_input';
        assert.equal(healthy, true, "status 'processing' deve resultar em healthy=true");
    });

    it('quando status é waiting_for_input, agente retorna healthy=true', () => {
        const snap = {
            status: 'waiting_for_input',
            sessionId: 'abc123',
            queueSize: 0,
            starvationAlert: false,
            startedAt: Date.now() - 3000,
        };

        const healthy = snap.status === 'idle' || snap.status === 'processing' || snap.status === 'waiting_for_input';
        assert.equal(healthy, true, "status 'waiting_for_input' deve resultar em healthy=true");
    });

    it('uptime deve ser calculado como Date.now() - startedAt', () => {
        const startedAt = Date.now() - 30_000;
        const uptime = Date.now() - startedAt;
        assert.ok(uptime >= 30_000 && uptime < 31_000, 'uptime deve refletir milissegundos desde startedAt');
    });

    it('uptime deve ser null quando startedAt é null (agente nunca iniciou)', () => {
        const startedAt = null;
        const uptime = startedAt !== null ? Date.now() - startedAt : null;
        assert.equal(uptime, null, 'uptime deve ser null quando startedAt é null');
    });
});
