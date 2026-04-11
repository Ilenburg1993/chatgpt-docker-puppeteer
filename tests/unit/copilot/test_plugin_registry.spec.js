// @ts-check
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('copilot/plugins/PluginRegistry', () => {
    /** @returns {Promise<import('#copilot/plugins').PluginRegistry>} */
    async function makeRegistry() {
        const { createPluginRegistry } = await import('../../../src/copilot/plugins/plugin-registry.js');
        return createPluginRegistry();
    }

    /** @param {string} name */
    function fakePlugin(name) {
        return {
            name,
            type: /** @type {const} */ ('tool'),
            install: () => {},
        };
    }

    it('register + has', async () => {
        const reg = await makeRegistry();
        reg.register(fakePlugin('foo'));
        assert.ok(reg.has('foo'));
        assert.ok(!reg.has('bar'));
    });

    it('register duplicado lança erro', async () => {
        const reg = await makeRegistry();
        reg.register(fakePlugin('dup'));
        assert.throws(() => reg.register(fakePlugin('dup')), /already registered/);
    });

    it('register inválido lança TypeError', async () => {
        const reg = await makeRegistry();
        assert.throws(() => reg.register(/** @type {any} */ ({})), /must have name/);
        assert.throws(() => reg.register(/** @type {any} */ ({ name: 'x' })), /must have name/);
    });

    it('list() retorna array com metadata', async () => {
        const reg = await makeRegistry();
        reg.register(fakePlugin('a'));
        reg.register({ name: 'b', type: /** @type {const} */ ('hook'), install: () => {} });
        const list = reg.list();
        assert.equal(list.length, 2);
        assert.equal(list[0].name, 'a');
        assert.equal(list[0].type, 'tool');
        assert.equal(list[0].installed, false);
    });

    it('install() instala plugin e marca como installed', async () => {
        const reg = await makeRegistry();
        let called = false;
        reg.register({
            name: 'inst',
            type: /** @type {const} */ ('service'),
            install: () => {
                called = true;
            },
        });
        const { createContainer } = await import('../../../src/copilot/core/di.js');
        const container = createContainer();
        await reg.install('inst', container);
        assert.ok(called);
        assert.equal(reg.list()[0].installed, true);
    });

    it('install() plugin não encontrado lança erro', async () => {
        const reg = await makeRegistry();
        const { createContainer } = await import('../../../src/copilot/core/di.js');
        await assert.rejects(() => reg.install('nope', createContainer()), /not found/);
    });

    it('install() plugin já instalado é idempotente', async () => {
        const reg = await makeRegistry();
        let count = 0;
        reg.register({
            name: 'idem',
            type: /** @type {const} */ ('tool'),
            install: () => {
                count++;
            },
        });
        const { createContainer } = await import('../../../src/copilot/core/di.js');
        const container = createContainer();
        await reg.install('idem', container);
        await reg.install('idem', container);
        assert.equal(count, 1, 'install deve rodar apenas 1 vez');
    });

    it('installAll() instala todos os registrados', async () => {
        const reg = await makeRegistry();
        const installed = [];
        reg.register({
            name: 'x',
            type: /** @type {const} */ ('tool'),
            install: () => {
                installed.push('x');
            },
        });
        reg.register({
            name: 'y',
            type: /** @type {const} */ ('hook'),
            install: () => {
                installed.push('y');
            },
        });
        const { createContainer } = await import('../../../src/copilot/core/di.js');
        await reg.installAll(createContainer());
        assert.deepEqual(installed, ['x', 'y']);
    });

    it('size retorna contagem', async () => {
        const reg = await makeRegistry();
        assert.equal(reg.size, 0);
        reg.register(fakePlugin('s1'));
        assert.equal(reg.size, 1);
    });

    it('get() retorna plugin ou undefined', async () => {
        const reg = await makeRegistry();
        const p = fakePlugin('g1');
        reg.register(p);
        assert.equal(reg.get('g1'), p);
        assert.equal(reg.get('nope'), undefined);
    });

    it('clear() limpa registry', async () => {
        const reg = await makeRegistry();
        reg.register(fakePlugin('c1'));
        reg.clear();
        assert.equal(reg.size, 0);
        assert.ok(!reg.has('c1'));
    });

    it('N-2c: install() rejeita se dependência não instalada', async () => {
        const reg = await makeRegistry();
        reg.register(fakePlugin('base'));
        reg.register({
            name: 'dep-child',
            type: /** @type {const} */ ('tool'),
            install: () => {},
            dependencies: ['base'],
        });
        const { createContainer } = await import('../../../src/copilot/core/di.js');
        const container = createContainer();
        // base não instalado → deve rejeitar
        await assert.rejects(() => reg.install('dep-child', container), /requires "base"/);
        // instalar base primeiro → funciona
        await reg.install('base', container);
        await reg.install('dep-child', container);
        assert.equal(reg.list().find((p) => p.name === 'dep-child')?.installed, true);
    });

    it('N-2e: activatePlugins() instala apenas os nomes fornecidos', async () => {
        const { activatePlugins } = await import('../../../src/copilot/plugins/plugin-registry.js');
        const reg = await makeRegistry();
        const installed = [];
        reg.register({
            name: 'alpha',
            type: /** @type {const} */ ('tool'),
            install: () => { installed.push('alpha'); },
        });
        reg.register({
            name: 'beta',
            type: /** @type {const} */ ('hook'),
            install: () => { installed.push('beta'); },
        });
        reg.register({
            name: 'gamma',
            type: /** @type {const} */ ('service'),
            install: () => { installed.push('gamma'); },
        });
        const { createContainer } = await import('../../../src/copilot/core/di.js');
        const result = await activatePlugins(reg, createContainer(), ['alpha', 'gamma']);
        assert.deepEqual(result, ['alpha', 'gamma']);
        assert.deepEqual(installed, ['alpha', 'gamma']);
    });

    it('N-2e: activatePlugins() sem whitelist instala todos', async () => {
        const { activatePlugins } = await import('../../../src/copilot/plugins/plugin-registry.js');
        const reg = await makeRegistry();
        reg.register({
            name: 'all1',
            type: /** @type {const} */ ('tool'),
            install: () => {},
        });
        reg.register({
            name: 'all2',
            type: /** @type {const} */ ('hook'),
            install: () => {},
        });
        const { createContainer } = await import('../../../src/copilot/core/di.js');
        const result = await activatePlugins(reg, createContainer());
        assert.equal(result.length, 2);
        assert.ok(result.includes('all1'));
        assert.ok(result.includes('all2'));
    });
});
