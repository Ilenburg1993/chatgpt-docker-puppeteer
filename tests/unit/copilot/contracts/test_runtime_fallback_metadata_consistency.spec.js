// @ts-check
/**
 * @module copilot/contracts/test_runtime_fallback_metadata_consistency
 * @file Valida que metadata de fallback de runtime está presente em todas as projections críticas.
 *
 *   Onda E2: garantir que fallback implícito é transformado em fallback explícito e auditável.
 *   Este contrato verifica que TODA resposta que envolve seleção de runtime inclui:
 *   - requestedRuntimeId (o que foi solicitado)
 *   - runtimeId (o que foi usado)
 *   - runtimeFound (se o runtime solicitado foi encontrado)
 *   - usedDefaultRuntimeFallback (se houve fallback)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readTerminalStatusProjection } from '#copilot/terminal/frontend/projections/status';
import {
    clearRuntimeFallbackLog,
    getRuntimeFallbackLog,
    getRuntimeFallbackStats,
} from '#copilot/presentation/runtime-fallback-telemetry';

describe('Contract: Runtime Fallback Metadata Consistency (Onda E2)', () => {
    beforeEach(() => {
        clearRuntimeFallbackLog();
    });

    afterEach(() => {
        clearRuntimeFallbackLog();
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // Contract 1: Projection metadata completeness
    // ─────────────────────────────────────────────────────────────────────────────

    it('Contract 1A: readTerminalStatusProjection includes complete runtime metadata', () => {
        const proj = readTerminalStatusProjection();

        // Todas estas propriedades devem estar presentes
        expect(proj).toHaveProperty('requestedRuntimeId');
        expect(proj).toHaveProperty('runtimeId');
        expect(proj).toHaveProperty('runtimeFound');
        expect(proj).toHaveProperty('usedDefaultRuntimeFallback');

        // Tipos corretos
        expect(typeof proj.runtimeId).toBe('string');
        expect(typeof proj.runtimeFound).toBe('boolean');
        expect(typeof proj.usedDefaultRuntimeFallback).toBe('boolean');
        expect(proj.requestedRuntimeId === null || typeof proj.requestedRuntimeId === 'string').toBe(true);
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // Contract 2: Fallback telemetry is recorded
    // ─────────────────────────────────────────────────────────────────────────────

    it('Contract 2A: Projections trigger fallback telemetry recording', () => {
        clearRuntimeFallbackLog();

        // Chamar a projection com runtimeId null (deve usar fallback para default)
        readTerminalStatusProjection();

        const log = getRuntimeFallbackLog();

        // Deve ter registrado eventos para cada projection que chama readAgentRuntimeOverview
        expect(log.length).toBeGreaterThan(0);

        // Cada evento deve ter os campos obrigatórios
        for (const event of log) {
            expect(event).toHaveProperty('runtimeId');
            expect(event).toHaveProperty('requestedRuntimeId');
            expect(event).toHaveProperty('caller');
            expect(event).toHaveProperty('timestamp');
            expect(event).toHaveProperty('usedFallback');
            expect(typeof event.timestamp).toBe('number');
        }
    });

    it('Contract 2B: Fallback stats are aggregated correctly', () => {
        clearRuntimeFallbackLog();

        // Chamar múltiplas vezes
        for (let i = 0; i < 3; i++) {
            readTerminalStatusProjection();
        }

        const stats = getRuntimeFallbackStats();

        // Total deve ser >= 3 (uma chamada por readTerminalStatusProjection)
        expect(stats.total).toBeGreaterThanOrEqual(3);
        expect(typeof stats.fallbackCount).toBe('number');
        expect(typeof stats.byCallee).toBe('object');
        expect(typeof stats.byRequestedId).toBe('object');
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // Contract 3: Fallback state invariants
    // ─────────────────────────────────────────────────────────────────────────────

    it('Contract 3A: usedDefaultRuntimeFallback is true only when requestedRuntimeId exists but runtime not found', () => {
        const proj = readTerminalStatusProjection();

        // Quando requestedRuntimeId é null, usedDefaultRuntimeFallback deve ser false
        if (proj.requestedRuntimeId === null) {
            expect(proj.usedDefaultRuntimeFallback).toBe(false);
        }

        // Quando runtimeFound é true, usedDefaultRuntimeFallback deve ser false
        if (proj.runtimeFound === true) {
            expect(proj.usedDefaultRuntimeFallback).toBe(false);
        }

        // Invariante: usedDefaultRuntimeFallback => requestedRuntimeId !== null && !runtimeFound
        if (proj.usedDefaultRuntimeFallback) {
            expect(proj.requestedRuntimeId).not.toBeNull();
            expect(proj.runtimeFound).toBe(false);
        }
    });

    it('Contract 3B: runtimeId is always defined and non-empty', () => {
        const proj = readTerminalStatusProjection();

        expect(proj.runtimeId).toBeDefined();
        expect(proj.runtimeId).not.toBe('');
        expect(typeof proj.runtimeId).toBe('string');
    });
});
