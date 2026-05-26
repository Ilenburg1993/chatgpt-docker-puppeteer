// @ts-check
/**
 * tests/unit/copilot/test_lib_tools_registry.spec.js
 *
 * Testes unitários para src/copilot/lib/tools-registry.js
 */
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
    createRegistry,
    excludeByNames,
    filterByNames,
    getAllTools,
    getReadOnlyTools,
    getToolByName,
    getToolCount,
    getToolsByCategory,
    getToolsByTag,
    hasToolByName,
    inspectRegistry,
    listToolNames,
    mergeRegistries,
    registerTool,
    registerTools,
} from '#copilot/sdk/tools';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Cria um mock de Tool do SDK.
 *
 * @param {string} name
 * @returns {import('@github/copilot-sdk').Tool}
 */
function mkTool(name) {
    return /** @type {any} */ ({
        name,
        description: `Ferramenta ${name}`,
        handler: () => ({}),
    });
}

// ─── createRegistry ──────────────────────────────────────────────────────────

describe('createRegistry', () => {
    it('deve criar registry vazio', () => {
        const reg = createRegistry();
        assert.ok(reg.entries instanceof Map);
        assert.equal(reg.entries.size, 0);
    });

    it('deve criar instâncias independentes', () => {
        const a = createRegistry();
        const b = createRegistry();
        registerTool(a, mkTool('t1'));
        assert.equal(b.entries.size, 0);
    });
});

// ─── registerTool ────────────────────────────────────────────────────────────

describe('registerTool', () => {
    it('deve registrar ferramenta com metadados padrão', () => {
        const reg = createRegistry();
        registerTool(reg, mkTool('lint'));
        assert.ok(reg.entries.has('lint'));
        const entry = reg.entries.get('lint');
        assert.equal(entry?.category, 'uncategorized');
        assert.deepEqual(entry?.tags, []);
        assert.equal(entry?.readOnly, false);
    });

    it('deve registrar com metadados customizados', () => {
        const reg = createRegistry();
        registerTool(reg, mkTool('git_diff'), { category: 'git', tags: ['inspect'], readOnly: true });
        const entry = reg.entries.get('git_diff');
        assert.equal(entry?.category, 'git');
        assert.deepEqual(entry?.tags, ['inspect']);
        assert.equal(entry?.readOnly, true);
    });

    it('deve sintetizar instructions canônicas quando a tool não declara instructions', () => {
        const reg = createRegistry();
        const tool = mkTool('git_diff');
        registerTool(reg, tool, { category: 'git', tags: ['inspect'], readOnly: true });
        const registered = reg.entries.get('git_diff')?.tool;
        assert.equal(registered, tool);
        assert.match(String(/** @type {any} */ (registered)?.instructions), /Use git_diff for:/);
        assert.match(String(/** @type {any} */ (registered)?.instructions), /Category: git; tags: inspect/);
        assert.match(String(/** @type {any} */ (registered)?.instructions), /Read-only/);
    });

    it('deve preservar instructions explícitas declaradas pela tool', () => {
        const reg = createRegistry();
        const tool = /** @type {any} */ ({ ...mkTool('custom'), instructions: 'Use esta tool somente para teste.' });
        registerTool(reg, tool, { category: 'custom', tags: ['test'] });
        assert.equal(/** @type {any} */ (reg.entries.get('custom')?.tool)?.instructions, 'Use esta tool somente para teste.');
    });

    it('deve substituir ferramenta com mesmo nome', () => {
        const reg = createRegistry();
        registerTool(reg, mkTool('tool'), { category: 'a' });
        registerTool(reg, mkTool('tool'), { category: 'b' });
        assert.equal(reg.entries.size, 1);
        assert.equal(reg.entries.get('tool')?.category, 'b');
    });

    it('deve lançar se registry inválido', () => {
        assert.throws(() => registerTool(/** @type {any} */ (null), mkTool('t')), /registry inválido/);
    });

    it('deve lançar se tool.name ausente', () => {
        const reg = createRegistry();
        assert.throws(
            () => registerTool(reg, /** @type {any} */ ({ description: 'sem nome', handler: () => ({}) })),
            /name \(string\) obrigatório/,
        );
    });

    it('deve lançar se tool.name é string vazia', () => {
        const reg = createRegistry();
        assert.throws(() => registerTool(reg, mkTool('')), /name \(string\) obrigatório/);
    });
});

// ─── registerTools ───────────────────────────────────────────────────────────

describe('registerTools', () => {
    it('deve registrar múltiplas ferramentas', () => {
        const reg = createRegistry();
        registerTools(reg, [mkTool('a'), mkTool('b'), mkTool('c')], { category: 'code' });
        assert.equal(reg.entries.size, 3);
        assert.equal(reg.entries.get('a')?.category, 'code');
        assert.equal(reg.entries.get('c')?.category, 'code');
    });

    it('deve aceitar array vazio sem erro', () => {
        const reg = createRegistry();
        assert.doesNotThrow(() => registerTools(reg, [], { category: 'x' }));
        assert.equal(reg.entries.size, 0);
    });

    it('deve aplicar mesmos metadados a todas as ferramentas', () => {
        const reg = createRegistry();
        registerTools(reg, [mkTool('x'), mkTool('y')], { category: 'git', tags: ['safe'], readOnly: true });
        assert.equal(reg.entries.get('x')?.readOnly, true);
        assert.equal(reg.entries.get('y')?.readOnly, true);
    });
});

// ─── getAllTools ──────────────────────────────────────────────────────────────

describe('getAllTools', () => {
    it('deve retornar todas as ferramentas', () => {
        const reg = createRegistry();
        registerTools(reg, [mkTool('a'), mkTool('b')]);
        const tools = getAllTools(reg);
        assert.equal(tools.length, 2);
        assert.ok(tools.some((t) => t.name === 'a'));
        assert.ok(tools.some((t) => t.name === 'b'));
    });

    it('deve retornar array vazio para registry vazio', () => {
        assert.deepEqual(getAllTools(createRegistry()), []);
    });
});

// ─── getToolsByCategory ───────────────────────────────────────────────────────

describe('getToolsByCategory', () => {
    it('deve retornar ferramentas da categoria especificada', () => {
        const reg = createRegistry();
        registerTools(reg, [mkTool('lint'), mkTool('typecheck')], { category: 'code' });
        registerTools(reg, [mkTool('git_diff')], { category: 'git' });
        const code = getToolsByCategory(reg, 'code');
        assert.equal(code.length, 2);
        assert.ok(code.every((t) => ['lint', 'typecheck'].includes(t.name)));
    });

    it('deve retornar array vazio para categoria inexistente', () => {
        const reg = createRegistry();
        registerTools(reg, [mkTool('t')], { category: 'x' });
        assert.deepEqual(getToolsByCategory(reg, 'desconhecida'), []);
    });
});

// ─── getToolsByTag ────────────────────────────────────────────────────────────

describe('getToolsByTag', () => {
    it('deve retornar ferramentas com a tag', () => {
        const reg = createRegistry();
        registerTool(reg, mkTool('a'), { category: 'c', tags: ['safe', 'read'] });
        registerTool(reg, mkTool('b'), { category: 'c', tags: ['write'] });
        const safe = getToolsByTag(reg, 'safe');
        assert.equal(safe.length, 1);
        assert.equal(safe[0]?.name, 'a');
    });

    it('deve retornar array vazio se nenhuma ferramenta tem a tag', () => {
        const reg = createRegistry();
        registerTool(reg, mkTool('t'), { category: 'c', tags: ['x'] });
        assert.deepEqual(getToolsByTag(reg, 'inexistente'), []);
    });
});

// ─── getReadOnlyTools ─────────────────────────────────────────────────────────

describe('getReadOnlyTools', () => {
    it('deve retornar apenas ferramentas readOnly', () => {
        const reg = createRegistry();
        registerTool(reg, mkTool('r'), { category: 'x', readOnly: true });
        registerTool(reg, mkTool('w'), { category: 'x', readOnly: false });
        const ro = getReadOnlyTools(reg);
        assert.equal(ro.length, 1);
        assert.equal(ro[0]?.name, 'r');
    });

    it('deve retornar array vazio se nenhuma é readOnly', () => {
        const reg = createRegistry();
        registerTool(reg, mkTool('w'));
        assert.deepEqual(getReadOnlyTools(reg), []);
    });
});

// ─── getToolByName ────────────────────────────────────────────────────────────

describe('getToolByName', () => {
    it('deve retornar a ferramenta pelo nome', () => {
        const reg = createRegistry();
        const t = mkTool('my_tool');
        registerTool(reg, t);
        assert.equal(getToolByName(reg, 'my_tool'), t);
    });

    it('deve retornar undefined para nome inexistente', () => {
        assert.equal(getToolByName(createRegistry(), 'nope'), undefined);
    });
});

// ─── listToolNames ────────────────────────────────────────────────────────────

describe('listToolNames', () => {
    it('deve retornar lista de nomes', () => {
        const reg = createRegistry();
        registerTools(reg, [mkTool('a'), mkTool('b'), mkTool('c')]);
        const names = listToolNames(reg);
        assert.equal(names.length, 3);
        assert.ok(names.includes('a') && names.includes('b') && names.includes('c'));
    });

    it('deve retornar array vazio para registry vazio', () => {
        assert.deepEqual(listToolNames(createRegistry()), []);
    });
});

// ─── hasToolByName ────────────────────────────────────────────────────────────

describe('hasToolByName', () => {
    it('deve retornar true para ferramenta existente', () => {
        const reg = createRegistry();
        registerTool(reg, mkTool('exists'));
        assert.equal(hasToolByName(reg, 'exists'), true);
    });

    it('deve retornar false para ferramenta inexistente', () => {
        assert.equal(hasToolByName(createRegistry(), 'nope'), false);
    });
});

// ─── getToolCount ─────────────────────────────────────────────────────────────

describe('getToolCount', () => {
    it('deve retornar 0 para registry vazio', () => {
        assert.equal(getToolCount(createRegistry()), 0);
    });

    it('deve retornar contagem correta', () => {
        const reg = createRegistry();
        registerTools(reg, [mkTool('a'), mkTool('b'), mkTool('c')]);
        assert.equal(getToolCount(reg), 3);
    });
});

// ─── mergeRegistries ──────────────────────────────────────────────────────────

describe('mergeRegistries', () => {
    it('deve mesclar dois registries', () => {
        const a = createRegistry();
        const b = createRegistry();
        registerTool(a, mkTool('t1'), { category: 'a' });
        registerTool(b, mkTool('t2'), { category: 'b' });
        const merged = mergeRegistries(a, b);
        assert.equal(getToolCount(merged), 2);
        assert.ok(hasToolByName(merged, 't1'));
        assert.ok(hasToolByName(merged, 't2'));
    });

    it('secondary sobrescreve primary com mesmo nome', () => {
        const a = createRegistry();
        const b = createRegistry();
        registerTool(a, mkTool('t'), { category: 'old' });
        registerTool(b, mkTool('t'), { category: 'new' });
        const merged = mergeRegistries(a, b);
        assert.equal(getToolCount(merged), 1);
        assert.equal(merged.entries.get('t')?.category, 'new');
    });

    it('não deve modificar os registries originais', () => {
        const a = createRegistry();
        const b = createRegistry();
        registerTool(a, mkTool('ta'));
        registerTool(b, mkTool('tb'));
        mergeRegistries(a, b);
        assert.equal(getToolCount(a), 1);
        assert.equal(getToolCount(b), 1);
    });
});

// ─── filterByNames ────────────────────────────────────────────────────────────

describe('filterByNames', () => {
    it('deve retornar sub-registry com os nomes especificados', () => {
        const reg = createRegistry();
        registerTools(reg, [mkTool('a'), mkTool('b'), mkTool('c')]);
        const filtered = filterByNames(reg, ['a', 'c']);
        assert.equal(getToolCount(filtered), 2);
        assert.ok(hasToolByName(filtered, 'a'));
        assert.ok(!hasToolByName(filtered, 'b'));
        assert.ok(hasToolByName(filtered, 'c'));
    });

    it('deve retornar registry vazio para lista vazia', () => {
        const reg = createRegistry();
        registerTool(reg, mkTool('t'));
        assert.equal(getToolCount(filterByNames(reg, [])), 0);
    });

    it('não deve modificar o registry original', () => {
        const reg = createRegistry();
        registerTools(reg, [mkTool('a'), mkTool('b')]);
        filterByNames(reg, ['a']);
        assert.equal(getToolCount(reg), 2);
    });
});

// ─── excludeByNames ───────────────────────────────────────────────────────────

describe('excludeByNames', () => {
    it('deve excluir ferramentas com nomes especificados', () => {
        const reg = createRegistry();
        registerTools(reg, [mkTool('a'), mkTool('b'), mkTool('c')]);
        const filtered = excludeByNames(reg, ['b']);
        assert.equal(getToolCount(filtered), 2);
        assert.ok(!hasToolByName(filtered, 'b'));
        assert.ok(hasToolByName(filtered, 'a'));
        assert.ok(hasToolByName(filtered, 'c'));
    });

    it('deve retornar cópia completa se nenhum nome excluído existe', () => {
        const reg = createRegistry();
        registerTools(reg, [mkTool('x'), mkTool('y')]);
        const filtered = excludeByNames(reg, ['z']);
        assert.equal(getToolCount(filtered), 2);
    });
});

// ─── inspectRegistry ──────────────────────────────────────────────────────────

describe('inspectRegistry', () => {
    it('deve retornar total, categories e names', () => {
        const reg = createRegistry();
        registerTools(reg, [mkTool('lint'), mkTool('typecheck')], { category: 'code' });
        registerTool(reg, mkTool('git_diff'), { category: 'git' });
        const snap = inspectRegistry(reg);
        assert.equal(snap.total, 3);
        assert.equal(snap.categories['code'], 2);
        assert.equal(snap.categories['git'], 1);
        assert.ok(snap.names.includes('lint'));
        assert.ok(snap.names.includes('git_diff'));
    });

    it('deve retornar snapshot vazio para registry vazio', () => {
        const snap = inspectRegistry(createRegistry());
        assert.equal(snap.total, 0);
        assert.deepEqual(snap.names, []);
        assert.deepEqual(snap.categories, {});
    });
});
