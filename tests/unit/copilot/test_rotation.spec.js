import { describe, expect, it } from 'vitest';
import { shouldRotateSession } from '../../../src/copilot/agent/session/lifecycle/rotation.js';

describe('shouldRotateSession()', () => {
    describe('contextUtilization', () => {
        it('rota quando utilização >= maxUtilization', () => {
            const result = shouldRotateSession({ contextUtilization: 0.95 }, { maxUtilization: 0.9 });
            expect(result.shouldRotate).toBe(true);
            expect(result.reason).toContain('Utilização');
        });

        it('não rota quando utilização < maxUtilization', () => {
            const result = shouldRotateSession({ contextUtilization: 0.5 }, { maxUtilization: 0.9 });
            expect(result.shouldRotate).toBe(false);
        });

        it('rota quando utilização == maxUtilization (boundary)', () => {
            const result = shouldRotateSession({ contextUtilization: 0.9 }, { maxUtilization: 0.9 });
            expect(result.shouldRotate).toBe(true);
        });
    });

    describe('sessionAgeMs', () => {
        it('rota quando idade >= maxAgeMs', () => {
            const fourHours = 4 * 3600_000;
            const result = shouldRotateSession({ sessionAgeMs: fourHours + 1 }, { maxAgeMs: fourHours });
            expect(result.shouldRotate).toBe(true);
            expect(result.reason).toContain('expirada');
        });

        it('não rota quando idade < maxAgeMs', () => {
            const result = shouldRotateSession({ sessionAgeMs: 1000 }, { maxAgeMs: 4 * 3600_000 });
            expect(result.shouldRotate).toBe(false);
        });
    });

    describe('compactionCount', () => {
        it('rota quando compactions >= maxCompactions', () => {
            const result = shouldRotateSession({ compactionCount: 5 }, { maxCompactions: 5 });
            expect(result.shouldRotate).toBe(true);
            expect(result.reason).toContain('Compactions');
        });

        it('não rota quando compactions < maxCompactions', () => {
            const result = shouldRotateSession({ compactionCount: 2 }, { maxCompactions: 5 });
            expect(result.shouldRotate).toBe(false);
        });
    });

    describe('totalTurns', () => {
        it('rota quando turnos >= maxTurns', () => {
            const result = shouldRotateSession({ totalTurns: 200 }, { maxTurns: 200 });
            expect(result.shouldRotate).toBe(true);
            expect(result.reason).toContain('Turnos');
        });

        it('não rota quando turnos < maxTurns', () => {
            const result = shouldRotateSession({ totalTurns: 50 }, { maxTurns: 200 });
            expect(result.shouldRotate).toBe(false);
        });
    });

    describe('prioridade (primeiro match)', () => {
        it('utilização é avaliada antes de idade', () => {
            const result = shouldRotateSession(
                { contextUtilization: 0.99, sessionAgeMs: 999_999_999 },
                { maxUtilization: 0.9, maxAgeMs: 1 },
            );
            expect(result.reason).toContain('Utilização');
        });
    });

    describe('sem contexto', () => {
        it('retorna shouldRotate=false quando todos os valores são undefined', () => {
            const result = shouldRotateSession({});
            expect(result.shouldRotate).toBe(false);
        });
    });
});
