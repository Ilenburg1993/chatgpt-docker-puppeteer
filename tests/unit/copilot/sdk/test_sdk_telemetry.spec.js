// @ts-check
import { describe, it } from 'node:test';
import { describe, expect, it, vi } from 'vitest';

// ─── SDK mock ──────────────────────────────────────────────────────────────

vi.mock('@github/copilot-sdk', () => {
    const SYSTEM_PROMPT_SECTIONS = Object.freeze({
        identity: 'identity',
        tone: 'tone',
        tool_efficiency: 'tool_efficiency',
        environment_context: 'environment_context',
        code_change_rules: 'code_change_rules',
        guidelines: 'guidelines',
        safety: 'safety',
        instructions: 'instructions',
        docs: 'docs',
        context: 'context',
    });
    return { SYSTEM_PROMPT_SECTIONS };
});

// ─── Imports ───────────────────────────────────────────────────────────────

import {
    createFileTelemetry,
    createOtlpTelemetry,
    createStaticTraceProvider,
    createTelemetryConfig,
    getTraceContext,
} from '#copilot/sdk/telemetry.js';

// ═════════════════════════════════════════════════════════════════════════════
// F72 — getTraceContext
// ═════════════════════════════════════════════════════════════════════════════

describe('F72 - getTraceContext', () => {
    it('retorna {} quando nenhum provider e fornecido', async () => {
        const ctx = await getTraceContext();
        expect(ctx).toEqual({});
    });

    it('retorna {} quando provider e undefined', async () => {
        const ctx = await getTraceContext(undefined);
        expect(ctx).toEqual({});
    });

    it('chama o provider sincrono e retorna trace context', async () => {
        const provider = () => ({
            traceparent: '00-abc-def-01',
            tracestate: 'vendor=val',
        });
        const ctx = await getTraceContext(provider);
        expect(ctx.traceparent).toBe('00-abc-def-01');
        expect(ctx.tracestate).toBe('vendor=val');
    });

    it('chama o provider assincrono e retorna trace context', async () => {
        const provider = async () => ({
            traceparent: '00-xyz-123-01',
        });
        const ctx = await getTraceContext(provider);
        expect(ctx.traceparent).toBe('00-xyz-123-01');
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// F73 — createTelemetryConfig
// ═════════════════════════════════════════════════════════════════════════════

describe('F73 - createTelemetryConfig', () => {
    it('cria config valido com otlp-http', () => {
        const cfg = createTelemetryConfig({
            exporterType: 'otlp-http',
            otlpEndpoint: 'http://localhost:4318',
            sourceName: 'test',
        });
        expect(cfg.exporterType).toBe('otlp-http');
        expect(cfg.otlpEndpoint).toBe('http://localhost:4318');
        expect(cfg.sourceName).toBe('test');
    });

    it('cria config valido com file exporter', () => {
        const cfg = createTelemetryConfig({
            exporterType: 'file',
            filePath: '/tmp/traces.jsonl',
        });
        expect(cfg.exporterType).toBe('file');
        expect(cfg.filePath).toBe('/tmp/traces.jsonl');
    });

    it('aceita config sem exporterType (undefined)', () => {
        const cfg = createTelemetryConfig({
            otlpEndpoint: 'http://localhost:4318',
        });
        expect(cfg.otlpEndpoint).toBe('http://localhost:4318');
        expect(cfg.exporterType).toBeUndefined();
    });

    it('rejeita exporterType invalido', () => {
        expect(() =>
            createTelemetryConfig({
                exporterType: 'grpc',
                otlpEndpoint: 'http://localhost:4317',
            }),
        ).toThrow('invalid exporterType');
    });

    it('rejeita null/undefined como options', () => {
        expect(() => createTelemetryConfig(/** @type {any} */ (null))).toThrow('non-null object');
        expect(() => createTelemetryConfig(/** @type {any} */ (undefined))).toThrow('non-null object');
    });

    it('retorna shallow copy (nao o mesmo objeto)', () => {
        const input = { exporterType: /** @type {const} */ ('file'), filePath: '/tmp/t.jsonl' };
        const output = createTelemetryConfig(input);
        expect(output).not.toBe(input);
        expect(output).toEqual(input);
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// F73b — createOtlpTelemetry
// ═════════════════════════════════════════════════════════════════════════════

describe('F73b - createOtlpTelemetry', () => {
    it('cria config OTLP com endpoint obrigatorio', () => {
        const cfg = createOtlpTelemetry({ endpoint: 'http://localhost:4318' });
        expect(cfg.exporterType).toBe('otlp-http');
        expect(cfg.otlpEndpoint).toBe('http://localhost:4318');
    });

    it('inclui sourceName e captureContent quando fornecidos', () => {
        const cfg = createOtlpTelemetry({
            endpoint: 'http://localhost:4318',
            sourceName: 'my-app',
            captureContent: true,
        });
        expect(cfg.sourceName).toBe('my-app');
        expect(cfg.captureContent).toBe(true);
    });

    it('nao inclui sourceName e captureContent quando undefined', () => {
        const cfg = createOtlpTelemetry({ endpoint: 'http://localhost:4318' });
        expect(cfg).not.toHaveProperty('sourceName');
        expect(cfg).not.toHaveProperty('captureContent');
    });

    it('rejeita endpoint vazio', () => {
        expect(() => createOtlpTelemetry({ endpoint: '' })).toThrow('endpoint is required');
    });

    it('rejeita endpoint nao-string', () => {
        expect(() => createOtlpTelemetry({ endpoint: /** @type {any} */ (123) })).toThrow('endpoint is required');
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// F73c — createFileTelemetry
// ═════════════════════════════════════════════════════════════════════════════

describe('F73c - createFileTelemetry', () => {
    it('cria config file com filePath obrigatorio', () => {
        const cfg = createFileTelemetry({ filePath: '/tmp/traces.jsonl' });
        expect(cfg.exporterType).toBe('file');
        expect(cfg.filePath).toBe('/tmp/traces.jsonl');
    });

    it('inclui sourceName quando fornecido', () => {
        const cfg = createFileTelemetry({
            filePath: '/tmp/t.jsonl',
            sourceName: 'debug',
        });
        expect(cfg.sourceName).toBe('debug');
    });

    it('nao inclui captureContent quando undefined', () => {
        const cfg = createFileTelemetry({ filePath: '/tmp/t.jsonl' });
        expect(cfg).not.toHaveProperty('captureContent');
    });

    it('rejeita filePath vazio', () => {
        expect(() => createFileTelemetry({ filePath: '' })).toThrow('filePath is required');
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// F74 — createStaticTraceProvider
// ═════════════════════════════════════════════════════════════════════════════

describe('F74 - createStaticTraceProvider', () => {
    it('cria provider com traceparent', async () => {
        const provider = createStaticTraceProvider('00-abc-def-01');
        const ctx = await getTraceContext(provider);
        expect(ctx.traceparent).toBe('00-abc-def-01');
    });

    it('cria provider com traceparent e tracestate', async () => {
        const provider = createStaticTraceProvider('00-abc-def-01', 'vendor1=value1');
        const ctx = await getTraceContext(provider);
        expect(ctx.traceparent).toBe('00-abc-def-01');
        expect(ctx.tracestate).toBe('vendor1=value1');
    });

    it('nao inclui tracestate quando undefined', async () => {
        const provider = createStaticTraceProvider('00-abc-def-01');
        const ctx = await provider();
        expect(ctx).not.toHaveProperty('tracestate');
    });

    it('rejeita traceparent vazio', () => {
        expect(() => createStaticTraceProvider('')).toThrow('traceparent is required');
    });

    it('rejeita traceparent nao-string', () => {
        expect(() => createStaticTraceProvider(/** @type {any} */ (42))).toThrow('traceparent is required');
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// F75 — Trace context propagation (integracao)
// ═════════════════════════════════════════════════════════════════════════════

describe('F75 - Trace context propagation', () => {
    it('getTraceContext com createStaticTraceProvider round-trip', async () => {
        const tp = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
        const ts = 'congo=Asgard';
        const provider = createStaticTraceProvider(tp, ts);
        const ctx = await getTraceContext(provider);
        expect(ctx.traceparent).toBe(tp);
        expect(ctx.tracestate).toBe(ts);
    });

    it('provider pode retornar Promise (async)', async () => {
        const asyncProvider = async () => ({
            traceparent: '00-async-trace-01',
            tracestate: 'key=val',
        });
        const ctx = await getTraceContext(asyncProvider);
        expect(ctx.traceparent).toBe('00-async-trace-01');
        expect(ctx.tracestate).toBe('key=val');
    });

    it('provider que retorna apenas traceparent funciona', async () => {
        const provider = () => ({ traceparent: '00-minimal-01' });
        const ctx = await getTraceContext(provider);
        expect(ctx.traceparent).toBe('00-minimal-01');
        expect(ctx.tracestate).toBeUndefined();
    });

    it('createTelemetryConfig preserva captureContent=false', () => {
        const cfg = createTelemetryConfig({
            exporterType: 'otlp-http',
            otlpEndpoint: 'http://localhost:4318',
            captureContent: false,
        });
        expect(cfg.captureContent).toBe(false);
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// Barrel exports
// ═════════════════════════════════════════════════════════════════════════════

describe('Barrel - Faixa 13 exports', () => {
    it('barrel exporta todas as funcoes de telemetry', async () => {
        const barrel = await import('#copilot/sdk/index.js');
        expect(typeof barrel.getTraceContext).toBe('function');
        expect(typeof barrel.createOtlpTelemetry).toBe('function');
        expect(typeof barrel.createFileTelemetry).toBe('function');
        expect(typeof barrel.createTelemetryConfig).toBe('function');
        expect(typeof barrel.createStaticTraceProvider).toBe('function');
    });
});
