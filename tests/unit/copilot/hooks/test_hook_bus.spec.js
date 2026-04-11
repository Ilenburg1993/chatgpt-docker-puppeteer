// @ts-check
/**
 * tests/unit/copilot/hooks/test_hook_bus.spec.js
 *
 * Testes unitários para src/copilot/hooks/bus.js (HookBus).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// Stub do log para evitar saída durante testes
process.env.LOG_LEVEL = 'silent';

describe('HookBus', () => {
    it('instancia sem erros', async () => {
        const { HookBus } = await import('../../../../src/copilot/hooks/bus.js');
        const bus = new HookBus();
        assert.ok(bus, 'Deve criar instância de HookBus');
    });

    it('emitHook dispara listener registrado', async () => {
        const { HookBus } = await import('../../../../src/copilot/hooks/bus.js');
        const bus = new HookBus();
        let received = null;

        bus.on('pre_tool_use', (evt) => {
            received = evt;
        });

        bus.emitHook('pre_tool_use', 'session-123', { tool: 'bash' }, null);

        assert.ok(received, 'Listener deve ter recebido o evento');
        assert.equal(received.hookName, 'pre_tool_use', 'hookName deve ser correto');
        assert.equal(received.sessionId, 'session-123', 'sessionId deve ser correto');
        assert.deepEqual(received.input, { tool: 'bash' }, 'input deve ser passado');
    });

    it('emitHook dispara wildcard listener', async () => {
        const { HookBus } = await import('../../../../src/copilot/hooks/bus.js');
        const bus = new HookBus();
        const events = [];

        bus.on('*', (evt) => events.push(evt.hookName));

        bus.emitHook('session_start', 'sid', {}, null);
        bus.emitHook('session_end', 'sid', {}, null);

        assert.deepEqual(events, ['session_start', 'session_end'], 'Wildcard deve capturar todos os eventos');
    });

    it('defaultBus é instância de HookBus', async () => {
        const { defaultBus, HookBus } = await import('../../../../src/copilot/hooks/bus.js');
        assert.ok(defaultBus instanceof HookBus, 'defaultBus deve ser instância de HookBus');
    });

    it('attachBus envolve onPreToolUse existente', async () => {
        const { HookBus, attachBus } = await import('../../../../src/copilot/hooks/bus.js');
        const bus = new HookBus();
        const calls = [];

        /** @type {import('../../../../src/copilot/hooks/types.js').SessionHooks} */
        const hooks = {
            onPreToolUse: async (input, _inv) => {
                calls.push('orig');
                return { decision: 'allow' };
            },
        };

        const wrapped = attachBus(hooks, bus);

        let busEvent = null;
        bus.on('pre_tool_use', (e) => {
            busEvent = e;
        });

        await wrapped.onPreToolUse?.({ tool: { name: 'bash', input: {} }, decision: 'allow' }, { sessionId: 's1' });

        assert.deepEqual(calls, ['orig'], 'Handler original deve ter sido chamado');
        assert.ok(busEvent, 'Bus deve ter recebido o evento');
    });

    it('emitHook captura exceção de listener sem propagar', async () => {
        const { HookBus } = await import('../../../../src/copilot/hooks/bus.js');
        const bus = new HookBus();

        bus.on('error_occurred', () => {
            throw new Error('listener error');
        });

        // Não deve lançar exceção
        assert.doesNotThrow(() => {
            bus.emitHook('error_occurred', 'sid', {}, null);
        });
    });
});
