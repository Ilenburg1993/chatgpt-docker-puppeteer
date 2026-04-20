// @ts-check
/**
 * tests/unit/copilot/test_usage_dedup.spec.js
 *
 * F30.4 — Verificar que não há contagem dupla de usage entre event-collector e agent-event-observer.
 *
 * A correção F30.3 removeu a chamada duplicada de recordUsage. Este teste valida que o agent-event-observer NÃO duplica
 * chamadas de usage quando o event-collector já as registra.
 */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it, beforeAll } from 'vitest';

describe('F30.4 — Usage dedup: sem contagem dupla', async () => {
    /** @type {string} */
    let observerSource = '';

    /** @type {string} */
    let collectorSource = '';

    beforeAll(async () => {
        const { readFile } = await import('node:fs/promises');
        const base = new URL('../../../src/copilot/observability/', import.meta.url);
        const observerFiles = [
            'agent-event-observer.js',
            'observers/dialog-task-handlers.js',
            'observers/session-agent-handlers.js',
        ];
        const [collector, ...observers] = await Promise.all([
            readFile(new URL('event-collector.js', base), 'utf-8'),
            ...observerFiles.map(async (f) => {
                try {
                    return await readFile(new URL(f, base), 'utf-8');
                } catch {
                    return '';
                }
            }),
        ]);
        collectorSource = collector;
        observerSource = observers.join('\n');
    });

    it('event-collector deve registrar assistant.usage para persistência', () => {
        assert.ok(
            collectorSource.includes("'assistant.usage'"),
            'event-collector deve escutar assistant.usage (SoT para persistência)',
        );
    });

    it('agent-event-observer deve escutar assistant.usage para runtime metrics', () => {
        assert.ok(
            observerSource.includes("'assistant.usage'") || observerSource.includes('session.usage'),
            'observer deve ter handler para usage (SoT para runtime metrics)',
        );
    });

    it('observer NÃO deve chamar recordUsage em assistant.usage diretamente (dedup F30.3)', () => {
        // O dedup foi feito removendo recordUsage do observer para assistant.usage,
        // mantendo-o apenas no event-collector (SoT para persistência).
        // O observer usa recordUsage apenas em session.usage_info (different event).
        const usageHandlerMatches = observerSource.match(/assistant\.usage['"].*?recordUsage/gs);
        // Se não encontrou match, significa que o dedup está correto
        assert.ok(
            !usageHandlerMatches || usageHandlerMatches.length === 0,
            'observer NÃO deve chamar recordUsage diretamente em assistant.usage (evita contagem dupla)',
        );
    });

    it('observer deve registrar métricas de usage via session.usage', () => {
        assert.ok(
            observerSource.includes("'session.usage'") || observerSource.includes('assistant.usage'),
            'observer deve escutar session.usage ou assistant.usage para token tracking',
        );
    });

    it('integration: um único emit de assistant.usage não causa dupla contagem', async () => {
        const { createAgentEventObserver } = await import('../../../src/copilot/observability/agent-event-observer.js');

        let usageCalls = 0;
        const metrics = /** @type {any} */ ({
            recordDialogTurn: () => {},
            recordDialogStall: () => {},
            recordDialogTimeout: () => {},
            recordTaskCompletion: () => {},
            recordSessionError: () => {},
            recordCounter: () => {},
            recordGauge: () => {},
            recordToolCall: () => {},
            recordStreamingChunk: () => {},
            recordUsage: () => {
                usageCalls++;
            },
        });

        const observer = createAgentEventObserver({ metrics });
        const agent = new EventEmitter();
        observer.attach(agent);

        // Emitir assistant.usage — observer não deve chamar recordUsage
        agent.emit('assistant.usage', { promptTokens: 100, completionTokens: 50, totalTokens: 150 });

        // Deve ter 0 chamadas de recordUsage a partir do observer para assistant.usage
        assert.equal(usageCalls, 0, 'observer não deve chamar recordUsage para assistant.usage (dedup F30.3)');

        observer.detach();
    });
});
