// @ts-check
/**
 * tests/unit/copilot/test_hooks_registry.spec.js
 *
 * Testes unitários para src/copilot/hooks/registry.js (HookRegistry).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('HookRegistry', () => {
    it('instancia sem erros com registry vazio', async () => {
        const { HookRegistry } = await import('../../../src/copilot/hooks/registry.js');
        const reg = new HookRegistry();
        assert.equal(reg.list().length, 0, 'Registry novo deve estar vazio');
    });

    it('register adiciona hook com schema', async () => {
        const { HookRegistry } = await import('../../../src/copilot/hooks/registry.js');
        const reg = new HookRegistry();

        reg.register('onPreToolUse', {
            description: 'Chamado antes de executar tool',
            inputFields: ['tool.name', 'tool.input'],
            outputFields: ['decision'],
        });

        assert.equal(reg.list().length, 1, 'Deve ter 1 hook registrado');
    });

    it('get retorna schema do hook registrado', async () => {
        const { HookRegistry } = await import('../../../src/copilot/hooks/registry.js');
        const reg = new HookRegistry();

        reg.register('onSessionStart', {
            description: 'Início de sessão',
            inputFields: ['sessionId'],
            outputFields: [],
        });

        const schema = reg.get('onSessionStart');
        assert.ok(schema, 'Deve retornar schema');
        assert.equal(schema.name, 'onSessionStart', 'name deve estar correto');
        assert.equal(schema.description, 'Início de sessão');
    });

    it('get retorna undefined para hook não registrado', async () => {
        const { HookRegistry } = await import('../../../src/copilot/hooks/registry.js');
        const reg = new HookRegistry();
        assert.equal(reg.get('inexistente'), undefined, 'Deve retornar undefined para hook não registrado');
    });

    it('list retorna todos os schemas registrados', async () => {
        const { HookRegistry } = await import('../../../src/copilot/hooks/registry.js');
        const reg = new HookRegistry();

        reg.register('hook1', { description: 'h1', inputFields: [], outputFields: [] });
        reg.register('hook2', { description: 'h2', inputFields: [], outputFields: [] });
        reg.register('hook3', { description: 'h3', inputFields: [], outputFields: [] });

        const all = reg.list();
        assert.equal(all.length, 3, 'Deve listar 3 hooks');
        const names = all.map((s) => s.name);
        assert.ok(names.includes('hook1'));
        assert.ok(names.includes('hook2'));
        assert.ok(names.includes('hook3'));
    });
});
