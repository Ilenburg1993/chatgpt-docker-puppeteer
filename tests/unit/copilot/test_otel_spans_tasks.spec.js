// @ts-check
/**
 * tests/unit/copilot/test_otel_spans_tasks.spec.js
 *
 * F29.4 — Validar que OTEL spans são criados para tasks não-dialog.
 *
 * Verifica que o agent-event-observer invoca startSpanImmediate para dialog turns (que incluem tasks via sendMessage) e
 * que otel.js exporta a API necessária.
 */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

describe('F29.4 — OTEL spans para tasks não-dialog', async () => {
    /** @type {typeof import('../../../src/copilot/observability/otel.js')} */
    let otel;

    /** @type {string} */
    let observerSource = '';

    beforeAll(async () => {
        const { readFile } = await import('node:fs/promises');
        otel = await import('../../../src/copilot/observability/otel.js');
        // O observer foi decomposto em sub-módulos; ler todos para inspeção
        const base = new URL('../../../src/copilot/observability/', import.meta.url);
        const files = [
            'agent-event-observer.js',
            'observers/dialog-task-handlers.js',
            'observers/session-agent-handlers.js',
        ];
        const parts = await Promise.all(
            files.map(async (f) => {
                try { return await readFile(new URL(f, base), 'utf-8'); } catch { return ''; }
            }),
        );
        observerSource = parts.join('\n');
    });

    it('otel.js deve exportar startSpanImmediate', () => {
        assert.equal(typeof otel.startSpanImmediate, 'function');
    });

    it('otel.js deve exportar startSpan', () => {
        assert.equal(typeof otel.startSpan, 'function');
    });

    it('otel.js deve exportar buildTelemetryConfig', () => {
        assert.equal(typeof otel.buildTelemetryConfig, 'function');
    });

    it('startSpanImmediate deve retornar null quando OTEL não disponível', () => {
        // Sem @opentelemetry/sdk-trace-node instalado, retorna null
        const span = otel.startSpanImmediate('test.span', { key: 'value' });
        assert.equal(span, null);
    });

    it('startSpan deve executar fn diretamente quando OTEL não disponível', async () => {
        let executed = false;
        const result = await otel.startSpan('test', {}, async () => {
            executed = true;
            return 42;
        });
        assert.ok(executed);
        assert.equal(result, 42);
    });

    it('agent-event-observer deve usar startSpanImmediate em dialog.turn_start', () => {
        assert.ok(
            observerSource.includes("startSpanImmediate('copilot.dialog.turn'"),
            'observer deve criar span OTEL para dialog turns',
        );
    });

    it('agent-event-observer deve fechar span em dialog.turn_end', () => {
        assert.ok(
            observerSource.includes('entry.span.end()') || observerSource.includes('entry?.span'),
            'observer deve fechar span OTEL no turn_end',
        );
    });

    it('agent-event-observer deve registrar handler para task.completed', () => {
        assert.ok(observerSource.includes("'task.completed'"), 'observer deve escutar task.completed para métricas');
    });

    it('agent-event-observer deve registrar handler para task.error', () => {
        assert.ok(observerSource.includes("'task.error'"), 'observer deve escutar task.error para métricas');
    });

    it('createAgentEventObserver deve aceitar métricas mock e funcionar', async () => {
        const { createAgentEventObserver } = await import('../../../src/copilot/observability/agent-event-observer.js');
        const calls = new Map();
        /** @param {string} m @returns {(...a: any[]) => void} */
        const rec =
            (m) =>
            (...a) => {
                if (!calls.has(m)) calls.set(m, []);
                calls.get(m)?.push(a);
            };
        const metrics = /** @type {any} */ ({
            recordDialogTurn: rec('recordDialogTurn'),
            recordDialogStall: rec('recordDialogStall'),
            recordDialogTimeout: rec('recordDialogTimeout'),
            recordTaskCompletion: rec('recordTaskCompletion'),
            recordSessionError: rec('recordSessionError'),
            recordCounter: rec('recordCounter'),
            recordGauge: rec('recordGauge'),
            recordToolCall: rec('recordToolCall'),
            recordStreamingChunk: rec('recordStreamingChunk'),
            recordUsage: rec('recordUsage'),
        });

        const observer = createAgentEventObserver({ metrics });
        const agent = new EventEmitter();
        observer.attach(agent);

        // Simular task.completed — deve gravar métrica
        agent.emit('task.completed', { durationMs: 100, taskId: 't1' });
        assert.ok(calls.has('recordTaskCompletion'), 'task.completed deve gravar métrica');

        observer.detach();
    });
});
