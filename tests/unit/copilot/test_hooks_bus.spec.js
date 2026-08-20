// @ts-check
/**
 * tests/unit/copilot/test_hooks_bus.spec.js
 *
 * Testes unitários para src/copilot/hooks/bus.js (HookBus e attachBus). Cobre: emissão de eventos, wildcard listener,
 * captura de erros de listener.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

describe('HookBus — emissão e escuta', () => {
    it('instancia sem erros', async () => {
        const { HookBus } = await import('../../../src/copilot/hooks/bus.js');
        const bus = new HookBus();
        assert.ok(bus, 'Deve criar instância de HookBus');
    });

    it('emitHook dispara listener registrado com dados corretos', async () => {
        const { HookBus } = await import('../../../src/copilot/hooks/bus.js');
        const bus = new HookBus();
        /** @type {any} */
        let received = null;

        bus.on('pre_tool_use', (evt) => {
            received = evt;
        });

        bus.emitHook('pre_tool_use', 'session-abc', { tool: 'bash' }, null);

        assert.ok(received !== null, 'Listener deve ter recebido o evento');
        assert.equal(received.hookName, 'pre_tool_use');
        assert.equal(received.sessionId, 'session-abc');
        assert.equal(received.input.tool, 'bash');
        assert.equal(received.input.sessionId, 'session-abc');
        assert.ok(received.input.timestamp instanceof Date);
        assert.equal(received.output, null);
        assert.ok(typeof received.timestamp === 'number', 'Deve conter timestamp');
    });

    it('emitHook dispara wildcard listener', async () => {
        const { HookBus } = await import('../../../src/copilot/hooks/bus.js');
        const bus = new HookBus();
        /** @type {string[]} */
        const names = [];

        bus.on('*', (evt) => names.push(evt.hookName));

        bus.emitHook('session_start', 's1', {}, null);
        bus.emitHook('session_end', 's1', {}, null);

        assert.deepEqual(names, ['session_start', 'session_end']);
    });

    it('defaultBus é instância singleton de HookBus', async () => {
        const { defaultBus, HookBus } = await import('../../../src/copilot/hooks/bus.js');
        assert.ok(defaultBus instanceof HookBus, 'defaultBus deve ser instância de HookBus');
    });

    it('emitHook não propaga exceção de listener com erro', async () => {
        const { HookBus } = await import('../../../src/copilot/hooks/bus.js');
        const bus = new HookBus();

        bus.on('error_occurred', () => {
            throw new Error('falha no listener');
        });

        assert.doesNotThrow(() => {
            bus.emitHook('error_occurred', 'sid', {}, null);
        }, 'emitHook deve capturar erros de listeners internos');
    });

    it('enriquece hook:error_occurred no EventBus com mensagem normalizada', async () => {
        const { HookBus } = await import('../../../src/copilot/hooks/bus.js');
        const { createEventBus } = await import('../../../src/copilot/core/event-bus.js');
        const bus = new HookBus();
        const eventBus = createEventBus();
        /** @type {any[]} */
        const events = [];
        eventBus.on('hook:error_occurred', (evt) => {
            events.push(evt);
        });
        bus.setEventBus(eventBus);

        bus.emitHook(
            'error_occurred',
            'sid',
            { error: {}, errorContext: 'model_call', recoverable: true },
            { errorHandling: 'retry' },
        );

        assert.equal(events.length, 1);
        assert.equal(events[0]?.errorContext, 'model_call');
        assert.equal(events[0]?.recoverable, true);
        assert.equal(events[0]?.errorMessage, 'Erro do SDK sem mensagem estruturada.');
    });
});

describe('attachBus — envolve SessionHooks', () => {
    it('attachBus preserva handler original e publica no bus', async () => {
        const { HookBus, attachBus } = await import('../../../src/copilot/hooks/bus.js');
        const bus = new HookBus();
        /** @type {string[]} */
        const origCalls = [];

        /** @type {any} */
        const hooks = {
            onPreToolUse: async (
                /** @type {import('../../../src/copilot/hooks/types.js').PreToolUseHookInput} */ _input,
                /** @type {import('../../../src/copilot/hooks/types.js').InvocationContext} */ _inv,
            ) => {
                origCalls.push('called');
                return { decision: 'allow' };
            },
        };

        const wrapped = attachBus(hooks, bus);

        /** @type {any} */
        let busEvent = null;
        bus.on('pre_tool_use', (e) => {
            busEvent = e;
        });

        await wrapped.onPreToolUse?.(
            {
                toolName: 'bash',
                toolArgs: {},
                sessionId: 's1',
                timestamp: new Date(),
                workingDirectory: process.cwd(),
            },
            { sessionId: 's1' },
        );

        assert.deepEqual(origCalls, ['called']);
        assert.ok(busEvent !== null, 'Bus deve ter recebido evento');
        assert.equal(busEvent.sessionId, 's1');
    });

    it('attachBus retorna hooks mesclados com handlers não-alterados', async () => {
        const { HookBus, attachBus } = await import('../../../src/copilot/hooks/bus.js');
        const bus = new HookBus();

        const original = {
            onSessionStart: async () => undefined,
            onSessionEnd: async () => undefined,
        };
        const wrapped = attachBus(original, bus);

        assert.equal(typeof wrapped.onSessionStart, 'function', 'onSessionStart deve estar nos hooks');
        assert.equal(typeof wrapped.onSessionEnd, 'function', 'onSessionEnd deve estar nos hooks');
    });
});
