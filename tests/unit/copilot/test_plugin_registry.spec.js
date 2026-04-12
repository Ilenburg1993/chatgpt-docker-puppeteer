// @ts-check
import { describe, it, expect } from 'vitest';

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
        expect(reg.has('foo')).toBe(true);
        expect(reg.has('bar')).toBe(false);
    });

    it('register duplicado lança erro', async () => {
        const reg = await makeRegistry();
        reg.register(fakePlugin('dup'));
        expect(() => reg.register(fakePlugin('dup'))).toThrow(/already registered/);
    });

    it('register inválido lança TypeError', async () => {
        const reg = await makeRegistry();
        expect(() => reg.register(/** @type {any} */ ({}))).toThrow(/must have name/);
        expect(() => reg.register(/** @type {any} */ ({ name: 'x' }))).toThrow(/must have name/);
    });

    it('list() retorna array com metadata', async () => {
        const reg = await makeRegistry();
        reg.register(fakePlugin('a'));
        reg.register({ name: 'b', type: /** @type {const} */ ('hook'), install: () => {} });
        const list = reg.list();
        expect(list.length).toBe(2);
        expect(list[0].name).toBe('a');
        expect(list[0].type).toBe('tool');
        expect(list[0].installed).toBe(false);
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
        expect(called).toBe(true);
        expect(reg.list()[0].installed).toBe(true);
    });

    it('install() plugin não encontrado lança erro', async () => {
        const reg = await makeRegistry();
        const { createContainer } = await import('../../../src/copilot/core/di.js');
        await expect(reg.install('nope', createContainer())).rejects.toThrow(/not found/);
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
        expect(count).toBe(1);
    });

    it('installAll() instala todos os registrados', async () => {
        const reg = await makeRegistry();
        const installed = /** @type {string[]} */ ([]);
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
        expect(installed).toEqual(['x', 'y']);
    });

    it('size retorna contagem', async () => {
        const reg = await makeRegistry();
        expect(reg.size).toBe(0);
        reg.register(fakePlugin('s1'));
        expect(reg.size).toBe(1);
    });

    it('get() retorna plugin ou undefined', async () => {
        const reg = await makeRegistry();
        const p = fakePlugin('g1');
        reg.register(p);
        expect(reg.get('g1')).toBe(p);
        expect(reg.get('nope')).toBeUndefined();
    });

    it('clear() limpa registry', async () => {
        const reg = await makeRegistry();
        reg.register(fakePlugin('c1'));
        reg.clear();
        expect(reg.size).toBe(0);
        expect(reg.has('c1')).toBe(false);
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
        await expect(reg.install('dep-child', container)).rejects.toThrow(/requires "base"/);
        // instalar base primeiro → funciona
        await reg.install('base', container);
        await reg.install('dep-child', container);
        expect(reg.list().find((p) => p.name === 'dep-child')?.installed).toBe(true);
    });

    it('N-2e: activatePlugins() instala apenas os nomes fornecidos', async () => {
        const { activatePlugins } = await import('../../../src/copilot/plugins/plugin-registry.js');
        const reg = await makeRegistry();
        const installed = /** @type {string[]} */ ([]);
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
        expect(result).toEqual(['alpha', 'gamma']);
        expect(installed).toEqual(['alpha', 'gamma']);
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
        expect(result.length).toBe(2);
        expect(result).toContain('all1');
        expect(result).toContain('all2');
    });
});
