// @ts-check
/**
 * tests/unit/copilot/test_session_rotation.spec.js
 *
 * Testes unitários para F43.2: shouldRotateSession — política de rotação de sessão.
 */

import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

describe('shouldRotateSession', async () => {
    /** @type {typeof import('../../../src/copilot/agent/session/rotation.js').shouldRotateSession} */
    let shouldRotateSession;

    before(async () => {
        ({ shouldRotateSession } = await import('../../../src/copilot/agent/session/rotation.js'));
    });

    it('deve retornar false para contexto vazio (dentro dos limites)', () => {
        const result = shouldRotateSession({});
        assert.equal(result.shouldRotate, false);
        assert.ok(result.reason.length > 0);
    });

    it('deve rotacionar quando utilização alta', () => {
        const result = shouldRotateSession({ contextUtilization: 0.95 });
        assert.equal(result.shouldRotate, true);
        assert.ok(result.reason.includes('Utilização'));
    });

    it('não deve rotacionar quando utilização baixa', () => {
        const result = shouldRotateSession({ contextUtilization: 0.5 });
        assert.equal(result.shouldRotate, false);
    });

    it('deve rotacionar quando sessão é muito antiga', () => {
        const result = shouldRotateSession({ sessionAgeMs: 5 * 60 * 60_000 }); // 5h > default 4h
        assert.equal(result.shouldRotate, true);
        assert.ok(result.reason.includes('idade'));
    });

    it('não deve rotacionar quando sessão é jovem', () => {
        const result = shouldRotateSession({ sessionAgeMs: 1 * 60 * 60_000 }); // 1h
        assert.equal(result.shouldRotate, false);
    });

    it('deve rotacionar quando muitas compactions', () => {
        const result = shouldRotateSession({ compactionCount: 10 }); // > default 5
        assert.equal(result.shouldRotate, true);
        assert.ok(result.reason.includes('Compactions'));
    });

    it('deve rotacionar quando muitos turnos', () => {
        const result = shouldRotateSession({ totalTurns: 300 }); // > default 200
        assert.equal(result.shouldRotate, true);
        assert.ok(result.reason.includes('Turnos'));
    });

    it('deve aceitar policy override', () => {
        const result = shouldRotateSession(
            { sessionAgeMs: 2 * 60 * 60_000 }, // 2h
            { maxAgeMs: 1 * 60 * 60_000 }, // max 1h
        );
        assert.equal(result.shouldRotate, true);
    });

    it('deve priorizar utilização sobre idade', () => {
        const result = shouldRotateSession({
            contextUtilization: 0.95,
            sessionAgeMs: 5 * 60 * 60_000,
        });
        assert.equal(result.shouldRotate, true);
        assert.ok(result.reason.includes('Utilização'));
    });
});
