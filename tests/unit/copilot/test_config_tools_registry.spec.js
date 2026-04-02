// @ts-check
/**
 * tests/unit/copilot/test_config_tools_registry.spec.js
 *
 * Testes unitários para config/tools/registry.js (custom-tools-registry). Cobre: registerCustomTool, removeCustomTool,
 * getCustomToolDefinitions, buildCustomTools.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import {
    BUILTIN_HANDLER_MAP,
    _resetRegistry,
    buildCustomTools,
    getCustomToolDefinitions,
    registerCustomTool,
    removeCustomTool,
} from '../../../src/copilot/config/tools/registry.js';

describe('config/tools/registry › registerCustomTool', () => {
    beforeEach(() => {
        _resetRegistry();
    });

    it('registra uma tool com handlerId válido e retorna ok:true', () => {
        const result = registerCustomTool({
            name: 'echo_test',
            description: 'Eco de teste',
            handlerId: 'echo',
        });
        assert.equal(result.ok, true);
        assert.equal(result.error, undefined);
    });

    it('a tool registrada aparece em getCustomToolDefinitions', () => {
        registerCustomTool({ name: 'ts_tool', description: 'ts', handlerId: 'timestamp' });
        const defs = getCustomToolDefinitions();
        const found = defs.find((d) => d.name === 'ts_tool');
        assert.ok(found !== undefined);
        assert.equal(found.handlerId, 'timestamp');
    });

    it('retorna ok:false para handlerId desconhecido', () => {
        const result = registerCustomTool({
            name: 'bad_handler',
            description: 'test',
            handlerId: 'nao_existe_xpto',
        });
        assert.equal(result.ok, false);
        assert.ok(typeof result.error === 'string');
        assert.ok(result.error.includes('handlerId'));
    });

    it('retorna ok:false para name inválido (com maiúsculas)', () => {
        const result = registerCustomTool({
            name: 'BadName',
            description: 'test',
            handlerId: 'echo',
        });
        assert.equal(result.ok, false);
        assert.ok(typeof result.error === 'string');
    });

    it('retorna ok:false para name vazio', () => {
        const result = registerCustomTool({
            name: '',
            description: 'test',
            handlerId: 'echo',
        });
        assert.equal(result.ok, false);
    });

    it('sobrescreve tool existente com mesmo nome', () => {
        registerCustomTool({ name: 'dupe_tool', description: 'v1', handlerId: 'echo' });
        registerCustomTool({ name: 'dupe_tool', description: 'v2', handlerId: 'timestamp' });
        const defs = getCustomToolDefinitions().filter((d) => d.name === 'dupe_tool');
        assert.equal(defs.length, 1);
        assert.equal(defs[0].handlerId, 'timestamp');
    });

    it('registra tool com parameters opcionais', () => {
        const result = registerCustomTool({
            name: 'with_params',
            description: 'test params',
            handlerId: 'echo',
            parameters: { text: { type: 'string' } },
        });
        assert.equal(result.ok, true);
        const defs = getCustomToolDefinitions();
        const found = defs.find((d) => d.name === 'with_params');
        assert.ok(found?.parameters !== undefined);
    });
});

describe('config/tools/registry › removeCustomTool', () => {
    beforeEach(() => {
        _resetRegistry();
    });

    it('remove tool existente e retorna ok:true', () => {
        registerCustomTool({ name: 'rm_me', description: 'test', handlerId: 'echo' });
        const result = removeCustomTool('rm_me');
        assert.equal(result.ok, true);
        const defs = getCustomToolDefinitions();
        assert.ok(defs.find((d) => d.name === 'rm_me') === undefined);
    });

    it('retorna ok:false para tool inexistente', () => {
        const result = removeCustomTool('nao_existe_xyz');
        assert.equal(result.ok, false);
        assert.ok(typeof result.error === 'string');
    });
});

describe('config/tools/registry › getCustomToolDefinitions', () => {
    beforeEach(() => {
        _resetRegistry();
    });

    it('retorna array vazio quando registry está vazio', () => {
        const defs = getCustomToolDefinitions();
        assert.ok(Array.isArray(defs));
        assert.equal(defs.length, 0);
    });

    it('retorna cópia — mutações não afetam o registry interno', () => {
        registerCustomTool({ name: 'no_mut', description: 'test', handlerId: 'echo' });
        const defs = getCustomToolDefinitions();
        defs.push({ name: 'injected', description: 'hack', handlerId: 'echo' });
        assert.equal(getCustomToolDefinitions().length, 1);
    });
});

describe('config/tools/registry › buildCustomTools', () => {
    beforeEach(() => {
        _resetRegistry();
    });

    it('retorna array vazio quando registry está vazio', () => {
        const tools = buildCustomTools();
        assert.ok(Array.isArray(tools));
        assert.equal(tools.length, 0);
    });

    it('retorna instância de Tool para cada tool registrada com handler válido', () => {
        registerCustomTool({ name: 'echo_built', description: 'echo', handlerId: 'echo' });
        registerCustomTool({ name: 'ts_built', description: 'ts', handlerId: 'timestamp' });
        const tools = buildCustomTools();
        assert.equal(tools.length, 2);
        for (const tool of tools) {
            assert.ok(typeof tool.name === 'string');
            assert.ok(typeof tool.handler === 'function');
        }
    });

    it('tool echo retorna resultado com prefixo "echo:"', async () => {
        registerCustomTool({ name: 'echo_fn', description: 'test', handlerId: 'echo' });
        const tools = buildCustomTools();
        const echoTool = tools.find((t) => t.name === 'echo_fn');
        assert.ok(echoTool !== undefined);
        const result = await echoTool.handler({ text: 'hello' });
        assert.ok(typeof result === 'string');
        assert.ok(result.startsWith('echo:'));
    });

    it('tool timestamp retorna string ISO', async () => {
        registerCustomTool({ name: 'ts_fn', description: 'ts', handlerId: 'timestamp' });
        const tools = buildCustomTools();
        const tsTool = tools.find((t) => t.name === 'ts_fn');
        assert.ok(tsTool !== undefined);
        const result = await tsTool.handler({});
        assert.ok(typeof result === 'string');
        assert.ok(!isNaN(Date.parse(result)));
    });
});

describe('config/tools/registry › BUILTIN_HANDLER_MAP', () => {
    it('contém handlers essenciais: echo, timestamp, env_read', () => {
        assert.ok(BUILTIN_HANDLER_MAP.has('echo'));
        assert.ok(BUILTIN_HANDLER_MAP.has('timestamp'));
        assert.ok(BUILTIN_HANDLER_MAP.has('env_read'));
    });

    it('todos os handlers são funções', () => {
        for (const [, handler] of BUILTIN_HANDLER_MAP) {
            assert.equal(typeof handler, 'function');
        }
    });
});
