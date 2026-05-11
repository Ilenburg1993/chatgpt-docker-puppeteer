// @ts-check
/**
 * tests/unit/copilot/observability/test_otel.spec.js
 *
 * Testes para src/copilot/observability/otel.js.
 *
 * F207: buildTelemetryConfig, isOtelEnabled, startSpan fallback, startSpanImmediate fallback.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
        return envOverrides.COPILOT_OTEL_SOURCE_NAME ?? 'llm-b-terminal';
    },
    get COPILOT_OTEL_CAPTURE_CONTENT() {
        return envOverrides.COPILOT_OTEL_CAPTURE_CONTENT ?? false;
    },

    COPILOT_MCP_SERVERS: '',
    COPILOT_CUSTOM_AGENTS: '',
    COPILOT_DISABLED_AGENTS: '',
    COPILOT_OPERATIONAL_PROFILE: 'production',
}));

describe('otel.js', () => {
    /** @type {typeof import('../../../../src/copilot/observability/otel.js')} */
    let mod;

    beforeAll(async () => {
        mod = await import('../../../../src/copilot/observability/otel.js');
    });

    beforeEach(() => {
        envOverrides = {};
    });

    // ── buildTelemetryConfig ──────────────────────────────────────────────

    describe('buildTelemetryConfig', () => {
        it('retorna undefined quando OTEL está desabilitado', () => {
            envOverrides.COPILOT_OTEL_DISABLED = true;
            expect(mod.buildTelemetryConfig()).toBeUndefined();
        });

        it('retorna config file como padrão', () => {
            const cfg = mod.buildTelemetryConfig();
            expect(cfg).toBeDefined();
            expect(cfg?.exporterType).toBe('file');
            expect(cfg?.filePath).toBeTruthy();
        });

        it('retorna otlp-http quando endpoint definido', () => {
            envOverrides.COPILOT_OTEL_ENDPOINT = 'http://localhost:4318';
            const cfg = mod.buildTelemetryConfig();
            expect(cfg?.exporterType).toBe('otlp-http');
            expect(cfg?.otlpEndpoint).toBe('http://localhost:4318');
        });

        it('respeita explicitExporterType quando endpoint definido', () => {
            envOverrides.COPILOT_OTEL_ENDPOINT = 'http://localhost:4318';
            envOverrides.COPILOT_OTEL_EXPORTER_TYPE = 'custom';
            const cfg = mod.buildTelemetryConfig();
            expect(cfg?.exporterType).toBe('custom');
        });

        it('inclui sourceName e captureContent', () => {
            const cfg = mod.buildTelemetryConfig();
            expect(cfg?.sourceName).toBe('llm-b-terminal');
            expect(cfg?.captureContent).toBe(false);
        });
    });

    // ── isOtelEnabled ─────────────────────────────────────────────────────

    describe('isOtelEnabled', () => {
        it('retorna true quando OTEL não está desabilitado', () => {
            expect(mod.isOtelEnabled()).toBe(true);
        });

        it('retorna false quando OTEL está desabilitado', () => {
            envOverrides.COPILOT_OTEL_DISABLED = true;
            expect(mod.isOtelEnabled()).toBe(false);
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
