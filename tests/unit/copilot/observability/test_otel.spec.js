// @ts-check
/**
 * tests/unit/copilot/observability/test_otel.spec.js
 *
 * Testes para src/copilot/observability/otel.js.
 *
 * F207: buildTelemetryConfig, isOtelEnabled, startSpan fallback, startSpanImmediate fallback.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mock dinâmico do módulo env ──────────────────────────────────────────────

/** @type {Record<string, any>} */
let envOverrides = {};

vi.mock('#copilot/config/env', () => ({
    get COPILOT_LOG_DIR() {
        return envOverrides.COPILOT_LOG_DIR ?? '/tmp/test-logs';
    },
    get COPILOT_OTEL_DISABLED() {
        return envOverrides.COPILOT_OTEL_DISABLED ?? false;
    },
    get COPILOT_OTEL_ENDPOINT() {
        return envOverrides.COPILOT_OTEL_ENDPOINT ?? '';
    },
    get COPILOT_OTEL_EXPORTER_TYPE() {
        return envOverrides.COPILOT_OTEL_EXPORTER_TYPE ?? undefined;
    },
    get COPILOT_OTEL_SOURCE_NAME() {
        return envOverrides.COPILOT_OTEL_SOURCE_NAME ?? 'copilot-sdk-agent';
    },
    get COPILOT_OTEL_CAPTURE_CONTENT() {
        return envOverrides.COPILOT_OTEL_CAPTURE_CONTENT ?? false;
    },
}));

describe('otel.js', () => {
    /** @type {typeof import('../../../../src/copilot/observability/otel.js')} */
    let mod;

    beforeEach(async () => {
        envOverrides = {};
        vi.resetModules();
        mod = await import('../../../../src/copilot/observability/otel.js');
    });

    // ── buildTelemetryConfig ──────────────────────────────────────────────

    describe('buildTelemetryConfig', () => {
        it('retorna undefined quando OTEL está desabilitado', async () => {
            envOverrides.COPILOT_OTEL_DISABLED = true;
            vi.resetModules();
            const m = await import('../../../../src/copilot/observability/otel.js');
            expect(m.buildTelemetryConfig()).toBeUndefined();
        });

        it('retorna config file como padrão', () => {
            const cfg = mod.buildTelemetryConfig();
            expect(cfg).toBeDefined();
            expect(cfg?.exporterType).toBe('file');
            expect(cfg?.filePath).toBeTruthy();
        });

        it('retorna otlp-http quando endpoint definido', async () => {
            envOverrides.COPILOT_OTEL_ENDPOINT = 'http://localhost:4318';
            vi.resetModules();
            const m = await import('../../../../src/copilot/observability/otel.js');
            const cfg = m.buildTelemetryConfig();
            expect(cfg?.exporterType).toBe('otlp-http');
            expect(cfg?.otlpEndpoint).toBe('http://localhost:4318');
        });

        it('respeita explicitExporterType quando endpoint definido', async () => {
            envOverrides.COPILOT_OTEL_ENDPOINT = 'http://localhost:4318';
            envOverrides.COPILOT_OTEL_EXPORTER_TYPE = 'custom';
            vi.resetModules();
            const m = await import('../../../../src/copilot/observability/otel.js');
            const cfg = m.buildTelemetryConfig();
            expect(cfg?.exporterType).toBe('custom');
        });

        it('inclui sourceName e captureContent', () => {
            const cfg = mod.buildTelemetryConfig();
            expect(cfg?.sourceName).toBe('copilot-sdk-agent');
            expect(cfg?.captureContent).toBe(false);
        });
    });

    // ── isOtelEnabled ─────────────────────────────────────────────────────

    describe('isOtelEnabled', () => {
        it('retorna true quando OTEL não está desabilitado', () => {
            expect(mod.isOtelEnabled()).toBe(true);
        });

        it('retorna false quando OTEL está desabilitado', async () => {
            envOverrides.COPILOT_OTEL_DISABLED = true;
            vi.resetModules();
            const m = await import('../../../../src/copilot/observability/otel.js');
            expect(m.isOtelEnabled()).toBe(false);
        });
    });

    // ── startSpan (graceful degradation) ──────────────────────────────────

    describe('startSpan', () => {
        it('executa fn diretamente quando OTEL não disponível', async () => {
            const result = await mod.startSpan('test.span', {}, async () => 'hello');
            expect(result).toBe('hello');
        });

        it('propaga erros da fn', async () => {
            await expect(
                mod.startSpan('test.err', {}, async () => {
                    throw new Error('boom');
                }),
            ).rejects.toThrow('boom');
        });
    });

    // ── startSpanImmediate (graceful degradation) ─────────────────────────

    describe('startSpanImmediate', () => {
        it('retorna null quando tracer não disponível', () => {
            const span = mod.startSpanImmediate('test');
            expect(span).toBeNull();
        });
    });

    // ── DEFAULT_OTEL_FILE ─────────────────────────────────────────────────

    describe('DEFAULT_OTEL_FILE', () => {
        it('é path que termina em otel-traces.jsonl', () => {
            expect(mod.DEFAULT_OTEL_FILE).toMatch(/otel-traces\.jsonl$/);
        });
    });
});
